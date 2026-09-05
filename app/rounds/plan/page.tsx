import { getRoundsView, getSettings, suggestForWeek, todayIn } from '@/lib/rounds'
import { weekStart } from '@/lib/rounds-plan'
import PlanClient from './plan-client'

export const dynamic = 'force-dynamic'

/**
 * The planner opens on a proposal, not on an empty grid. Auto-suggesting on load
 * is the difference between "plan my week" being a decision and being a glance:
 * nothing is written until Save, so the worst case is a suggestion you ignore.
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

  const [view, suggestion] = await Promise.all([getRoundsView(start), suggestForWeek(start)])

  return <PlanClient initial={view} suggestion={suggestion} />
}
