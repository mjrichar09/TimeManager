import { addMonths, shouldAlert, stageOf, URGENT_DAYS, type Renewal } from '../lib/renewals'
import { parseRef, plannableFrom, refFor, type Chore } from '../lib/rounds'

/**
 * Exercises the pure half of renewals: month arithmetic that has to clamp
 * rather than roll over, the staging thresholds, and the rule that decides
 * whether a renewal has already said its piece.
 *
 * Pure — no database, no clock, nothing to clean up.
 * Run with: npx tsx scripts/test-renewals.ts
 */

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures++
}

console.log('\nmonth arithmetic')
check('a year on from an inspection', addMonths('2026-09-10', 12) === '2027-09-10', addMonths('2026-09-10', 12))
check('ten years of passport', addMonths('2026-09-10', 120) === '2036-09-10', addMonths('2026-09-10', 120))
check('five years of Global Entry', addMonths('2026-03-01', 60) === '2031-03-01', addMonths('2026-03-01', 60))
check('six months of insurance', addMonths('2026-09-30', 6) === '2027-03-30', addMonths('2026-09-30', 6))
// The reason this function exists rather than a Date + setMonth: rolling over
// walks the date forward every cycle, and over ten years that is real drift.
check('31 Jan + 1 month clamps to 28 Feb', addMonths('2027-01-31', 1) === '2027-02-28', addMonths('2027-01-31', 1))
check('31 Jan + 1 month clamps to 29 Feb in a leap year', addMonths('2028-01-31', 1) === '2028-02-29', addMonths('2028-01-31', 1))
check('31 Mar + 1 month clamps to 30 Apr', addMonths('2026-03-31', 1) === '2026-04-30', addMonths('2026-03-31', 1))
check('29 Feb + 12 months clamps to 28 Feb', addMonths('2028-02-29', 12) === '2029-02-28', addMonths('2028-02-29', 12))
check('crossing a year boundary', addMonths('2026-11-15', 3) === '2027-02-15', addMonths('2026-11-15', 3))

console.log('\nstages')
check('far out is silent', stageOf(200, 30) === 'later')
check('one day outside the lead time is still silent', stageOf(31, 30) === 'later')
check('the first day inside the lead time speaks', stageOf(30, 30) === 'lead')
check('a week out is urgent', stageOf(URGENT_DAYS, 30) === 'urgent')
check('tomorrow is urgent', stageOf(1, 30) === 'urgent')
check('today is urgent, not overdue', stageOf(0, 30) === 'urgent')
check('yesterday is overdue', stageOf(-1, 30) === 'overdue')
// A short lead time must never skip the lead stage by being shorter than the
// urgent window — an inspection warned 5 days out goes straight to urgent.
check('a lead time inside the urgent window collapses to urgent', stageOf(5, 5) === 'urgent')

console.log('\nwhen to speak')
const quiet = { alertDueOn: '2027-01-15', alertStage: 'lead', alertedOn: '2026-12-16' }
check(
  'silent while sitting in a stage already announced',
  shouldAlert({ stage: 'lead', dueOn: '2027-01-15' }, quiet, '2026-12-20') === false
)
check(
  'speaks on entering the next stage',
  shouldAlert({ stage: 'urgent', dueOn: '2027-01-15' }, quiet, '2027-01-09') === true
)
check(
  'never speaks while beyond the lead time',
  shouldAlert({ stage: 'later', dueOn: '2027-01-15' }, quiet, '2026-06-01') === false
)
check(
  'a renewed item speaks again on its new cycle',
  shouldAlert({ stage: 'lead', dueOn: '2028-01-15' }, quiet, '2027-12-20') === true
)
check(
  'says nothing twice in a week when overdue',
  shouldAlert(
    { stage: 'overdue', dueOn: '2027-01-15' },
    { alertDueOn: '2027-01-15', alertStage: 'overdue', alertedOn: '2027-01-16' },
    '2027-01-20'
  ) === false
)
check(
  'but nags again after a week overdue',
  shouldAlert(
    { stage: 'overdue', dueOn: '2027-01-15' },
    { alertDueOn: '2027-01-15', alertStage: 'overdue', alertedOn: '2027-01-16' },
    '2027-01-23'
  ) === true
)
check(
  'a never-alerted overdue item speaks',
  shouldAlert(
    { stage: 'overdue', dueOn: '2027-01-15' },
    { alertDueOn: null, alertStage: null, alertedOn: null },
    '2027-01-16'
  ) === true
)

console.log('\nwhat the planner may hold')

function renewal(name: string, daysUntil: number, leadDays: number): Renewal {
  return {
    id: name, slug: name, name, category: null, dueOn: '2027-01-01',
    periodMonths: 12, leadDays, effortMinutes: 30, notes: null,
    daysUntil, stage: stageOf(daysUntil, leadDays), lastCompletedOn: null,
  }
}
function chore(name: string): Chore {
  return {
    id: name, slug: name, name, area: null, intervalDays: 7, effortMinutes: 15,
    preferWeekend: false, notes: null, lastDoneOn: null, dueOn: '2026-09-12',
    daysOverdue: -2, state: 'soon',
  }
}

const plannable = plannableFrom(
  [chore('Bins')],
  [renewal('Passport', 300, 180), renewal('Inspection', 10, 30), renewal('Licence', -4, 60)]
)
const names = plannable.map((p) => p.name)
// The entire premise of a renewal is that it cannot be done early, so one
// outside its window must not be offerable at all.
check('a renewal beyond its lead time is not plannable', !names.includes('Passport'), names.join(', '))
check('a renewal inside its lead time is plannable', names.includes('Inspection'))
check('an expired renewal is plannable', names.includes('Licence'))
check('chores are always plannable', names.includes('Bins'))
check(
  'a renewal carries days-overdue the way a chore does',
  plannable.find((p) => p.name === 'Licence')?.daysOverdue === 4
)
check(
  'no renewal prefers the weekend — these offices open on weekdays',
  plannable.filter((p) => p.kind === 'renewal').every((p) => !p.preferWeekend)
)

console.log('\nplan refs')
check('a chore ref round-trips', parseRef(refFor('chore', 'abc')).kind === 'chore')
check('a renewal ref round-trips', parseRef(refFor('renewal', 'abc')).id === 'abc')
// A uuid contains no colon, but splitting on only the first separator is what
// keeps that from ever mattering.
check('an id containing a colon survives', parseRef('renewal:a:b').id === 'a:b')
let threw = false
try { parseRef('nonsense') } catch { threw = true }
check('anything else is refused', threw)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
