import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Pull every overlapping block back to the start of the one after it.
 *
 * The rule is the one that matches what actually happened: when two blocks
 * claim the same minutes, the later block's start is the truth and the earlier
 * block's end is the thing that drifted. So the earlier block gives the time
 * up — its end moves back to the later block's start — and nothing else moves.
 *
 * Walks the log in order and compares each block with the next one, rather than
 * fixing the pairs a self-join reports. One block that encloses three others is
 * three pairs but one trim, and doing it in order means a trim never has to be
 * re-examined: after the pass, every block ends at or before the next one's
 * start, by construction.
 *
 * Two shapes are never touched, because the rule doesn't produce a sane block:
 *   - the trim would leave less than a minute, which is a duplicate tap rather
 *     than a boundary that drifted
 *   - the earlier block is the one still running, where trimming means closing
 *     it, which is a bigger edit than a repair should make
 *
 * Dry run by default; `--apply` writes, after saving the previous state to a
 * JSON file under db/repairs/ (git-ignored) that it names. Run with: npm run db:repair-overlaps [-- --apply]
 */

const MIN_BLOCK_MS = 60_000
const ZONE = 'America/New_York'

type Row = {
  id: string
  name: string
  started_at: string
  ended_at: string | null
  /**
   * The same two instants to the microsecond, as UTC text.
   *
   * Postgres keeps microseconds and a JS Date only has milliseconds, so a
   * boundary that drifted by a fraction of a millisecond reads as "touching"
   * once it goes through `new Date()` — and two blocks that genuinely overlap
   * look fine. Compared as text in a fixed zone these sort exactly like the
   * timestamps they came from.
   */
  s_txt: string
  e_txt: string | null
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const minutes = (ms: number) => Math.round((ms / 60_000) * 10) / 10

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  const blocks = (await sql`
    select b.id, c.name, b.started_at, b.ended_at,
           to_char(b.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s_txt,
           to_char(b.ended_at   at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as e_txt
    from blocks b join categories c on c.id = b.category_id
    where b.user_id = ${user}
    order by b.started_at asc, b.ended_at asc nulls last
  `) as Row[]

  const trims: Array<{ row: Row; newEnd: string; lost: number; against: Row }> = []
  const skipped: Array<{ row: Row; against: Row; why: string }> = []

  for (let i = 0; i < blocks.length - 1; i++) {
    const row = blocks[i]
    const next = blocks[i + 1]
    const nextStart = new Date(next.started_at).getTime()

    if (row.ended_at === null) {
      // The running block, with something logged after it starts.
      skipped.push({ row, against: next, why: 'this block is still running' })
      continue
    }

    const start = new Date(row.started_at).getTime()
    const end = new Date(row.ended_at).getTime()
    // Microsecond-exact: ms arithmetic is fine for "how much time", but not for
    // "is this an overlap at all".
    if ((row.e_txt as string) <= next.s_txt) continue

    if (nextStart - start < MIN_BLOCK_MS) {
      skipped.push({
        row,
        against: next,
        why: `the trim would leave ${Math.round((nextStart - start) / 1000)}s of it`,
      })
      continue
    }

    trims.push({
      // Set to the neighbour's own start, to the microsecond, so the repair
      // closes the seam exactly rather than to the nearest millisecond.
      row,
      newEnd: `${next.s_txt}+00`,
      lost: end - nextStart,
      against: next,
    })
  }

  if (trims.length === 0 && skipped.length === 0) {
    console.log('No overlaps. Nothing to do.')
    return
  }

  let lost = 0
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${trims.length} block(s) to trim\n`)
  for (const trim of trims) {
    lost += trim.lost
    console.log(`  ${stamp(trim.row.started_at).slice(0, 10)}  ${trim.row.name}`)
    console.log(
      `      ${clock(trim.row.started_at)}–${clock(trim.row.ended_at!)}  →  ` +
        `${clock(trim.row.started_at)}–${clock(trim.newEnd)}   ` +
        `(−${minutes(trim.lost)}m, meets “${trim.against.name}”)`
    )
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} left alone:`)
    for (const skip of skipped) {
      console.log(
        `  ${stamp(skip.row.started_at).slice(0, 10)}  ${skip.row.name} ` +
          `${clock(skip.row.started_at)}–${skip.row.ended_at ? clock(skip.row.ended_at) : 'open'} ` +
          `vs “${skip.against.name}” at ${clock(skip.against.started_at)} — ${skip.why}`
      )
    }
  }

  console.log(`\nTotal to give back: ${minutes(lost)} minutes (${(lost / 3_600_000).toFixed(1)}h)`)

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.')
    return
  }

  // The previous state, before anything moves, so a bad call is reversible.
  const dir = join(process.cwd(), 'db', 'repairs')
  mkdirSync(dir, { recursive: true })
  const backup = join(dir, `overlaps-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(
    backup,
    JSON.stringify(
      trims.map((t) => ({
        id: t.row.id,
        name: t.row.name,
        started_at: t.row.started_at,
        ended_at_before: t.row.ended_at,
        ended_at_after: t.newEnd,
      })),
      null,
      2
    )
  )
  console.log(`\nPrevious state saved to ${backup}`)

  // One statement per block, batched — each is independent, and a partial
  // application is still a strictly better log than the one we started with.
  for (let i = 0; i < trims.length; i += 20) {
    await sql.transaction(
      trims.slice(i, i + 20).map(
        (trim) => sql`
          update blocks set ended_at = ${trim.newEnd}::timestamptz
          where id = ${trim.row.id} and user_id = ${user}
        `
      )
    )
  }

  const left = (await sql`
    select count(*)::int as n from blocks a join blocks b
      on a.user_id = b.user_id and a.id < b.id
     and a.started_at < coalesce(b.ended_at, now())
     and coalesce(a.ended_at, now()) > b.started_at
    where a.user_id = ${user}
  `) as Array<{ n: number }>

  console.log(`Done. Overlapping pairs left: ${left[0].n}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
