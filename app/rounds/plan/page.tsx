import { getRoundsView, getSettings, suggestForWeek, todayIn } from '@/lib/rounds'
import { weekStart } from '@/lib/rounds-plan'
import PlanClient from './plan-client'

export const dynamic = 'force-dynamic'

/**
 * The planner opens on a proposal, not on an empty grid. Auto-suggesting on load
 * is the difference between "plan my week" being a decision and being a glance:
 * nothing is written until Save, so the worst case is a suggestion you ignore.
 *
 * But only for a week nobody has planned yet. Once a plan is saved, that plan IS
 * the week, and re-suggesting over it would undo the decisions the save recorded
 * — every item deliberately dropped would come back, on a day the heuristic
 * picked rather than the one you did. A saved week reopens exactly as it was
 * saved; "Suggest again" is there for when you actually want the other thing.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { week } = await searchParams
  const settings = await getSettings()

  // Normalise whatever arrives in the query string to a Monday. A hand-typed
  // ?week=2026-09-03 should show that Wednesday's week, not fail.
  const requested = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : todayIn(settings.timezone)
  const start = weekStart(requested)

  const view = await getRoundsView(start)
  const planned = view.plan.some((p) => p.status === 'planned')
  const suggestion = planned ? null : await suggestForWeek(start)

  // Keyed by the week so the arrows work.
  //
  // PlanClient seeds all of its state from these props — the board is a local
  // copy you shuffle before saving, which is the whole point of it. Navigating
  // to ?week=… re-renders the same component instance, and React keeps the
  // state it already has, so without a key the server would fetch the new week
  // and the screen would carry on showing the old one.
  return <PlanClient key={start} initial={view} suggestion={suggestion} />
}
