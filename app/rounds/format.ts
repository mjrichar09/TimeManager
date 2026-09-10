import { dayNumber } from '@/lib/rounds-plan'

/** Presentation helpers shared by the Rounds screens. Pure, no clock. */

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** 'Every 14 days' reads worse than 'Fortnightly' for the handful that have a name. */
export function intervalLabel(days: number): string {
  const named: Record<number, string> = {
    1: 'Daily',
    7: 'Weekly',
    14: 'Fortnightly',
    30: 'Monthly',
    60: 'Every 2 months',
    90: 'Quarterly',
    182: 'Twice a year',
    365: 'Yearly',
  }
  return named[days] ?? `Every ${days} days`
}

/**
 * How late, or how long left. Days rather than dates because 'overdue by 9 days'
 * is a fact you can act on and '18 August' is one you have to work out.
 */
export function dueLabel(daysOverdue: number): string {
  if (daysOverdue > 0) return `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} late`
  if (daysOverdue === 0) return 'Due today'
  if (daysOverdue === -1) return 'Due tomorrow'
  return `Due in ${-daysOverdue} days`
}

export function relativeDate(iso: string, today: string): string {
  const diff = dayNumber(iso) - dayNumber(today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function weekdayName(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

export function dayOfMonth(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function longDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/**
 * Like longDate, but carrying the year.
 *
 * Chores come round inside a fortnight, so a weekday and a date is enough to
 * place them. Renewals run to five and ten years, where "Wednesday 18 April"
 * is not a date at all.
 */
export function longDateWithYear(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
