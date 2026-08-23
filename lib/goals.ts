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

export type GoalRow = {
  id: string
  title: string
  rank: number
  /** Hours per week for the last four weeks, oldest first. */
  weeks: number[]
  categories: Array<{ slug: string; name: string }>
}

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

function weekKeys(): string[] {
  const keys: string[] = []
  const now = new Date()
  const monday = new Date(now)
  const dow = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - dow)
  monday.setHours(0, 0, 0, 0)
  for (let i = 3; i >= 0; i--) {
    const d = new Date(monday.getTime() - i * 7 * 86_400_000)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return keys
}

export async function getGoalsView(): Promise<GoalsView> {
  const sql = getSql()
  const uid = userId()

  const goals = (await sql`
    select id, title, priority_rank
    from goals
    where user_id = ${uid} and horizon = 'current' and status = 'active' and archived_at is null
    order by priority_rank asc nulls last, created_at asc
  `) as Array<{ id: string; title: string; priority_rank: number | null }>

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

  const keys = weekKeys()
  const byGoal = new Map<string, Map<string, number>>()
  for (const row of perGoalWeek) {
    if (!byGoal.has(row.goal_id)) byGoal.set(row.goal_id, new Map())
    byGoal.get(row.goal_id)!.set(row.week_start, Number(row.hours))
  }
  const catHours = new Map(perCategoryWeek.map((r) => [r.slug, Number(r.hours)]))

  return {
    goals: goals.map((goal, index) => ({
      id: goal.id,
      title: goal.title,
      rank: goal.priority_rank ?? index + 1,
      weeks: keys.map((k) => Math.round((byGoal.get(goal.id)?.get(k) ?? 0) * 10) / 10),
      categories: categories
        .filter((c) => c.default_goal_id === goal.id)
        .map((c) => ({ slug: c.slug, name: c.name })),
    })),
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
