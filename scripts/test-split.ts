import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Covers splitting a closed block, and filling only part of a gap.
 *
 * Uses a date far in the past so it cannot collide with real logged time, and
 * deletes exactly the rows it created. Safe to run against a live database.
 */

const sql = neon(process.env.DATABASE_URL!)
const uid = process.env.TALLY_USER_ID!

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures++
}

const DAY = new Date(2020, 0, 15) // 15 Jan 2020, local

async function main() {
  const { getDay } = await import('../lib/day')
  const edits = await import('../lib/edits')

  const at = (h: number, m: number) =>
    new Date(DAY.getTime() + (h * 60 + m) * 60_000).toISOString()

  // The scratch day is empty either side of the evening, so it always has a
  // leading and trailing gap. Only gaps INSIDE the window are interesting.
  const innerGaps = (d: Awaited<ReturnType<typeof getDay>>) =>
    d.segments.filter(
      (s) =>
        s.kind === 'gap' &&
        new Date(s.startedAt).getTime() >= new Date(at(18, 0)).getTime() &&
        new Date(s.endedAt).getTime() <= new Date(at(21, 0)).getTime()
    )
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${DAY.getFullYear()}-${pad(DAY.getMonth() + 1)}-${pad(DAY.getDate())}`
  const win = { date, from: DAY.toISOString(), to: new Date(DAY.getTime() + 86_400_000).toISOString() }

  const before = (await sql`
    select count(*)::int as n from blocks
    where user_id = ${uid} and started_at >= ${win.from}::timestamptz and started_at < ${win.to}::timestamptz
  `) as Array<{ n: number }>
  if (before[0].n > 0) {
    console.error('Refusing to run: the 2020-01-15 scratch day already has blocks.')
    process.exit(1)
  }

  const cat = async (slug: string) =>
    ((await sql`select id from categories where user_id = ${uid} and slug = ${slug}`) as Array<{ id: string }>)[0].id

  console.log('\none 3h evening block, 18:00-21:00')
  await sql`insert into blocks (user_id, category_id, started_at, ended_at, source)
            values (${uid}, ${await cat('meals')}, ${at(18, 0)}::timestamptz, ${at(21, 0)}::timestamptz, 'pwa')`

  let day = await getDay(win.date, win.from, win.to)
  let blocks = day.segments.filter((s) => s.kind === 'block')
  check('one block to start', blocks.length === 1, `${blocks.length}`)

  console.log('\nsplit it at 18:45')
  await edits.splitBlock(blocks[0].id!, at(18, 45))
  day = await getDay(win.date, win.from, win.to)
  blocks = day.segments.filter((s) => s.kind === 'block')
  check('now two blocks', blocks.length === 2, `${blocks.length}`)
  check('first is 45m', blocks[0].minutes === 45, `${blocks[0].minutes}m`)
  check('second is 135m', blocks[1].minutes === 135, `${blocks[1].minutes}m`)
  check('both kept the category', blocks.every((b) => b.slug === 'meals'))
  check('no gap opened at the cut', innerGaps(day).length === 0, `${innerGaps(day).length} inner gap(s)`)

  console.log('\nrelabel the second half, then split again at 20:00')
  await edits.recategorize(blocks[1].id!, 'kids-active')
  day = await getDay(win.date, win.from, win.to)
  blocks = day.segments.filter((s) => s.kind === 'block')
  await edits.splitBlock(blocks[1].id!, at(20, 0))
  await (async () => {
    day = await getDay(win.date, win.from, win.to)
    blocks = day.segments.filter((s) => s.kind === 'block')
  })()
  await edits.recategorize(blocks[2].id!, 'media-scroll')
  day = await getDay(win.date, win.from, win.to)
  blocks = day.segments.filter((s) => s.kind === 'block')
  check('three blocks now', blocks.length === 3, `${blocks.length}`)
  check(
    'they read Meals / Kids / Media',
    blocks.map((b) => b.slug).join(',') === 'meals,kids-active,media-scroll',
    blocks.map((b) => b.slug).join(',')
  )
  check('still no gaps inside the evening', innerGaps(day).length === 0, `${innerGaps(day).length}`)
  check('still 3h total', day.loggedMinutes === 180, `${day.loggedMinutes}m`)

  console.log('\nrefuse a split outside the block')
  let refused = 0
  for (const t of [at(17, 0), at(22, 0)]) {
    try {
      await edits.splitBlock(blocks[0].id!, t)
    } catch {
      refused++
    }
  }
  check('both out-of-range splits refused', refused === 2, `${refused}/2`)

  console.log('\npartial gap fill: clear the middle, then fill only the first hour')
  await edits.deleteBlock(blocks[1].id!)
  day = await getDay(win.date, win.from, win.to)
  const gap = innerGaps(day).find((s) => s.minutes === 75)
  check('75m gap appeared', gap !== undefined, `${innerGaps(day).length} inner gap(s)`)

  await edits.fillGap(gap!.startedAt, at(19, 30), 'exercise')
  day = await getDay(win.date, win.from, win.to)
  const filled = day.segments.filter((s) => s.kind === 'block' && s.slug === 'exercise')
  const leftover = innerGaps(day)
  check('partial fill created a 45m block', filled[0]?.minutes === 45, `${filled[0]?.minutes}m`)
  check('the rest stayed a gap', leftover.length === 1 && leftover[0].minutes === 30, `${leftover[0]?.minutes}m`)

  console.log('\ninvariants')
  const overlaps = (await sql`
    select count(*)::int as n from blocks a join blocks b
      on a.user_id = b.user_id and a.id < b.id
     and a.started_at < coalesce(b.ended_at, now())
     and coalesce(a.ended_at, now()) > b.started_at
    where a.user_id = ${uid}
  `) as Array<{ n: number }>
  check('no overlaps anywhere', overlaps[0].n === 0, `${overlaps[0].n}`)

  console.log('\ncleaning up the scratch day')
  const deleted = (await sql`
    delete from blocks
    where user_id = ${uid} and started_at >= ${win.from}::timestamptz and started_at < ${win.to}::timestamptz
    returning id
  `) as Array<{ id: string }>
  console.log(`  removed ${deleted.length} scratch block(s)`)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
