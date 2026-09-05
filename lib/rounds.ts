import { getSql, userId } from './db'
import {
  addDays,
  dayNumber,
  isoDate,
  suggestWeek,
  weekStart,
  type Candidate,
  type SuggestedWeek,
} from './rounds-plan'

/**
 * Rounds' data layer. Same shape as lib/goals.ts: a single `get…View` the pages
 * render, and a set of small mutations the server actions call, each throwing
 * RoundsError with a sentence fit to show the user.
 */

export class RoundsError extends Error {}

export type ChoreState = 'overdue' | 'due' | 'soon' | 'later'

export type Chore = {
  id: string
  slug: string
  name: string
  area: string | null
  intervalDays: number
  effortMinutes: number
  preferWeekend: boolean
  notes: string | null
  lastDoneOn: string | null
  dueOn: string
  /** Positive = late by this many days. Zero = due today. Negative = days of grace left. */
  daysOverdue: number
  state: ChoreState
}

export type PlanEntry = {
  id: string
  choreId: string
  name: string
  effortMinutes: number
  dueOn: string
  plannedOn: string
  status: 'planned' | 'done' | 'skipped'
  source: string
}

export type Settings = {
  dayMinutes: number[]
  notifyHour: number
  timezone: string
}

export type RoundsView = {
  today: string
  chores: Chore[]
  settings: Settings
  /** Monday of the week currently being shown. */
  weekStart: string
  plan: PlanEntry[]
  pushDevices: number
}

/** Today's date in the user's timezone, as 'YYYY-MM-DD'. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * How far ahead a chore starts reading as "coming due": a fifth of its interval,
 * between one day and a fortnight. A weekly chore warns the day before; an
 * annual one warns a fortnight out, which is about how long it takes to find a
 * Saturday for it.
 */
export function leadDays(intervalDays: number): number {
  return Math.min(14, Math.max(1, Math.round(intervalDays / 5)))
}

function stateOf(daysOverdue: number, intervalDays: number): ChoreState {
  if (daysOverdue > 0) return 'overdue'
  if (daysOverdue === 0) return 'due'
  return -daysOverdue <= leadDays(intervalDays) ? 'soon' : 'later'
}

export async function getSettings(): Promise<Settings> {
  const sql = getSql()
  const rows = (await sql`
    select day_minutes, notify_hour, timezone from chore_settings where user_id = ${userId()}
  `) as Array<{ day_minutes: number[]; notify_hour: number; timezone: string }>

  if (rows.length === 0) {
    // No row yet — the migration's defaults, so a fresh database renders rather
    // than erroring on the way to the settings screen.
    return { dayMinutes: [20, 20, 20, 20, 20, 120, 60], notifyHour: 7, timezone: 'Europe/London' }
  }
  return {
    dayMinutes: rows[0].day_minutes.map(Number),
    notifyHour: Number(rows[0].notify_hour),
    timezone: rows[0].timezone,
  }
}

export async function getChores(today: string): Promise<Chore[]> {
  const sql = getSql()
  const rows = (await sql`
    select id, slug, name, area, interval_days, effort_minutes, prefer_weekend, notes,
           last_done_on::text as last_done_on, due_on::text as due_on, sort_order
    from chore_status
    where user_id = ${userId()}
    order by sort_order, name
  `) as Array<{
    id: string
    slug: string
    name: string
    area: string | null
    interval_days: number
    effort_minutes: number
    prefer_weekend: boolean
    notes: string | null
    last_done_on: string | null
    due_on: string
  }>

  const todayNum = dayNumber(today)

  return rows.map((r) => {
    const daysOverdue = todayNum - dayNumber(r.due_on)
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      area: r.area,
      intervalDays: Number(r.interval_days),
      effortMinutes: Number(r.effort_minutes),
      preferWeekend: r.prefer_weekend,
      notes: r.notes,
      lastDoneOn: r.last_done_on,
      dueOn: r.due_on,
      daysOverdue,
      state: stateOf(daysOverdue, Number(r.interval_days)),
    }
  })
}

export async function getPlan(from: string, to: string): Promise<PlanEntry[]> {
  const sql = getSql()
  const rows = (await sql`
    select p.id, p.chore_id, c.name, c.effort_minutes, p.planned_on::text as planned_on,
           p.status, p.source, s.due_on::text as due_on
    from chore_plan p
    join chores c on c.id = p.chore_id
    join chore_status s on s.id = p.chore_id
    where p.user_id = ${userId()}
      and p.planned_on between ${from}::date and ${to}::date
    order by p.planned_on, c.name
  `) as Array<{
    id: string
    chore_id: string
    name: string
    effort_minutes: number
    planned_on: string
    status: 'planned' | 'done' | 'skipped'
    source: string
    due_on: string
  }>

  return rows.map((r) => ({
    id: r.id,
    choreId: r.chore_id,
    name: r.name,
    effortMinutes: Number(r.effort_minutes),
    dueOn: r.due_on,
    plannedOn: r.planned_on,
    status: r.status,
    source: r.source,
  }))
}

export async function getRoundsView(weekStartOverride?: string): Promise<RoundsView> {
  const sql = getSql()
  const settings = await getSettings()
  const today = todayIn(settings.timezone)
  const start = weekStartOverride ?? weekStart(today)

  const [chores, plan, devices] = await Promise.all([
    getChores(today),
    getPlan(start, addDays(start, 6)),
    sql`select count(*)::int as n from push_subscriptions
        where user_id = ${userId()} and expired_at is null`,
  ])
  const deviceCount = (devices as Array<{ n: number }>)[0]?.n ?? 0

  return {
    today,
    chores,
    settings,
    weekStart: start,
    plan,
    pushDevices: deviceCount,
  }
}

// ---------------------------------------------------------------------------
// Suggesting

/**
 * What the suggester is allowed to place: every chore due by the end of the week
 * that isn't already in that week's plan. Filtering here rather than inside
 * suggestWeek is what keeps that function pure and testable.
 */
export async function suggestForWeek(start: string): Promise<SuggestedWeek> {
  const settings = await getSettings()
  const today = todayIn(settings.timezone)
  const chores = await getChores(today)
  const existing = await getPlan(start, addDays(start, 6))

  const alreadyPlanned = new Set(
    existing.filter((p) => p.status !== 'skipped').map((p) => p.choreId)
  )

  const candidates: Candidate[] = chores
    .filter((c) => !alreadyPlanned.has(c.id))
    .map((c) => ({
      choreId: c.id,
      name: c.name,
      effortMinutes: c.effortMinutes,
      dueOn: c.dueOn,
      preferWeekend: c.preferWeekend,
    }))

  const suggestion = suggestWeek({
    weekStart: start,
    today,
    dayMinutes: settings.dayMinutes,
    candidates,
  })

  // Fold what is already planned back in, so the screen shows the real week
  // rather than only the new proposals, and the day totals stay honest.
  for (const entry of existing) {
    if (entry.status === 'skipped') continue
    const day = suggestion.days.find((d) => d.date === entry.plannedOn)
    if (!day) continue
    day.items.push({
      choreId: entry.choreId,
      name: entry.name,
      effortMinutes: entry.effortMinutes,
      dueOn: entry.dueOn,
      late: dayNumber(entry.plannedOn) > dayNumber(entry.dueOn),
    })
    day.usedMinutes += entry.effortMinutes
    suggestion.totalMinutes += entry.effortMinutes
  }

  for (const day of suggestion.days) {
    day.items.sort(
      (a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn) || a.name.localeCompare(b.name)
    )
  }

  return suggestion
}

/**
 * Persist a whole week at once: everything on the board, nothing else.
 *
 * The planner edits a local copy of the week and saves it in one go, rather than
 * firing an action per drag. That makes the save idempotent — what you see is
 * what ends up in the table — and means a half-finished shuffle never leaves a
 * chore planned twice. Rows already done or skipped are left alone; they are
 * history, not plan.
 */
export async function saveWeekPlan(
  start: string,
  items: Array<{ choreId: string; date: string }>
): Promise<void> {
  const sql = getSql()
  const uid = userId()
  const end = addDays(start, 6)

  for (const item of items) {
    if (dayNumber(item.date) < dayNumber(start) || dayNumber(item.date) > dayNumber(end)) {
      throw new RoundsError('That day is outside the week being planned')
    }
  }

  await sql`
    delete from chore_plan
    where user_id = ${uid} and status = 'planned'
      and planned_on between ${start}::date and ${end}::date
  `

  for (const item of items) {
    await sql`
      insert into chore_plan (user_id, chore_id, planned_on, source)
      values (${uid}, ${item.choreId}, ${item.date}::date, 'manual')
      on conflict (user_id, chore_id, planned_on)
        do update set status = 'planned', source = 'manual'
    `
  }
}

// ---------------------------------------------------------------------------
// Mutations

/**
 * Mark a chore done. Recording the completion is what moves its due date, so
 * that is the write that matters; closing the plan row is bookkeeping.
 */
export async function completeChore(
  choreId: string,
  doneOn: string,
  minutes: number | null,
  note: string | null
): Promise<void> {
  const sql = getSql()
  const uid = userId()

  const chore = (await sql`
    select id from chores where id = ${choreId} and user_id = ${uid}
  `) as Array<{ id: string }>
  if (chore.length === 0) throw new RoundsError('That chore no longer exists')

  await sql`
    insert into chore_completions (user_id, chore_id, done_on, minutes, note)
    values (${uid}, ${choreId}, ${doneOn}::date, ${minutes}, ${note})
  `
  // Close any nearby planned row, including one planned for later this week —
  // doing a chore early should clear it off the plan, not leave a ghost.
  await sql`
    update chore_plan set status = 'done'
    where user_id = ${uid} and chore_id = ${choreId} and status = 'planned'
      and planned_on between ${doneOn}::date - 7 and ${doneOn}::date + 7
  `
}

/** Undo the most recent completion — the tap you made on the wrong row. */
export async function undoCompletion(choreId: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  const rows = (await sql`
    select id from chore_completions
    where user_id = ${uid} and chore_id = ${choreId}
    order by done_on desc, created_at desc limit 1
  `) as Array<{ id: string }>

  if (rows.length === 0) throw new RoundsError('Nothing to undo — that chore has never been logged')

  await sql`delete from chore_completions where id = ${rows[0].id}`
  await sql`
    update chore_plan set status = 'planned'
    where user_id = ${uid} and chore_id = ${choreId} and status = 'done'
      and planned_on >= current_date - 14
  `
}

export async function skipPlanned(planId: string): Promise<void> {
  const sql = getSql()
  const rows = (await sql`
    update chore_plan set status = 'skipped'
    where id = ${planId} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new RoundsError('That is no longer on the plan')
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export type ChoreInput = {
  name: string
  area: string | null
  intervalDays: number
  effortMinutes: number
  preferWeekend: boolean
  notes: string | null
  /** Only read when creating: when this thing was last done, if ever. */
  lastDoneOn?: string | null
}

function validate(input: ChoreInput): void {
  if (!input.name.trim()) throw new RoundsError('A chore needs a name')
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 3650) {
    throw new RoundsError('Interval must be between 1 and 3650 days')
  }
  if (
    !Number.isInteger(input.effortMinutes) ||
    input.effortMinutes < 1 ||
    input.effortMinutes > 480
  ) {
    throw new RoundsError('Effort must be between 1 and 480 minutes')
  }
}

export async function createChore(input: ChoreInput): Promise<void> {
  validate(input)
  const sql = getSql()
  const uid = userId()
  const settings = await getSettings()
  const today = todayIn(settings.timezone)

  // A chore you last did on Sunday is next due an interval on from then, not
  // from now. Setting first_due_on rather than writing a completion keeps the
  // log honest: it records chores you did, not chores you told us about.
  const firstDue = input.lastDoneOn
    ? isoDate(dayNumber(input.lastDoneOn) + input.intervalDays)
    : today

  const base = slugify(input.name) || 'chore'
  const rows = (await sql`
    select slug from chores where user_id = ${uid} and slug like ${base + '%'}
  `) as Array<{ slug: string }>
  const taken = new Set(rows.map((r) => r.slug))
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`

  await sql`
    insert into chores
      (user_id, slug, name, area, interval_days, effort_minutes, prefer_weekend, notes,
       first_due_on, sort_order)
    values
      (${uid}, ${slug}, ${input.name.trim()}, ${input.area}, ${input.intervalDays},
       ${input.effortMinutes}, ${input.preferWeekend}, ${input.notes}, ${firstDue}::date,
       coalesce((select max(sort_order) + 1 from chores where user_id = ${uid}), 0))
  `
}

export async function updateChore(id: string, input: ChoreInput): Promise<void> {
  validate(input)
  const sql = getSql()
  const rows = (await sql`
    update chores set
      name = ${input.name.trim()},
      area = ${input.area},
      interval_days = ${input.intervalDays},
      effort_minutes = ${input.effortMinutes},
      prefer_weekend = ${input.preferWeekend},
      notes = ${input.notes}
    where id = ${id} and user_id = ${userId()} and archived_at is null
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new RoundsError('That chore no longer exists')
}

export async function archiveChore(id: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  await sql`update chores set archived_at = now() where id = ${id} and user_id = ${uid}`
  await sql`
    delete from chore_plan where chore_id = ${id} and user_id = ${uid} and status = 'planned'
  `
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (settings.dayMinutes.length !== 7 || settings.dayMinutes.some((m) => m < 0 || m > 720)) {
    throw new RoundsError('Each day needs a capacity between 0 and 720 minutes')
  }
  if (
    !Number.isInteger(settings.notifyHour) ||
    settings.notifyHour < 0 ||
    settings.notifyHour > 23
  ) {
    throw new RoundsError('Notify hour must be between 0 and 23')
  }
  const sql = getSql()
  await sql`
    insert into chore_settings (user_id, day_minutes, notify_hour, timezone, updated_at)
    values (${userId()}, ${settings.dayMinutes}, ${settings.notifyHour}, ${settings.timezone}, now())
    on conflict (user_id) do update set
      day_minutes = excluded.day_minutes,
      notify_hour = excluded.notify_hour,
      timezone = excluded.timezone,
      updated_at = now()
  `
}
