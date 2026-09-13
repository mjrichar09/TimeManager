'use server'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import {
  addMilestone,
  archiveGoal,
  createGoal,
  deleteMilestone,
  getGoalsView,
  GoalError,
  moveGoal,
  renameGoal,
  setCategoryGoal,
  setGoalPlan,
  setMilestoneDone,
  setProgress,
  updateMilestone,
  type GoalPlan,
  type GoalsView,
  type Periods,
} from '@/lib/goals'

export type GoalsResult =
  | { ok: true; view: GoalsView }
  | { ok: false; error: string; view: GoalsView | null }

/**
 * Every action carries the browser's current periods, so the view that comes
 * back is the week the person is actually looking at rather than the server's.
 */
async function run(periods: Periods, work: () => Promise<void>): Promise<GoalsResult> {
  try {
    const jar = await cookies()
    if (!(await sessionIsValid(jar.get(SESSION_COOKIE)?.value))) {
      throw new GoalError('Session expired — reload and log in again')
    }
    await work()
    return { ok: true, view: await getGoalsView(periods) }
  } catch (error) {
    const message =
      error instanceof GoalError ? error.message : 'Could not save that — nothing was changed'
    if (!(error instanceof GoalError)) console.error('goal edit failed', error)
    let view: GoalsView | null = null
    try {
      view = await getGoalsView(periods)
    } catch {
      // keep null; the client holds what it has
    }
    return { ok: false, error: message, view }
  }
}

export async function loadGoalsAction(periods: Periods): Promise<GoalsResult> {
  return run(periods, async () => {})
}

export async function createGoalAction(periods: Periods, title: string): Promise<GoalsResult> {
  return run(periods, () => createGoal(title))
}

export async function renameGoalAction(
  periods: Periods,
  id: string,
  title: string
): Promise<GoalsResult> {
  return run(periods, () => renameGoal(id, title))
}

export async function moveGoalAction(
  periods: Periods,
  id: string,
  direction: 'up' | 'down'
): Promise<GoalsResult> {
  return run(periods, () => moveGoal(id, direction))
}

export async function archiveGoalAction(periods: Periods, id: string): Promise<GoalsResult> {
  return run(periods, () => archiveGoal(id))
}

export async function setCategoryGoalAction(
  periods: Periods,
  slug: string,
  goalId: string | null
): Promise<GoalsResult> {
  return run(periods, () => setCategoryGoal(slug, goalId))
}

export async function setGoalPlanAction(
  periods: Periods,
  id: string,
  plan: GoalPlan
): Promise<GoalsResult> {
  return run(periods, () => setGoalPlan(id, plan))
}

export async function setProgressAction(
  periods: Periods,
  goalId: string,
  periodStart: string,
  done: number
): Promise<GoalsResult> {
  return run(periods, () => setProgress(goalId, periodStart, done))
}

export async function addMilestoneAction(
  periods: Periods,
  goalId: string,
  title: string,
  dueOn: string
): Promise<GoalsResult> {
  return run(periods, () => addMilestone(goalId, title, dueOn))
}

export async function updateMilestoneAction(
  periods: Periods,
  id: string,
  title: string,
  dueOn: string
): Promise<GoalsResult> {
  return run(periods, () => updateMilestone(id, title, dueOn))
}

export async function setMilestoneDoneAction(
  periods: Periods,
  id: string,
  done: boolean,
  today: string
): Promise<GoalsResult> {
  return run(periods, () => setMilestoneDone(id, done, today))
}

export async function deleteMilestoneAction(periods: Periods, id: string): Promise<GoalsResult> {
  return run(periods, () => deleteMilestone(id))
}
