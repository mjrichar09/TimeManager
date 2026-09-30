import { writeFileSync } from 'node:fs'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Dump the review aggregates to a JSON file.
 *
 * The report screen reads the database directly, which is the right shape for
 * looking at. This exists for the other half — handing the same numbers to
 * someone who cannot reach the database, without handing over the database.
 *
 * It exports AGGREGATES only: hours per category per week, per-day totals,
 * check answers, chore statistics, goal counts. No block notes, no check notes,
 * no times of day, no chore notes — nothing that reads as a diary.
 *
 *   npx tsx scripts/export-review.ts [from] [to] [outfile]
 *
 * Defaults to the whole log from 2026-08-23 to today, written to
 * review-export.json.
 */
async function main() {
  const { getReports } = await import('../lib/reports')

  const from = process.argv[2] ?? '2026-08-23'
  const to = process.argv[3] ?? new Date().toISOString().slice(0, 10)
  const out = process.argv[4] ?? 'review-export.json'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Dates go in as YYYY-MM-DD')
  }

  const reports = await getReports(from, to)
  writeFileSync(out, JSON.stringify(reports, null, 2))

  const logged = reports.days.reduce((n, d) => n + d.loggedMinutes, 0)
  console.log(`Wrote ${out}`)
  console.log(`  ${from} → ${to} (${reports.window.timezone})`)
  console.log(`  ${reports.days.length} days · ${(logged / 60).toFixed(0)}h logged`)
  console.log(`  ${reports.categories.length} categories · ${reports.chores.length} chores`)
  console.log(`  ${reports.checks.length} daily checks · ${reports.goals.length} goals`)
  console.log('\nAggregates only — no notes, no times of day. Safe to share.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
