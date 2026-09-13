import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Every way an edge can meet its neighbour, checked against the real database.
 *
 * Runs as a SCRATCH USER — a fixed uuid that is nobody — so it can build and
 * tear down days without caring what is in the real log. `test-reconcile.ts`
 * refuses to run once any blocks exist, which meant the one thing that needed
 * testing after four weeks of logging couldn't be.
 *
 * The cases that matter most are the ones with a pre-existing overlap. A single
 * overlap used to make the neighbour invisible to the edge-move query, so every
 * later nudge slid through it and made it worse; the fix has to walk into an
 * overlap and tidy it, not refuse and not deepen it.
 *
 * Run with: npm run test:edges
 */

const SCRATCH = '00000000-0000-4000-8000-0000000dead1'
process.env.TALLY_USER_ID = SCRATCH

const sql = neon(process.env.DATABASE_URL!)

const day = new Date()
day.setHours(0, 0, 0, 0)
const at = (h: number, m: number) => new Date(day.getTime() + (h * 60 + m) * 60_000)
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

let failures = 0

async function reset() {
  await sql`delete from blocks where user_id = ${SCRATCH}`
  await sql`delete from categories where user_id = ${SCRATCH}`
  await sql`
    insert into categories (user_id, slug, name)
    values (${SCRATCH}, 'a', 'A'), (${SCRATCH}, 'b', 'B'), (${SCRATCH}, 'c', 'C')
  `
}

async function block(slug: string, from: Date, to: Date | null) {
  const rows = (await sql`
    insert into blocks (user_id, category_id, started_at, ended_at)
    select ${SCRATCH}, id, ${from.toISOString()}::timestamptz,
           ${to ? to.toISOString() : null}::timestamptz
    from categories where user_id = ${SCRATCH} and slug = ${slug}
    returning id
  `) as Array<{ id: string }>
  return rows[0].id
}

/** The day as one line: "a 09:00-10:00 | b 10:00-11:00". */
async function strip() {
  const rows = (await sql`
    select c.slug, b.started_at, b.ended_at from blocks b
    join categories c on c.id = b.category_id
    where b.user_id = ${SCRATCH} order by b.started_at
  `) as Array<{ slug: string; started_at: string; ended_at: string | null }>
  return rows
    .map((r) => `${r.slug} ${hhmm(r.started_at)}-${r.ended_at ? hhmm(r.ended_at) : 'open'}`)
    .join(' | ')
}

async function overlapCount() {
  const rows = (await sql`
    select a.id from blocks a join blocks b
      on a.user_id = b.user_id and a.id < b.id
     and a.started_at < coalesce(b.ended_at, now())
     and coalesce(a.ended_at, now()) > b.started_at
    where a.user_id = ${SCRATCH}
  `) as Array<unknown>
  return rows.length
}

type Case = {
  name: string
  build: () => Promise<string>
  run: (id: string) => Promise<void>
  /** The strip afterwards, or the error the edit should refuse with. */
  expect: string
  refuses?: boolean
  /** Overlaps left afterwards. Only non-zero where the fixture itself is tangled. */
  overlapsAfter?: number
}

async function main() {
  const edits = await import('../lib/edits')

  const cases: Case[] = [
    {
      name: 'start −5, touching neighbour before it: the neighbour gives up 5 minutes',
      build: async () => {
        await block('a', at(9, 0), at(10, 0))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -5),
      expect: 'a 09:00-09:55 | b 09:55-11:00',
    },
    {
      name: 'start +5, touching neighbour before it: the neighbour takes 5 minutes back',
      build: async () => {
        await block('a', at(9, 0), at(10, 0))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', 5),
      expect: 'a 09:00-10:05 | b 10:05-11:00',
    },
    {
      name: 'end +5, touching neighbour after it: the neighbour gives up 5 minutes',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', at(11, 0), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'b 10:00-11:05 | c 11:05-12:00',
    },
    {
      name: 'end −5, touching neighbour after it: the neighbour takes 5 minutes back',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', at(11, 0), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', -5),
      expect: 'b 10:00-10:55 | c 10:55-12:00',
    },
    {
      name: 'start −5 into a gap: the gap absorbs it, the neighbour stays put',
      build: async () => {
        await block('a', at(9, 0), at(9, 30))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -5),
      expect: 'a 09:00-09:30 | b 09:55-11:00',
    },
    {
      name: 'end +5 into a gap: the gap absorbs it, the neighbour stays put',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', at(11, 30), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'b 10:00-11:05 | c 11:30-12:00',
    },
    {
      name: 'start −5 with two blocks before it: only the nearest one moves',
      build: async () => {
        await block('a', at(8, 0), at(9, 0))
        await block('c', at(9, 0), at(10, 0))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -5),
      expect: 'a 08:00-09:00 | c 09:00-09:55 | b 09:55-11:00',
    },
    {
      name: 'end +40 across a whole neighbour: refused rather than swallowing it',
      build: async () => {
        const id = await block('b', at(10, 0), at(10, 30))
        await block('c', at(10, 30), at(11, 0))
        await block('a', at(11, 0), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 40),
      expect: 'That would leave nothing of the block after it',
      refuses: true,
    },
    {
      name: 'start −45 past a whole neighbour: refused rather than swallowing it',
      build: async () => {
        await block('a', at(9, 30), at(10, 0))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -45),
      expect: 'That would leave nothing of the block before it',
      refuses: true,
    },
    {
      name: 'end +5 when the running block is next: it starts 5 minutes later',
      build: async () => {
        const id = await block('b', at(0, 30), at(1, 0))
        await block('c', at(1, 0), null)
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'b 00:30-01:05 | c 01:05-open',
    },
    {
      name: 'start −5 when the running block STARTED before it: refused, not deepened',
      build: async () => {
        await block('a', at(9, 0), null)
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -5),
      expect: 'The block before this one is still running — stop it first',
      refuses: true,
      overlapsAfter: 1,
    },
    {
      name: 'EXISTING OVERLAP: end +5 when the next block already starts too early',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', at(10, 50), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'b 10:00-11:05 | c 11:05-12:00',
    },
    {
      name: 'EXISTING OVERLAP: start −5 when the block before already ends too late',
      build: async () => {
        await block('a', at(9, 0), at(10, 10))
        return block('b', at(10, 0), at(11, 0))
      },
      run: (id) => edits.moveEdge(id, 'start', -5),
      expect: 'a 09:00-09:55 | b 09:55-11:00',
    },
    {
      name: 'EXISTING OVERLAP: a neighbour sitting inside this block is refused, not nudged',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', at(10, 30), at(10, 45))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'The next block sits inside this one — fix that overlap first',
      refuses: true,
      overlapsAfter: 1,
    },
    {
      name: 'HALF-SECOND GAP: end +5 still moves the neighbour rather than refusing',
      build: async () => {
        const id = await block('b', at(10, 0), at(11, 0))
        await block('c', new Date(at(11, 0).getTime() + 500), at(12, 0))
        return id
      },
      run: (id) => edits.moveEdge(id, 'end', 5),
      expect: 'b 10:00-11:05 | c 11:05-12:00',
    },
  ]

  for (const test of cases) {
    await reset()
    const id = await test.build()

    let error: string | null = null
    try {
      await test.run(id)
    } catch (e) {
      error = (e as Error).message
    }

    const after = await strip()
    const actual = test.refuses ? (error ?? '(no error)') : after
    const ok = actual === test.expect
    const overlaps = await overlapCount()
    const overlapsOk = overlaps === (test.overlapsAfter ?? 0)

    if (!ok || !overlapsOk) failures++
    console.log(`  ${ok && overlapsOk ? 'ok  ' : 'FAIL'}  ${test.name}`)
    if (!ok) {
      console.log(`          expected  ${test.expect}`)
      console.log(`          got       ${actual}`)
    }
    if (!overlapsOk) {
      console.log(`          overlaps  expected ${test.overlapsAfter ?? 0}, found ${overlaps}`)
    }
    if (error && !test.refuses) console.log(`          refused unexpectedly: ${error}`)
  }

  await sql`delete from blocks where user_id = ${SCRATCH}`
  await sql`delete from categories where user_id = ${SCRATCH}`

  console.log(
    failures === 0 ? `\n${cases.length} cases, all ok` : `\n${failures} of ${cases.length} FAILED`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
