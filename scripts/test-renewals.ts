import { addMonths, shouldAlert, stageOf, URGENT_DAYS } from '../lib/renewals'

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

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
