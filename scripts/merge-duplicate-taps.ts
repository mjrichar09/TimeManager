import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Fold a double-tapped category back into one block.
 *
 * `repair-overlaps.ts` deliberately leaves these alone: its rule is "the later
 * block's start is the truth, the earlier block's end drifted", and applying
 * that here would leave an eight-second block rather than fix anything. Two
 * blocks of the SAME category starting seconds apart aren't a boundary that
 * drifted — they are one tap that got recorded twice.
 *
 * So the repair is different in kind: keep the union of the two, the earlier
 * start and the later end, and delete the duplicate row. Nothing is lost,
 * because the category is identical on both sides — which is exactly the
 * condition this script refuses to run without.
 *
 * Dry run by default; `--apply` writes, after saving both rows to a JSON file
 * under db/repairs/ (git-ignored) that it names.
 *
 * Run with: npm run db:merge-taps [-- --apply]
 */

/** How close two starts have to be to read as one tap rather than two. */
const SAME_TAP_SECONDS = 60
const ZONE = 'America/New_York'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: ZONE, hour12: false })

type Pair = {
  a_id: string
  a_started: string
  a_ended: string | null
  b_id: string
  b_started: string
  b_ended: string | null
  name: string
  apart: number
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  // Same user, same category, overlapping, and starting within a minute of each
  // other. Every one of those conditions is load-bearing: drop any of them and
  // this stops being a duplicate tap and starts being two real blocks.
  const pairs = (await sql`
    select a.id as a_id, a.started_at as a_started, a.ended_at as a_ended,
           b.id as b_id, b.started_at as b_started, b.ended_at as b_ended,
           c.name as name,
           extract(epoch from (b.started_at - a.started_at)) as apart
    from blocks a
    join blocks b on a.user_id = b.user_id and a.id < b.id
      and a.category_id = b.category_id
      and a.started_at < coalesce(b.ended_at, now())
      and coalesce(a.ended_at, now()) > b.started_at
      and abs(extract(epoch from (b.started_at - a.started_at))) <= ${SAME_TAP_SECONDS}
    join categories c on c.id = a.category_id
    where a.user_id = ${user}
    order by a.started_at
  `) as Pair[]

  if (pairs.length === 0) {
    console.log('No duplicate taps. Nothing to do.')
    return
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${pairs.length} duplicate tap(s)\n`)
  for (const pair of pairs) {
    console.log(`  ${pair.name} — two blocks ${Math.round(pair.apart)}s apart`)
    console.log(`      ${when(pair.a_started)} – ${pair.a_ended ? when(pair.a_ended) : 'open'}`)
    console.log(`      ${when(pair.b_started)} – ${pair.b_ended ? when(pair.b_ended) : 'open'}`)
    console.log(
      `      becomes one block  ${when(pair.a_started)} – ` +
        `${pair.b_ended ? when(pair.b_ended) : 'open'}`
    )
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.')
    return
  }

  const dir = join(process.cwd(), 'db', 'repairs')
  mkdirSync(dir, { recursive: true })
  const backup = join(dir, `duplicate-taps-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(backup, JSON.stringify(pairs, null, 2))
  console.log(`\nPrevious state saved to ${backup}`)

  for (const pair of pairs) {
    // Stretch the surviving block back over the duplicate first, then remove
    // the duplicate — in that order the day is never briefly missing the time.
    await sql.transaction([
      sql`
        update blocks set started_at = ${pair.a_started}::timestamptz
        where id = ${pair.b_id} and user_id = ${user}
      `,
      sql`delete from blocks where id = ${pair.a_id} and user_id = ${user}`,
    ])
  }

  const left = (await sql`
    select count(*)::int as n from blocks a join blocks b
      on a.user_id = b.user_id and a.id < b.id
     and a.started_at < coalesce(b.ended_at, now())
     and coalesce(a.ended_at, now()) > b.started_at
    where a.user_id = ${user}
  `) as Array<{ n: number }>

  console.log(`Done. Overlapping pairs left in the whole log: ${left[0].n}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
