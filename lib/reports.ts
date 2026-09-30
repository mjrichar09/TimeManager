import { getSql, userId } from './db'
import { getSettings } from './rounds'

/**
 * The week-4 reports (build-plan §8, M4).
 *
 * Every figure here is derived at read time from blocks, daily_check,
 * goal_progress and the chore log. Nothing is stored, so a repaired block or a
 * corrected check changes the report the moment it changes the data.
 *
 * ## Two things this file is careful about
 *
 * **Days are local.** Blocks are timestamptz; `date_trunc('day', ...)` on one
 * uses the server's zone, which is UTC on Vercel. For New York that moves every
 * evening block onto the following day and would quietly wreck the daily
 * series. So every query converts to the user's zone FIRST — `at time zone $tz`
 * yields a local wall-clock timestamp — and does all arithmetic in that space.
 *
 * **Blocks are split at midnight.** Sleep crosses midnight every single night.
 * Attributing a block wholly to its start day would hand most of the night to
 * yesterday and leave a hole in "how much of today did you log". The daily
 * queries expand each block over the days it touches and clip it to each one.
 */

export type DayFidelity = {
  date: string
  loggedMinutes: number
  blocks: number
  /** Minutes between the first and last block that were never accounted for. */
  gapMinutes: number
  complete: boolean
  checked: boolean
}

export type CategoryTotal = {
  slug: string
  name: string
  energy: number
  valueTier: number
  buybackCost: number | null
  hours: number
  blocks: number
}

export type WeekSeries = { weekStart: string; hours: number }

export type CheckPoint = {
  date: string
  energy: number | null
  movedPriority: boolean | null
}

export type ChoreStat = {
  slug: string
  name: string
  area: string | null
  intervalDays: number
  estimateMinutes: number
  completions: number
  /** Mean days between consecutive completions. Null until done twice. */
  actualIntervalDays: number | null
  /** Mean logged minutes, where minutes were recorded. Null if never timed. */
  actualMinutes: number | null
  timedCompletions: number
  lastDoneOn: string | null
}

export type GoalScore = {
  id: string
  title: string
  rank: number
  leadMeasure: string | null
  targetCount: number | null
  targetPeriod: string
  periods: Array<{ periodStart: string; doneCount: number }>
}

export type ReportWindow = { from: string; to: string; timezone: string }

export type Reports = {
  window: ReportWindow
  days: DayFidelity[]
  categories: CategoryTotal[]
  /** Per category, per week — the displacement lines are read off this. */
  categoryWeeks: Array<{ slug: string; weeks: WeekSeries[] }>
  checks: CheckPoint[]
  chores: ChoreStat[]
  goals: GoalScore[]
}

/** Monday of the ISO week a local date falls in. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export async function getReports(from: string, to: string): Promise<Reports> {
  const sql = getSql()
  const uid = userId()
  const { timezone } = await getSettings()

  // Local-time day grid with each block clipped to the days it touches.
  const dayRows = (await sql`
    with local_blocks as (
      select
        b.id,
        b.category_id,
        (b.started_at at time zone ${timezone}) as s,
        (coalesce(b.ended_at, now()) at time zone ${timezone}) as e
      from blocks b
      where b.user_id = ${uid}
        and b.started_at < (${to}::date + 1)
        and coalesce(b.ended_at, now()) >= ${from}::date
    ),
    per_day as (
      select
        d::date as day,
        lb.id,
        extract(epoch from (
          least(lb.e, d + interval '1 day') - greatest(lb.s, d)
        )) / 60.0 as minutes
      from local_blocks lb
      cross join lateral generate_series(
        date_trunc('day', lb.s),
        date_trunc('day', lb.e),
        interval '1 day'
      ) d
      where d::date between ${from}::date and ${to}::date
    )
    select
      to_char(day, 'YYYY-MM-DD') as date,
      round(sum(minutes))::int as logged_minutes,
      count(distinct id)::int as blocks
    from per_day
    where minutes > 0
    group by day
    order by day
  `) as Array<{ date: string; logged_minutes: number; blocks: number }>

  const checkRows = (await sql`
    select to_char(date, 'YYYY-MM-DD') as date, energy, moved_priority
    from daily_check
    where user_id = ${uid} and date between ${from}::date and ${to}::date
    order by date
  `) as Array<{ date: string; energy: number | null; moved_priority: boolean | null }>

  const catRows = (await sql`
    with local_blocks as (
      select
        b.category_id,
        extract(epoch from (
          least(coalesce(b.ended_at, now()), (${to}::date + 1) at time zone ${timezone})
          - greatest(b.started_at, ${from}::date at time zone ${timezone})
        )) / 3600.0 as hours,
        b.id
      from blocks b
      where b.user_id = ${uid}
        and b.started_at < (${to}::date + 1) at time zone ${timezone}
        and coalesce(b.ended_at, now()) >= ${from}::date at time zone ${timezone}
    )
    select
      c.slug, c.name, c.energy, c.value_tier, c.buyback_cost,
      round(sum(lb.hours)::numeric, 2) as hours,
      count(*)::int as blocks
    from local_blocks lb
    join categories c on c.id = lb.category_id
    where lb.hours > 0
    group by c.slug, c.name, c.energy, c.value_tier, c.buyback_cost
    order by sum(lb.hours) desc
  `) as Array<{
    slug: string
    name: string
    energy: number
    value_tier: number
    buyback_cost: string | null
    hours: string
    blocks: number
  }>

  const catWeekRows = (await sql`
    with local_blocks as (
      select
        b.category_id,
        (b.started_at at time zone ${timezone}) as s,
        (coalesce(b.ended_at, now()) at time zone ${timezone}) as e,
        b.id
      from blocks b
      where b.user_id = ${uid}
        and b.started_at < (${to}::date + 1)
        and coalesce(b.ended_at, now()) >= ${from}::date
    ),
    per_day as (
      select
        d::date as day,
        lb.category_id,
        extract(epoch from (
          least(lb.e, d + interval '1 day') - greatest(lb.s, d)
        )) / 3600.0 as hours
      from local_blocks lb
      cross join lateral generate_series(
        date_trunc('day', lb.s), date_trunc('day', lb.e), interval '1 day'
      ) d
      where d::date between ${from}::date and ${to}::date
    )
    select
      c.slug,
      to_char(date_trunc('week', day), 'YYYY-MM-DD') as week_start,
      round(sum(pd.hours)::numeric, 2) as hours
    from per_day pd
    join categories c on c.id = pd.category_id
    where pd.hours > 0
    group by c.slug, date_trunc('week', day)
    order by c.slug, date_trunc('week', day)
  `) as Array<{ slug: string; week_start: string; hours: string }>

  const choreRows = (await sql`
    select
      c.slug, c.name, c.area, c.interval_days, c.effort_minutes,
      count(cc.id)::int as completions,
      count(cc.minutes)::int as timed_completions,
      avg(cc.minutes) as actual_minutes,
      max(cc.done_on)::text as last_done_on,
      case
        when count(cc.id) > 1
        then (max(cc.done_on) - min(cc.done_on))::numeric / (count(cc.id) - 1)
      end as actual_interval_days
    from chores c
    left join chore_completions cc
      on cc.chore_id = c.id and cc.done_on between ${from}::date and ${to}::date
    where c.user_id = ${uid} and c.archived_at is null
    group by c.slug, c.name, c.area, c.interval_days, c.effort_minutes
    order by c.area nulls last, c.name
  `) as Array<{
    slug: string
    name: string
    area: string | null
    interval_days: number
    effort_minutes: number
    completions: number
    timed_completions: number
    actual_minutes: string | null
    last_done_on: string | null
    actual_interval_days: string | null
  }>

  const goalRows = (await sql`
    select g.id, g.title, g.priority_rank, g.lead_measure, g.target_count, g.target_period,
           to_char(p.period_start, 'YYYY-MM-DD') as period_start, p.done_count
    from goals g
    left join goal_progress p on p.goal_id = g.id and p.user_id = ${uid}
    where g.user_id = ${uid} and g.status = 'active' and g.archived_at is null
    order by g.priority_rank nulls last, p.period_start
  `) as Array<{
    id: string
    title: string
    priority_rank: number | null
    lead_measure: string | null
    target_count: number | null
    target_period: string
    period_start: string | null
    done_count: number | null
  }>

  // --- shape it -----------------------------------------------------------

  const checkBy = new Map(checkRows.map((r) => [r.date, r]))
  const days: DayFidelity[] = dayRows.map((r) => {
    const check = checkBy.get(r.date)
    return {
      date: r.date,
      loggedMinutes: r.logged_minutes,
      blocks: r.blocks,
      gapMinutes: Math.max(0, 1440 - r.logged_minutes),
      complete: check !== undefined,
      checked: check?.energy !== null && check?.moved_priority !== null && check !== undefined,
    }
  })

  const byCategory = new Map<string, WeekSeries[]>()
  for (const row of catWeekRows) {
    const list = byCategory.get(row.slug) ?? []
    list.push({ weekStart: mondayOf(row.week_start), hours: Number(row.hours) })
    byCategory.set(row.slug, list)
  }

  const goals = new Map<string, GoalScore>()
  for (const row of goalRows) {
    if (!goals.has(row.id)) {
      goals.set(row.id, {
        id: row.id,
        title: row.title,
        rank: row.priority_rank ?? 99,
        leadMeasure: row.lead_measure,
        targetCount: row.target_count === null ? null : Number(row.target_count),
        targetPeriod: row.target_period,
        periods: [],
      })
    }
    if (row.period_start !== null) {
      goals.get(row.id)!.periods.push({
        periodStart: row.period_start,
        doneCount: Number(row.done_count ?? 0),
      })
    }
  }

  return {
    window: { from, to, timezone },
    days,
    categories: catRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      energy: Number(r.energy),
      valueTier: Number(r.value_tier),
      buybackCost: r.buyback_cost === null ? null : Number(r.buyback_cost),
      hours: Number(r.hours),
      blocks: r.blocks,
    })),
    categoryWeeks: [...byCategory].map(([slug, weeks]) => ({ slug, weeks })),
    checks: checkRows.map((r) => ({
      date: r.date,
      energy: r.energy === null ? null : Number(r.energy),
      movedPriority: r.moved_priority,
    })),
    chores: choreRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      area: r.area,
      intervalDays: Number(r.interval_days),
      estimateMinutes: Number(r.effort_minutes),
      completions: r.completions,
      timedCompletions: r.timed_completions,
      actualMinutes: r.actual_minutes === null ? null : Math.round(Number(r.actual_minutes)),
      actualIntervalDays:
        r.actual_interval_days === null
          ? null
          : Math.round(Number(r.actual_interval_days) * 10) / 10,
      lastDoneOn: r.last_done_on,
    })),
    goals: [...goals.values()].sort((a, b) => a.rank - b.rank),
  }
}
