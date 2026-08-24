import { getSql, userId } from './db'

export type Segment = {
  kind: 'block' | 'gap'
  id: string | null
  slug: string | null
  name: string
  /** -1 drain, 0 neutral, +1 charge. Gaps carry 0. */
  energy: number
  startedAt: string
  endedAt: string
  /**
   * The block has no ended_at — it is the one currently running. True even when
   * viewing a past day that it started in, so the controls stay honest: you
   * can't drag the end of a block that hasn't ended.
   */
  running: boolean
  /**
   * Running AND this window ends at now, so `endedAt` really does mean "now".
   * False for a running block seen from a past day, where it is clamped to that
   * day's midnight and showing "now" would be a lie.
   */
  live: boolean
  minutes: number
}

export type DayCheck = {
  energy: number | null
  movedPriority: boolean | null
  note: string | null
}

export type Day = {
  date: string
  from: string
  to: string
  segments: Segment[]
  loggedMinutes: number
  gapMinutes: number
  gapCount: number
  /** A daily_check row exists — the day has been closed. */
  complete: boolean
  check: DayCheck | null
}

const MS_PER_MINUTE = 60_000

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_MINUTE))
}

/**
 * The day as a continuous strip: every block clamped to the window, with the
 * unlogged stretches between them made explicit as gap segments.
 *
 * Gaps are the whole point of the reconcile screen — you can only fix a day you
 * half-forgot if the parts you forgot are visible. The window is clamped to now
 * so the rest of today doesn't read as one enormous gap.
 */
export async function getDay(date: string, fromISO: string, toISO: string): Promise<Day> {
  const sql = getSql()
  const uid = userId()

  const nowMs = Date.now()
  const to = new Date(toISO).getTime() > nowMs ? new Date(nowMs).toISOString() : toISO

  const rows = (await sql`
    select
      b.id,
      b.started_at,
      b.ended_at,
      c.slug,
      c.name,
      coalesce(b.energy_override, c.energy) as energy
    from blocks b
    join categories c on c.id = b.category_id
    where b.user_id = ${uid}
      and b.started_at < ${to}::timestamptz
      and coalesce(b.ended_at, now()) > ${fromISO}::timestamptz
    order by b.started_at
  `) as Array<{
    id: string
    started_at: string
    ended_at: string | null
    slug: string
    name: string
    energy: number
  }>

  const checkRows = (await sql`
    select energy, moved_priority, note
    from daily_check
    where user_id = ${uid} and date = ${date}::date
  `) as Array<{ energy: number | null; moved_priority: boolean | null; note: string | null }>

  const windowStart = new Date(fromISO).getTime()
  const windowEnd = new Date(to).getTime()

  const segments: Segment[] = []
  let cursor = windowStart

  const pushGap = (from: number, until: number) => {
    if (until - from < MS_PER_MINUTE) return // sub-minute slivers are rounding, not gaps
    segments.push({
      kind: 'gap',
      id: null,
      slug: null,
      name: 'Nothing recorded',
      energy: 0,
      startedAt: new Date(from).toISOString(),
      endedAt: new Date(until).toISOString(),
      running: false,
      live: false,
      minutes: Math.round((until - from) / MS_PER_MINUTE),
    })
  }

  for (const row of rows) {
    const start = Math.max(windowStart, new Date(row.started_at).getTime())
    const rawEnd = row.ended_at ? new Date(row.ended_at).getTime() : nowMs
    const end = Math.min(windowEnd, rawEnd)
    if (end <= start) continue

    pushGap(cursor, start)

    const startedAt = new Date(start).toISOString()
    const endedAt = new Date(end).toISOString()
    segments.push({
      kind: 'block',
      id: row.id,
      slug: row.slug,
      name: row.name,
      energy: Number(row.energy),
      startedAt,
      endedAt,
      running: row.ended_at === null,
      live: row.ended_at === null && end >= Math.min(windowEnd, nowMs),
      minutes: minutesBetween(startedAt, endedAt),
    })

    cursor = Math.max(cursor, end)
  }

  pushGap(cursor, windowEnd)

  const loggedMinutes = segments
    .filter((s) => s.kind === 'block')
    .reduce((total, s) => total + s.minutes, 0)
  const gapSegments = segments.filter((s) => s.kind === 'gap')

  return {
    date,
    from: fromISO,
    to,
    segments,
    loggedMinutes,
    gapMinutes: gapSegments.reduce((total, s) => total + s.minutes, 0),
    gapCount: gapSegments.length,
    complete: checkRows.length > 0,
    check:
      checkRows.length > 0
        ? {
            energy: checkRows[0].energy,
            movedPriority: checkRows[0].moved_priority,
            note: checkRows[0].note,
          }
        : null,
  }
}
