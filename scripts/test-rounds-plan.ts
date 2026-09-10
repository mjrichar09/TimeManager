import { addDays, suggestWeek, weekStart, weekdayIndex, type Candidate } from '../lib/rounds-plan'

/**
 * Exercises the week suggester: urgency ordering, day capacity, the weekend
 * preference, days already gone, and what happens when the week is too small
 * for what is due.
 *
 * Pure — no database, no clock, nothing to clean up.
 * Run with: npx tsx scripts/test-rounds-plan.ts
 */

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures++
}

// A Monday, chosen so the arithmetic in the expectations below is readable.
const MONDAY = '2026-09-07'
const CAPACITY = [30, 30, 30, 30, 30, 120, 60]

function chore(
  id: string,
  effort: number,
  dueOn: string,
  preferWeekend = false
): Candidate {
  return { itemId: id, name: id, effortMinutes: effort, dueOn, preferWeekend }
}

function dayOf(plan: ReturnType<typeof suggestWeek>, itemId: string): string | null {
  for (const day of plan.days) {
    if (day.items.some((i) => i.itemId === itemId)) return day.date
  }
  return null
}

console.log('\ndate helpers')
check('the Monday of a Monday is itself', weekStart(MONDAY) === MONDAY, weekStart(MONDAY))
check('the Monday of the Thursday after', weekStart('2026-09-10') === MONDAY, weekStart('2026-09-10'))
check('Monday indexes as 0', weekdayIndex(MONDAY) === 0, String(weekdayIndex(MONDAY)))
check('Sunday indexes as 6', weekdayIndex(addDays(MONDAY, 6)) === 6)

console.log('\nnothing due, nothing planned')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: CAPACITY,
    candidates: [chore('later', 20, addDays(MONDAY, 30))],
  })
  check('a chore due next month is left alone', plan.totalMinutes === 0)
  check('and is not reported as unfitted', plan.unplanned.length === 0)
}

console.log('\na chore is planned on or before its due date')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: CAPACITY,
    candidates: [chore('due-wednesday', 20, addDays(MONDAY, 2))],
  })
  const placed = dayOf(plan, 'due-wednesday')
  check('placed', placed !== null, String(placed))
  check('not after Wednesday', placed !== null && placed <= addDays(MONDAY, 2), String(placed))
  check('not in the past', placed !== null && placed >= MONDAY, String(placed))
}

console.log('\noverdue work goes first and early')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: [30, 30, 30, 30, 30, 30, 30],
    candidates: [
      chore('due-sunday', 25, addDays(MONDAY, 6)),
      chore('late-by-nine', 25, addDays(MONDAY, -9)),
    ],
  })
  check('the overdue one lands on Monday', dayOf(plan, 'late-by-nine') === MONDAY, String(dayOf(plan, 'late-by-nine')))
  check('and is marked late', plan.days[0].items[0].late)
}

console.log('\ncapacity is respected, and the shortfall is reported')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: [20, 20, 20, 20, 20, 20, 20],
    candidates: [
      chore('big-one', 90, addDays(MONDAY, 3)),
      chore('small-one', 15, addDays(MONDAY, 3)),
    ],
  })
  check('the small one fits', dayOf(plan, 'small-one') !== null)
  check('the big one does not', dayOf(plan, 'big-one') === null)
  check('and is reported', plan.unplanned.some((u) => u.itemId === 'big-one'))
  check('with a reason', plan.unplanned[0]?.reason === 'no-capacity')
  check('no day is over its capacity', plan.days.every((d) => d.usedMinutes <= d.capacityMinutes))
}

console.log('\nthe weekend preference is a preference, not a rule')
{
  const honoured = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: CAPACITY,
    candidates: [chore('mow', 45, addDays(MONDAY, 6), true)],
  })
  const day = dayOf(honoured, 'mow')
  check('a lawn due Sunday is mown at the weekend', day === addDays(MONDAY, 5) || day === addDays(MONDAY, 6), String(day))

  const overridden = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: [60, 60, 60, 60, 60, 120, 60],
    candidates: [chore('mow', 45, addDays(MONDAY, 2), true)],
  })
  const early = dayOf(overridden, 'mow')
  check('a lawn due Wednesday is not left until Saturday', early !== null && early <= addDays(MONDAY, 2), String(early))
}

console.log('\nmid-week, the days already gone take nothing')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: addDays(MONDAY, 3),
    dayMinutes: CAPACITY,
    candidates: [chore('overdue', 20, addDays(MONDAY, -2))],
  })
  check('Monday to Wednesday have no capacity', plan.days.slice(0, 3).every((d) => d.capacityMinutes === 0))
  check('the chore lands on Thursday', dayOf(plan, 'overdue') === addDays(MONDAY, 3), String(dayOf(plan, 'overdue')))
}

console.log('\nload is spread rather than front-loaded')
{
  const plan = suggestWeek({
    weekStart: MONDAY,
    today: MONDAY,
    dayMinutes: [30, 30, 30, 30, 30, 30, 30],
    candidates: [
      chore('a', 25, addDays(MONDAY, 6)),
      chore('b', 25, addDays(MONDAY, 6)),
      chore('c', 25, addDays(MONDAY, 6)),
    ],
  })
  const used = plan.days.filter((d) => d.items.length > 0).length
  check('three chores land on three different days', used === 3, `${used} day(s)`)
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
