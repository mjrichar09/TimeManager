import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Exercises the reconcile edits against the real database: builds a day with a
 * deliberate gap, then recategorises, drags boundaries, fills the gap, splits
 * the running block, and checks the invariants after each step.
 *
 * Cleans up after itself. Run with: npx tsx scripts/test-reconcile.ts
 */

const sql = neon(process.env.DATABASE_URL!)
const uid = process.env.TALLY_USER_ID!

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures++
}

async function invariants(label: string) {
  const overlaps = (await sql`
    select count(*)::int as n from blocks a join blocks b
      on a.user_id = b.user_id and a.id < b.id
     and a.started_at < coalesce(b.ended_at, now())
     and coalesce(a.ended_at, now()) > b.started_at
    where a.user_id = ${uid}
  `) as Array<{ n: number }>
  const inverted = (await sql`
    select count(*)::int as n from blocks
    where user_id = ${uid} and ended_at is not null and ended_at <= started_at
  `) as Array<{ n: number }>
  const open = (await sql`
    select count(*)::int as n from blocks where user_id = ${uid} and ended_at is null
  `) as Array<{ n: number }>

  check(`${label}: no overlaps`, overlaps[0].n === 0, `${overlaps[0].n} found`)
  check(`${label}: no inverted blocks`, inverted[0].n === 0, `${inverted[0].n} found`)
  check(`${label}: at most one open`, open[0].n <= 1, `${open[0].n} open`)
}

async function main() {
  const existing = (await sql`select count(*)::int as n from blocks where user_id = ${uid}`) as Array<{ n: number }>
  if (existing[0].n > 0) {
    console.error(`Refusing to run: ${existing[0].n} block(s) already exist. Clear them first.`)
    process.exit(1)
  }

  const { getDay } = await import('../lib/day')
  const edits = await import('../lib/edits')

  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const at = (h: number, m: number) => new Date(dayStart.getTime() + (h * 60 + m) * 60_000).toISOString()
  const date = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`
  const win = { date, from: dayStart.toISOString(), to: new Date(dayStart.getTime() + 86_400_000).toISOString() }

  const cat = async (slug: string) =>
    ((await sql`select id from categories where user_id = ${uid} and slug = ${slug}`) as Array<{ id: string }>)[0].id

  console.log('\nseeding a half-forgotten day (08:00-09:00, gap, 10:00-11:00)')
  await sql`insert into blocks (user_id, category_id, started_at, ended_at, source)
            values (${uid}, ${await cat('deep-work')}, ${at(8, 0)}::timestamptz, ${at(9, 0)}::timestamptz, 'pwa')`
  await sql`insert into blocks (user_id, category_id, started_at, ended_at, source)
            values (${uid}, ${await cat('meetings')}, ${at(10, 0)}::timestamptz, ${at(11, 0)}::timestamptz, 'pwa')`

  let day = await getDay(win.date, win.from, win.to)
  const gaps = day.segments.filter((s) => s.kind === 'gap')
  check('gap detected between the two blocks', gaps.some((g) => g.minutes === 60), `${gaps.length} gap segment(s)`)
  check('logged time is 2h', day.loggedMinutes === 120, `${day.loggedMinutes}m`)
  await invariants('after seed')

  console.log('\nrecategorise the first block')
  const first = day.segments.find((s) => s.kind === 'block')!
  await edits.recategorize(first.id!, 'email-admin')
  day = await getDay(win.date, win.from, win.to)
  check('block is now Email / admin', day.segments.find((s) => s.id === first.id)?.slug === 'email-admin')

  console.log('\nfill the 60m gap with commute')
  const gap = day.segments.find((s) => s.kind === 'gap' && s.minutes === 60)!
  await edits.fillGap(gap.startedAt, gap.endedAt, 'commute')
  day = await getDay(win.date, win.from, win.to)
  check('gap is gone', !day.segments.some((s) => s.kind === 'gap' && s.minutes === 60))
  check('logged time is now 3h', day.loggedMinutes === 180, `${day.loggedMinutes}m`)
  await invariants('after fill')

  console.log('\ndrag the boundary between block 1 and 2 back 15m')
  const blocks = day.segments.filter((s) => s.kind === 'block')
  const before = blocks[0].minutes
  await edits.moveEdge(blocks[1].id!, 'start', -15)
  day = await getDay(win.date, win.from, win.to)
  const after = day.segments.filter((s) => s.kind === 'block')
  check('first block shrank by 15m', after[0].minutes === before - 15, `${before} -> ${after[0].minutes}`)
  check('no gap opened at the seam', !day.segments.some((s) => s.kind === 'gap' && s.minutes < 60 && s.minutes > 0))
  check('total logged unchanged', day.loggedMinutes === 180, `${day.loggedMinutes}m`)
  await invariants('after drag')

  console.log('\nrefuse an edit that would swallow a neighbour')
  let refused = false
  try {
    await edits.moveEdge(after[1].id!, 'start', -600)
  } catch {
    refused = true
  }
  check('over-long drag rejected', refused)
  await invariants('after rejected drag')

  console.log('\nopen a running block, then split it')
  await sql`insert into blocks (user_id, category_id, started_at, source)
            values (${uid}, ${await cat('deep-work')}, ${new Date(Date.now() - 120 * 60_000).toISOString()}::timestamptz, 'pwa')`
  const splitAt = new Date(Date.now() - 60 * 60_000).toISOString()
  await edits.splitOpenBlock(splitAt, 'media-scroll')
  day = await getDay(win.date, win.from, win.to)
  const running = day.segments.find((s) => s.live)
  check('running block is now media-scroll', running?.slug === 'media-scroll', String(running?.slug))
  check('running block is ~60m', running !== undefined && Math.abs(running.minutes - 60) <= 1, `${running?.minutes}m`)
  check('no gap created by the split', !day.segments.some((s) => s.kind === 'gap' && s.startedAt === splitAt))
  await invariants('after split')

  console.log('\nday complete + check')
  await edits.completeDay(date)
  day = await getDay(win.date, win.from, win.to)
  check('day marked complete', day.complete)
  await edits.saveCheck(date, 7, true, 'test note')
  day = await getDay(win.date, win.from, win.to)
  check('check saved', day.check?.energy === 7 && day.check?.movedPriority === true)

  console.log('\ncleaning up')
  await sql`delete from blocks where user_id = ${uid}`
  await sql`delete from daily_check where user_id = ${uid} and date = ${date}::date`
  const left = (await sql`select count(*)::int as n from blocks where user_id = ${uid}`) as Array<{ n: number }>
  check('database left clean', left[0].n === 0)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
