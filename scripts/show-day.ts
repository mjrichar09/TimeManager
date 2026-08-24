import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Read-only: prints the reconcile strip for a day, as the app would build it.
 * Useful for checking how a block spanning midnight is split between two days.
 *
 *   npx tsx scripts/show-day.ts          today
 *   npx tsx scripts/show-day.ts 1        yesterday
 */
async function main() {
  const { getDay } = await import('../lib/day')

  const offset = Number(process.argv[2] ?? 0)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`

  const day = await getDay(date, start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString())

  const local = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

  console.log(`\n${date}  (window ${local(day.from)} → ${local(day.to)})`)
  console.log(`  logged ${day.loggedMinutes}m · ${day.gapCount} gap(s) ${day.gapMinutes}m · complete: ${day.complete}\n`)

  for (const s of day.segments) {
    const flags = [s.running ? 'running' : '', s.live ? 'live' : ''].filter(Boolean).join(' ')
    const label = s.kind === 'gap' ? '— unlogged —' : s.name
    console.log(
      `  ${local(s.startedAt)} → ${local(s.endedAt)}  ${String(s.minutes).padStart(4)}m  ${label.padEnd(20)} ${flags}`
    )
  }
  console.log()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
