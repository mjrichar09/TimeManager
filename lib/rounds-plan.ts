/**
 * The week suggester.
 *
 * Pure functions over plain date strings — no database, no Date-with-timezone
 * arithmetic, no clock. That is what makes it testable (scripts/test-rounds-plan.ts)
 * and what keeps a plan generated at 06:00 by the cron identical to one generated
 * at 22:00 in the browser.
 *
 * The heuristic, in one paragraph: take everything that comes due on or before
 * the end of the week, deal with the most overdue first, and place each chore on
 * the day that still has room for it — as late as its due date allows, so the
 * week isn't front-loaded, but never after. Anything that doesn't fit is
 * reported rather than crammed in, because a plan you can't do is the same as no
 * plan, and the useful signal is "this week is 95 minutes over".
 */

/** Days since the epoch. Dates are 'YYYY-MM-DD' throughout; no Date objects escape this file. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function isoDate(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** Monday = 0 … Sunday = 6, matching the shape of `chore_settings.day_minutes`. */
export function weekdayIndex(iso: string): number {
  return (((dayNumber(iso) + 3) % 7) + 7) % 7 // 1970-01-01 was a Thursday
}

/** The Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  return isoDate(dayNumber(iso) - weekdayIndex(iso))
}

export function addDays(iso: string, days: number): string {
  return isoDate(dayNumber(iso) + days)
}

export type Candidate = {
  /**
   * Opaque to this module. The caller encodes what kind of thing this is —
   * 'chore:<uuid>' or 'renewal:<uuid>' — because placing something needs only a
   * size and a deadline, and nothing here is improved by knowing which it is.
   */
  itemId: string
  name: string
  effortMinutes: number
  /** When it comes round. May be in the past — that is what overdue means. */
  dueOn: string
  preferWeekend: boolean
}

export type PlannedItem = {
  itemId: string
  name: string
  effortMinutes: number
  dueOn: string
  /** Placed after its due date because nothing earlier had room. */
  late: boolean
}

export type PlanDay = {
  date: string
  /** Monday = 0. */
  weekday: number
  capacityMinutes: number
  usedMinutes: number
  items: PlannedItem[]
}

export type UnplannedItem = Candidate & { reason: 'no-capacity' }

export type SuggestedWeek = {
  weekStart: string
  days: PlanDay[]
  unplanned: UnplannedItem[]
  totalMinutes: number
  capacityMinutes: number
}

export type SuggestInput = {
  /** Monday of the week being planned. */
  weekStart: string
  /** Today, so the current week doesn't get chores planned into days already gone. */
  today: string
  /** Minutes available per weekday, Monday first. */
  dayMinutes: number[]
  candidates: Candidate[]
}

/**
 * Order chores by how much trouble they are: most overdue first, and among
 * equally urgent ones the longest job first, since a 90-minute hedge-cut has far
 * fewer days it can fit into than a 5-minute bin run.
 */
function byUrgency(a: Candidate, b: Candidate): number {
  const due = dayNumber(a.dueOn) - dayNumber(b.dueOn)
  if (due !== 0) return due
  const effort = b.effortMinutes - a.effortMinutes
  if (effort !== 0) return effort
  return a.name.localeCompare(b.name)
}

export function suggestWeek(input: SuggestInput): SuggestedWeek {
  const start = dayNumber(input.weekStart)
  const todayNum = dayNumber(input.today)

  const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: isoDate(start + i),
    weekday: i,
    // A day already past can't take work. Planning Monday's chores on Wednesday
    // is how a planner loses your trust in week one.
    capacityMinutes: start + i < todayNum ? 0 : Math.max(0, input.dayMinutes[i] ?? 0),
    usedMinutes: 0,
    items: [],
  }))

  const weekEnd = start + 6
  const unplanned: UnplannedItem[] = []

  const candidates = [...input.candidates]
    .filter((c) => dayNumber(c.dueOn) <= weekEnd)
    .sort(byUrgency)

  for (const chore of candidates) {
    const due = dayNumber(chore.dueOn)
    const open = days.filter(
      (d) => d.capacityMinutes - d.usedMinutes >= chore.effortMinutes && d.capacityMinutes > 0
    )

    if (open.length === 0) {
      unplanned.push({ ...chore, reason: 'no-capacity' })
      continue
    }

    // On time if possible: only days on or before the due date count as such.
    const onTime = open.filter((d) => dayNumber(d.date) <= due)
    // A weekend preference is a preference. If the lawn is due Wednesday and the
    // weekend is four days off, mowing it Wednesday beats mowing it late.
    const weekendOnTime = onTime.filter((d) => d.weekday >= 5)
    const pool =
      chore.preferWeekend && weekendOnTime.length > 0
        ? weekendOnTime
        : onTime.length > 0
          ? onTime
          : open

    const late = onTime.length === 0

    let chosen: PlanDay
    if (late) {
      // Already slipping — earliest day with room, get it done.
      chosen = pool.reduce((best, d) => (dayNumber(d.date) < dayNumber(best.date) ? d : best))
    } else {
      // Spread: the emptiest day that still gets it done on time, earliest on a tie.
      chosen = pool.reduce((best, d) => {
        const free = d.capacityMinutes - d.usedMinutes
        const bestFree = best.capacityMinutes - best.usedMinutes
        if (free !== bestFree) return free > bestFree ? d : best
        return dayNumber(d.date) < dayNumber(best.date) ? d : best
      })
    }

    chosen.items.push({
      itemId: chore.itemId,
      name: chore.name,
      effortMinutes: chore.effortMinutes,
      dueOn: chore.dueOn,
      late,
    })
    chosen.usedMinutes += chore.effortMinutes
  }

  // Within a day, the thing that is most overdue goes first — the list is read
  // top down and abandoned halfway through more often than anyone admits.
  for (const day of days) {
    day.items.sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn) || a.name.localeCompare(b.name))
  }

  return {
    weekStart: input.weekStart,
    days,
    unplanned,
    totalMinutes: days.reduce((n, d) => n + d.usedMinutes, 0),
    capacityMinutes: days.reduce((n, d) => n + d.capacityMinutes, 0),
  }
}
