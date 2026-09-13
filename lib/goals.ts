import { getSql, userId } from './db'

/**
 * Goals (build-plan §3, §5). Flat for now: five active goals at horizon
 * 'current', ranked by hand.
 *
 * The rank is a DECLARATION and the hours are a MEASUREMENT. Keeping them apart
 * is the entire point of the allocation report — so nothing here ever derives
 * one from the other.
 *
 * `parent_id` and the longer horizons exist in the schema and are deliberately
 * not exposed yet: the cascade wants four weeks of energy data as its input.
 */

export const MAX_ACTIVE_GOALS = 5

/** The cadence a lead measure runs on. Weeks for habits, months for projects. */
export type TargetPeriod = 'week' | 'month'

export type Milestone = {
  id: string
  title: string
  /** YYYY-MM-DD, or null for "no date yet" — which is itself worth seeing. */
  dueOn: string | null
  doneOn: string | null
}

export type GoalRow = {
  id: string
  title: string
  rank: number
  /** Hours per week for the last four weeks, oldest first. */
  weeks: number[]
  categories: Array<{ slug: string; name: string }>
  /**
   * The 4DX lead measure, written as an implementation intention: when, where,
   * and for how long. `targetCount` times per `targetPeriod`, `sessionMinutes`
   * each — that is the time target, and it sits on the session rather than on
   * the goal, because "half an hour on Sunday" is a commitment you can keep and
   * "two hours a week on my marriage" is not a thing anyone can do.
   */
  leadMeasure: string | null
  targetCount: number | null
  targetPeriod: TargetPeriod
  sessionMinutes: number | null
  /** Atomic Habits' two-minute version: what counts on the worst day. */
  twoMinute: string | null
  /** WOOP: the obstacle named in advance, ideally as an if-then. */
  obstacle: string | null
  /** Entered by hand. Sessions done in the current period. */
  done: number
  /**
   * The last four periods, oldest first, current period last. Periods with no
   * row read 0 — an unanswered week and a zero week are the same thing here,
   * which is the honest reading of a scoreboard nobody filled in.
   */
  history: Array<{ periodStart: string; done: number }>
  /**
   * Two consecutive *completed* periods at zero, after the habit had actually
   * started. Clear's rule is never miss twice, so this is the only state on the
   * page that asks for a reaction — which is exactly why a goal written this
   * morning must not display it. A scoreboard that opens on a warning is the
   * same failure as a report that opens at 0.0h: it says nothing about you.
   */
  missedTwice: boolean
  milestones: Milestone[]
}

/**
 * The current period start for each cadence, as YYYY-MM-DD.
 *
 * Computed in the browser and sent with every read and write. Tally already
 * derives the reconcile day from the browser's local midnight for the same
 * reason: the server has no idea which week the person reading the screen is
 * in, and a goal ticked on Sunday night must not land in next week.
 */
export type Periods = { week: string; month: string }

export type CategoryRow = {
  slug: string
  name: string
  energy: number
  goalId: string | null
  hoursThisWeek: number
}

export type GoalsView = {
  goals: GoalRow[]
  categories: CategoryRow[]
  atCap: boolean
  /** Hours logged this week against no goal at all. */
  unassignedHours: number
}

export class GoalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoalError'
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The server's guess at the current periods, used for the first paint only.
 * The client sends its own the moment it mounts, so a server in UTC and a
 * person in New York disagree for one render and no writes.
 */
export function defaultPeriods(): Periods {
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return { week: ymd(monday), month: ymd(new Date(now.getFullYear(), now.getMonth(), 1)) }
}

/** `steps` periods before `start`. Dates only — no clocks, so no DST to get wrong. */
function stepBack(start: string, period: TargetPeriod, steps: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (period === 'week') date.setDate(date.getDate() - steps * 7)
  else date.setMonth(date.getMonth() - steps)
  return ymd(date)
}

function weekKeys(weekStart: string): string[] {
  return [3, 2, 1, 0].map((back) => stepBack(weekStart, 'week', back))
}

export async function getGoalsView(periods: Periods = defaultPeriods()): Promise<GoalsView> {
  const sql = getSql()
  const uid = userId()

  const goals = (await sql`
    select id, title, priority_rank, lead_measure, target_count, target_period,
           session_minutes, two_minute, obstacle
    from goals
    where user_id = ${uid} and horizon = 'current' and status = 'active' and archived_at is null
    order by priority_rank asc nulls last, created_at asc
  `) as Array<{
    id: string
    title: string
    priority_rank: number | null
    lead_measure: string | null
    target_count: number | null
    target_period: TargetPeriod
    session_minutes: number | null
    two_minute: string | null
    obstacle: string | null
  }>

  const categories = (await sql`
    select slug, name, energy, default_goal_id
    from categories
    where user_id = ${uid} and archived_at is null
    order by is_quick desc, sort_order asc
  `) as Array<{ slug: string; name: string; energy: number; default_goal_id: string | null }>

  // Hours come from what was actually logged against each goal, never from the
  // current mapping — a block keeps the goal it was created with.
  const perGoalWeek = (await sql`
    select
      goal_id,
      to_char(date_trunc('week', started_at), 'YYYY-MM-DD') as week_start,
      sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) / 3600.0 as hours
    from blocks
    where user_id = ${uid}
      and goal_id is not null
      and started_at >= date_trunc('week', now()) - interval '3 weeks'
    group by 1, 2
  `) as Array<{ goal_id: string; week_start: string; hours: string }>

  const perCategoryWeek = (await sql`
    select
      c.slug,
      sum(extract(epoch from (coalesce(b.ended_at, now()) - b.started_at))) / 3600.0 as hours
    from blocks b join categories c on c.id = b.category_id
    where b.user_id = ${uid} and b.started_at >= date_trunc('week', now())
    group by 1
  `) as Array<{ slug: string; hours: string }>

  const unassigned = (await sql`
    select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) / 3600.0, 0) as hours
    from blocks
    where user_id = ${uid} and goal_id is null and started_at >= date_trunc('week', now())
  `) as Array<{ hours: string }>

  // Manual entry, so everything is read back; five goals of weekly rows is a
  // few hundred narrow rows a year and grouping in JS keeps the period maths
  // in one place rather than half in SQL.
  const progress = (await sql`
    select goal_id, period_start::text as period_start, done_count
    from goal_progress
    where user_id = ${uid}
    order by period_start desc
  `) as Array<{ goal_id: string; period_start: string; done_count: number }>

  const milestones = (await sql`
    select id, goal_id, title, due_on::text as due_on, done_on::text as done_on
    from goal_milestones
    where user_id = ${uid}
    order by sort_order asc, created_at asc
  `) as Array<{
    id: string
    goal_id: string
    title: string
    due_on: string | null
    done_on: string | null
  }>

  const byProgress = new Map<string, Map<string, number>>()
  for (const row of progress) {
    if (!byProgress.has(row.goal_id)) byProgress.set(row.goal_id, new Map())
    byProgress.get(row.goal_id)!.set(row.period_start, Number(row.done_count))
  }

  const keys = weekKeys(periods.week)
  const byGoal = new Map<string, Map<string, number>>()
  for (const row of perGoalWeek) {
    if (!byGoal.has(row.goal_id)) byGoal.set(row.goal_id, new Map())
    byGoal.get(row.goal_id)!.set(row.week_start, Number(row.hours))
  }
  const catHours = new Map(perCategoryWeek.map((r) => [r.slug, Number(r.hours)]))

  return {
    goals: goals.map((goal, index) => {
      const period = goal.target_period === 'month' ? 'month' : 'week'
      const currentPeriod = period === 'month' ? periods.month : periods.week
      const entered = byProgress.get(goal.id)
      const history = [3, 2, 1, 0].map((back) => {
        const periodStart = stepBack(currentPeriod, period, back)
        return { periodStart, done: entered?.get(periodStart) ?? 0 }
      })
      // The current period is still running, so it can't have been missed yet.
      const completed = history.slice(0, -1)
      // The first period that ever got a number. Before it, a zero is a habit
      // that hadn't started, not a habit that lapsed.
      const started = entered
        ? [...entered.entries()]
            .filter(([, done]) => done > 0)
            .map(([periodStart]) => periodStart)
            .sort()[0]
        : undefined
      const missedRun = completed.slice(-2)

      return {
        id: goal.id,
        title: goal.title,
        rank: goal.priority_rank ?? index + 1,
        weeks: keys.map((k) => Math.round((byGoal.get(goal.id)?.get(k) ?? 0) * 10) / 10),
        categories: categories
          .filter((c) => c.default_goal_id === goal.id)
          .map((c) => ({ slug: c.slug, name: c.name })),
        leadMeasure: goal.lead_measure,
        targetCount: goal.target_count === null ? null : Number(goal.target_count),
        targetPeriod: period,
        sessionMinutes: goal.session_minutes === null ? null : Number(goal.session_minutes),
        twoMinute: goal.two_minute,
        obstacle: goal.obstacle,
        done: history[history.length - 1].done,
        history,
        missedTwice:
          missedRun.length === 2 &&
          missedRun.every((p) => p.done === 0) &&
          started !== undefined &&
          started < missedRun[0].periodStart,
        milestones: milestones
          .filter((m) => m.goal_id === goal.id)
          .map((m) => ({ id: m.id, title: m.title, dueOn: m.due_on, doneOn: m.done_on })),
      }
    }),
    categories: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      energy: Number(c.energy),
      goalId: c.default_goal_id,
      hoursThisWeek: Math.round((catHours.get(c.slug) ?? 0) * 10) / 10,
    })),
    atCap: goals.length >= MAX_ACTIVE_GOALS,
    unassignedHours: Math.round(Number(unassigned[0].hours) * 10) / 10,
  }
}

/** Renumber active goals 1..n so ranks stay contiguous after any change. */
async function renumber(): Promise<void> {
  const sql = getSql()
  await sql`
    with ordered as (
      select id, row_number() over (order by priority_rank asc nulls last, created_at asc) as rn
      from goals
      where user_id = ${userId()} and horizon = 'current' and status = 'active' and archived_at is null
    )
    update goals g set priority_rank = ordered.rn
    from ordered where g.id = ordered.id
  `
}

export async function createGoal(title: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  const clean = title.trim()
  if (!clean) throw new GoalError('A goal needs a title')
  if (clean.length > 120) throw new GoalError('Keep the title under 120 characters')

  const count = (await sql`
    select count(*)::int as n from goals
    where user_id = ${uid} and horizon = 'current' and status = 'active' and archived_at is null
  `) as Array<{ n: number }>

  // The cap is the feature. Six priorities is no priorities.
  if (count[0].n >= MAX_ACTIVE_GOALS) {
    throw new GoalError(`${MAX_ACTIVE_GOALS} is the cap — archive one first`)
  }

  await sql`
    insert into goals (user_id, title, horizon, priority_rank, status)
    values (${uid}, ${clean}, 'current', ${count[0].n + 1}, 'active')
  `
  await renumber()
}

export async function renameGoal(id: string, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) throw new GoalError('A goal needs a title')
  const sql = getSql()
  const rows = (await sql`
    update goals set title = ${clean}
    where id = ${id} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new GoalError('Goal not found')
}

/** Move a goal up or down the declared order, swapping with its neighbour. */
export async function moveGoal(id: string, direction: 'up' | 'down'): Promise<void> {
  const sql = getSql()
  const uid = userId()

  const goals = (await sql`
    select id, priority_rank from goals
    where user_id = ${uid} and horizon = 'current' and status = 'active' and archived_at is null
    order by priority_rank asc nulls last, created_at asc
  `) as Array<{ id: string; priority_rank: number | null }>

  const index = goals.findIndex((g) => g.id === id)
  if (index === -1) throw new GoalError('Goal not found')
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= goals.length) return

  const a = goals[index]
  const b = goals[target]
  await sql.transaction([
    sql`update goals set priority_rank = ${target + 1} where id = ${a.id} and user_id = ${uid}`,
    sql`update goals set priority_rank = ${index + 1} where id = ${b.id} and user_id = ${uid}`,
  ])
  await renumber()
}

/**
 * Archive a goal. Blocks already logged against it keep pointing at it, so the
 * history stays intact; categories defaulting to it fall back to no goal.
 */
export async function archiveGoal(id: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  await sql.transaction([
    sql`update categories set default_goal_id = null where user_id = ${uid} and default_goal_id = ${id}`,
    sql`update goals set status = 'archived', archived_at = now(), priority_rank = null
        where id = ${id} and user_id = ${uid}`,
  ])
  await renumber()
}

/**
 * Point a category at a goal. New blocks inherit it; blocks already logged are
 * left alone, because rewriting history here would silently change every past
 * week's allocation report.
 */
export async function setCategoryGoal(slug: string, goalId: string | null): Promise<void> {
  const sql = getSql()
  const uid = userId()

  if (goalId) {
    const rows = (await sql`
      select id from goals where id = ${goalId} and user_id = ${uid} and archived_at is null
    `) as Array<{ id: string }>
    if (rows.length === 0) throw new GoalError('Goal not found')
  }

  const rows = (await sql`
    update categories set default_goal_id = ${goalId}
    where user_id = ${uid} and slug = ${slug}
    returning slug
  `) as Array<{ slug: string }>
  if (rows.length === 0) throw new GoalError('Category not found')
}

/** What a lead measure is made of, as the edit form sends it. */
export type GoalPlan = {
  leadMeasure: string
  targetCount: string
  targetPeriod: TargetPeriod
  sessionMinutes: string
  twoMinute: string
  obstacle: string
}

function optionalText(value: string, field: string, max = 400): string | null {
  const clean = value.trim()
  if (!clean) return null
  if (clean.length > max) throw new GoalError(`Keep ${field} under ${max} characters`)
  return clean
}

/**
 * A count field that is allowed to be blank. Blank means "no target set", which
 * is a real state — C's lead measure is still pending — and reads differently
 * from a target of zero.
 */
function optionalCount(value: string, field: string, max: number): number | null {
  const clean = value.trim()
  if (!clean) return null
  const n = Number(clean)
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new GoalError(`${field} needs a whole number between 1 and ${max}`)
  }
  return n
}

/** Set the lead measure, the cadence and the time box on a goal. */
export async function setGoalPlan(id: string, plan: GoalPlan): Promise<void> {
  const sql = getSql()
  if (plan.targetPeriod !== 'week' && plan.targetPeriod !== 'month') {
    throw new GoalError('A target runs per week or per month')
  }

  const rows = (await sql`
    update goals set
      lead_measure    = ${optionalText(plan.leadMeasure, 'the lead measure')},
      target_count    = ${optionalCount(plan.targetCount, 'The target', 99)},
      target_period   = ${plan.targetPeriod},
      session_minutes = ${optionalCount(plan.sessionMinutes, 'The session length', 600)},
      two_minute      = ${optionalText(plan.twoMinute, 'the two-minute version', 200)},
      obstacle        = ${optionalText(plan.obstacle, 'the obstacle', 300)}
    where id = ${id} and user_id = ${userId()} and archived_at is null
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new GoalError('Goal not found')
}

/**
 * Record how many sessions happened in a period. Entered by hand, upserted on
 * the period, and never derived from anything — see 0012_goal_targets.sql.
 */
export async function setProgress(
  goalId: string,
  periodStart: string,
  done: number
): Promise<void> {
  if (!ISO_DATE.test(periodStart)) throw new GoalError('That period is not a date')
  if (!Number.isInteger(done) || done < 0 || done > 99) {
    throw new GoalError('Sessions done has to be between 0 and 99')
  }

  const sql = getSql()
  const uid = userId()
  const owned = (await sql`
    select id from goals where id = ${goalId} and user_id = ${uid} and archived_at is null
  `) as Array<{ id: string }>
  if (owned.length === 0) throw new GoalError('Goal not found')

  await sql`
    insert into goal_progress (user_id, goal_id, period_start, done_count)
    values (${uid}, ${goalId}, ${periodStart}::date, ${done})
    on conflict (user_id, goal_id, period_start)
    do update set done_count = excluded.done_count, updated_at = now()
  `
}

export async function addMilestone(
  goalId: string,
  title: string,
  dueOn: string
): Promise<void> {
  const clean = title.trim()
  if (!clean) throw new GoalError('A milestone needs a title')
  if (clean.length > 160) throw new GoalError('Keep the milestone under 160 characters')
  const due = dueOn.trim()
  if (due && !ISO_DATE.test(due)) throw new GoalError('That due date is not a date')

  const sql = getSql()
  const uid = userId()
  const owned = (await sql`
    select id from goals where id = ${goalId} and user_id = ${uid} and archived_at is null
  `) as Array<{ id: string }>
  if (owned.length === 0) throw new GoalError('Goal not found')

  // New milestones go on the end; the order is the order they were planned in,
  // which for a dated chain is usually the order they happen in.
  const next = (await sql`
    select coalesce(max(sort_order), -1) + 1 as n from goal_milestones
    where user_id = ${uid} and goal_id = ${goalId}
  `) as Array<{ n: number }>

  await sql`
    insert into goal_milestones (user_id, goal_id, title, due_on, sort_order)
    values (${uid}, ${goalId}, ${clean}, ${due || null}, ${next[0].n})
  `
}

export async function updateMilestone(
  id: string,
  title: string,
  dueOn: string
): Promise<void> {
  const clean = title.trim()
  if (!clean) throw new GoalError('A milestone needs a title')
  if (clean.length > 160) throw new GoalError('Keep the milestone under 160 characters')
  const due = dueOn.trim()
  if (due && !ISO_DATE.test(due)) throw new GoalError('That due date is not a date')

  const sql = getSql()
  const rows = (await sql`
    update goal_milestones set title = ${clean}, due_on = ${due || null}
    where id = ${id} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new GoalError('Milestone not found')
}

/**
 * Tick or untick a milestone. `today` comes from the browser for the same
 * reason the period does — a milestone finished at 11pm belongs to that day.
 */
export async function setMilestoneDone(
  id: string,
  done: boolean,
  today: string
): Promise<void> {
  if (done && !ISO_DATE.test(today)) throw new GoalError('That date is not a date')

  const sql = getSql()
  const rows = (await sql`
    update goal_milestones set done_on = ${done ? today : null}
    where id = ${id} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new GoalError('Milestone not found')
}

export async function deleteMilestone(id: string): Promise<void> {
  const sql = getSql()
  const rows = (await sql`
    delete from goal_milestones where id = ${id} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new GoalError('Milestone not found')
}
