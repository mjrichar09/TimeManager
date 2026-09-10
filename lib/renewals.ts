import { getSql, userId } from './db'
import { dayNumber } from './rounds-plan'
import { RoundsError } from './rounds'

/**
 * Renewals — dated obligations that cannot be done early.
 *
 * See db/migrations/0010_renewals.sql for why these are not chores. The short
 * version: a chore's due date is derived from its completion log, a renewal's
 * is imposed from outside and does not move when you act early.
 */

/**
 * How loud a renewal is right now.
 *
 *   'later'   — beyond its lead time. Silent.
 *   'lead'    — inside its lead time. The first thing that should ever be said.
 *   'urgent'  — a week or less. Different words, because a week is when a
 *               passport stops being a task and becomes a problem.
 *   'overdue' — the date has passed. For most of these that means expired.
 */
export type RenewalStage = 'later' | 'lead' | 'urgent' | 'overdue'

/** A week out is 'urgent' regardless of how long the lead time was. */
export const URGENT_DAYS = 7

export type Renewal = {
  id: string
  slug: string
  name: string
  category: string | null
  dueOn: string
  periodMonths: number | null
  leadDays: number
  notes: string | null
  /** Positive = days remaining. Zero = due today. Negative = days expired. */
  daysUntil: number
  stage: RenewalStage
  lastCompletedOn: string | null
}

export type RenewalsView = {
  today: string
  renewals: Renewal[]
}

export type RenewalInput = {
  name: string
  category: string | null
  dueOn: string
  periodMonths: number | null
  leadDays: number
  notes: string | null
}

/**
 * Pure, and deliberately so — the cron decides what to announce with this, the
 * page colours rows with it, and a test covers it without a database.
 */
export function stageOf(daysUntil: number, leadDays: number): RenewalStage {
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= URGENT_DAYS) return 'urgent'
  return daysUntil <= leadDays ? 'lead' : 'later'
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Add whole months to a date, clamping to the end of the target month.
 *
 * 31 January plus one month is 28 February, not 3 March. JavaScript's Date
 * rolls over, which would silently walk a renewal forward a few days every
 * cycle — over a passport's ten years that is a real drift.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return base || 'renewal'
}

function validate(input: RenewalInput): void {
  if (!input.name.trim()) throw new RoundsError('A renewal needs a name')
  if (input.name.length > 120) throw new RoundsError('Keep the name under 120 characters')
  if (!ISO_DATE.test(input.dueOn)) throw new RoundsError('Give the due date as YYYY-MM-DD')
  if (input.leadDays < 1 || input.leadDays > 730) {
    throw new RoundsError('Warn me between 1 and 730 days ahead')
  }
  if (input.periodMonths !== null && (input.periodMonths < 1 || input.periodMonths > 240)) {
    throw new RoundsError('A cycle runs between 1 and 240 months')
  }
}

export async function getRenewals(today: string): Promise<Renewal[]> {
  const sql = getSql()
  const rows = (await sql`
    select r.id, r.slug, r.name, r.category, r.due_on::text as due_on,
           r.period_months, r.lead_days, r.notes, r.sort_order,
           last.completed_on::text as last_completed_on
    from renewals r
    left join lateral (
      select completed_on from renewal_events e
      where e.renewal_id = r.id
      order by e.completed_on desc
      limit 1
    ) last on true
    where r.user_id = ${userId()} and r.archived_at is null
    order by r.due_on, r.name
  `) as Array<{
    id: string
    slug: string
    name: string
    category: string | null
    due_on: string
    period_months: number | null
    lead_days: number
    notes: string | null
    last_completed_on: string | null
  }>

  const todayNum = dayNumber(today)

  return rows.map((r) => {
    const leadDays = Number(r.lead_days)
    const daysUntil = dayNumber(r.due_on) - todayNum
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      dueOn: r.due_on,
      periodMonths: r.period_months === null ? null : Number(r.period_months),
      leadDays,
      notes: r.notes,
      daysUntil,
      stage: stageOf(daysUntil, leadDays),
      lastCompletedOn: r.last_completed_on,
    }
  })
}

export async function createRenewal(input: RenewalInput): Promise<void> {
  validate(input)
  const sql = getSql()
  const uid = userId()
  const slug = slugify(input.name)

  const rows = (await sql`
    insert into renewals (user_id, slug, name, category, due_on, period_months, lead_days, notes)
    values (${uid}, ${slug}, ${input.name.trim()}, ${input.category}, ${input.dueOn}::date,
            ${input.periodMonths}, ${input.leadDays}, ${input.notes})
    on conflict (user_id, slug) do nothing
    returning id
  `) as Array<{ id: string }>

  if (rows.length === 0) throw new RoundsError('You already have one by that name')
}

export async function updateRenewal(id: string, input: RenewalInput): Promise<void> {
  validate(input)
  const sql = getSql()
  const rows = (await sql`
    update renewals set
      name = ${input.name.trim()},
      category = ${input.category},
      due_on = ${input.dueOn}::date,
      period_months = ${input.periodMonths},
      lead_days = ${input.leadDays},
      notes = ${input.notes}
    where id = ${id} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new RoundsError('Renewal not found')
}

export async function archiveRenewal(id: string): Promise<void> {
  const sql = getSql()
  const rows = (await sql`
    update renewals set archived_at = now()
    where id = ${id} and user_id = ${userId()} and archived_at is null
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new RoundsError('Renewal not found')
}

/**
 * Mark a renewal done.
 *
 * `newDueOn` is explicit when the paperwork tells you the real new date, which
 * is the case you should trust over any arithmetic. Otherwise the next due date
 * is the OLD due date plus the cycle — never `completedOn` plus the cycle. That
 * is the whole distinction from a chore: renewing an inspection a fortnight
 * early does not buy you a fortnight, and an app that quietly said otherwise
 * would walk the date backwards a little every year.
 */
export async function completeRenewal(
  id: string,
  completedOn: string,
  newDueOn: string | null,
  note: string | null
): Promise<void> {
  if (!ISO_DATE.test(completedOn)) throw new RoundsError('Give the date as YYYY-MM-DD')
  if (newDueOn !== null && !ISO_DATE.test(newDueOn)) {
    throw new RoundsError('Give the new due date as YYYY-MM-DD')
  }

  const sql = getSql()
  const uid = userId()

  const rows = (await sql`
    select due_on::text as due_on, period_months from renewals
    where id = ${id} and user_id = ${uid} and archived_at is null
  `) as Array<{ due_on: string; period_months: number | null }>
  if (rows.length === 0) throw new RoundsError('Renewal not found')

  const previousDue = rows[0].due_on
  const period = rows[0].period_months === null ? null : Number(rows[0].period_months)

  const nextDue = newDueOn ?? (period === null ? null : addMonths(previousDue, period))
  if (nextDue === null) {
    throw new RoundsError('This one has no fixed cycle — enter the new due date')
  }
  if (dayNumber(nextDue) <= dayNumber(previousDue)) {
    throw new RoundsError('The new due date has to be after the old one')
  }

  await sql.transaction([
    sql`
      insert into renewal_events (user_id, renewal_id, completed_on, previous_due_on, new_due_on, note)
      values (${uid}, ${id}, ${completedOn}::date, ${previousDue}::date, ${nextDue}::date, ${note})
    `,
    // Clearing the alert columns is what re-arms the warnings for the new cycle.
    sql`
      update renewals
      set due_on = ${nextDue}::date, alert_due_on = null, alert_stage = null, alerted_on = null
      where id = ${id} and user_id = ${uid}
    `,
  ])
}

/** Undo the most recent renewal, putting the due date back where it was. */
export async function undoRenewal(id: string): Promise<void> {
  const sql = getSql()
  const uid = userId()

  const rows = (await sql`
    select id, previous_due_on::text as previous_due_on from renewal_events
    where renewal_id = ${id} and user_id = ${uid}
    order by completed_on desc, created_at desc
    limit 1
  `) as Array<{ id: string; previous_due_on: string }>
  if (rows.length === 0) throw new RoundsError('Nothing to undo')

  await sql.transaction([
    sql`delete from renewal_events where id = ${rows[0].id} and user_id = ${uid}`,
    sql`
      update renewals
      set due_on = ${rows[0].previous_due_on}::date,
          alert_due_on = null, alert_stage = null, alerted_on = null
      where id = ${id} and user_id = ${uid}
    `,
  ])
}

export async function getRenewalsView(today: string): Promise<RenewalsView> {
  return { today, renewals: await getRenewals(today) }
}

/**
 * The renewals worth announcing this morning, and the bookkeeping that stops
 * them being announced again tomorrow.
 *
 * A renewal speaks when it ENTERS a stage, not while it sits in one — otherwise
 * a passport with a 180-day lead time would say the same thing every morning
 * for six months and be muted within a week. The one exception is 'overdue',
 * which repeats weekly, because an expired licence genuinely is news again.
 */
export function shouldAlert(
  renewal: Pick<Renewal, 'stage' | 'dueOn'>,
  record: { alertDueOn: string | null; alertStage: string | null; alertedOn: string | null },
  today: string
): boolean {
  if (renewal.stage === 'later') return false
  // A different due date means a new cycle, so whatever was said last time is
  // about a renewal that no longer exists.
  if (record.alertDueOn !== renewal.dueOn) return true
  if (record.alertStage !== renewal.stage) return true
  if (renewal.stage === 'overdue') {
    if (!record.alertedOn) return true
    return dayNumber(today) - dayNumber(record.alertedOn) >= 7
  }
  return false
}

export type RenewalAlert = { id: string; name: string; daysUntil: number; stage: RenewalStage }

export async function dueAlerts(today: string): Promise<RenewalAlert[]> {
  const sql = getSql()
  const rows = (await sql`
    select id, name, due_on::text as due_on, lead_days,
           alert_due_on::text as alert_due_on, alert_stage, alerted_on::text as alerted_on
    from renewals
    where user_id = ${userId()} and archived_at is null
    order by due_on
  `) as Array<{
    id: string
    name: string
    due_on: string
    lead_days: number
    alert_due_on: string | null
    alert_stage: string | null
    alerted_on: string | null
  }>

  const todayNum = dayNumber(today)

  return rows
    .map((r) => {
      const daysUntil = dayNumber(r.due_on) - todayNum
      const stage = stageOf(daysUntil, Number(r.lead_days))
      const speak = shouldAlert(
        { stage, dueOn: r.due_on },
        { alertDueOn: r.alert_due_on, alertStage: r.alert_stage, alertedOn: r.alerted_on },
        today
      )
      return speak ? { id: r.id, name: r.name, daysUntil, stage } : null
    })
    .filter((a): a is RenewalAlert => a !== null)
}

/**
 * Record that these were announced, so tomorrow stays quiet.
 *
 * Takes the stage the caller already computed rather than recomputing it in
 * SQL. Re-deriving it here would put a second copy of `stageOf` in the database
 * that could disagree with the one that decided to send — and the failure would
 * be silent, showing up only as a renewal that alerts every morning or never
 * again.
 */
export async function markAlerted(alerts: RenewalAlert[], today: string): Promise<void> {
  if (alerts.length === 0) return
  const sql = getSql()
  await sql`
    update renewals r
    set alert_due_on = r.due_on,
        alert_stage = incoming.stage,
        alerted_on = ${today}::date
    from (
      select unnest(${alerts.map((a) => a.id)}::uuid[]) as id,
             unnest(${alerts.map((a) => a.stage)}::text[]) as stage
    ) as incoming
    where r.id = incoming.id and r.user_id = ${userId()}
  `
}
