'use server'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import {
  archiveGoal,
  createGoal,
  getGoalsView,
  GoalError,
  moveGoal,
  renameGoal,
  setCategoryGoal,
  type GoalsView,
} from '@/lib/goals'

export type GoalsResult =
  | { ok: true; view: GoalsView }
  | { ok: false; error: string; view: GoalsView | null }

async function run(work: () => Promise<void>): Promise<GoalsResult> {
  try {
    const jar = await cookies()
    if (!(await sessionIsValid(jar.get(SESSION_COOKIE)?.value))) {
      throw new GoalError('Session expired — reload and log in again')
    }
    await work()
    return { ok: true, view: await getGoalsView() }
  } catch (error) {
    const message =
      error instanceof GoalError ? error.message : 'Could not save that — nothing was changed'
    if (!(error instanceof GoalError)) console.error('goal edit failed', error)
    let view: GoalsView | null = null
    try {
      view = await getGoalsView()
    } catch {
      // keep null; the client holds what it has
    }
    return { ok: false, error: message, view }
  }
}

export async function loadGoalsAction(): Promise<GoalsResult> {
  return run(async () => {})
}

export async function createGoalAction(title: string): Promise<GoalsResult> {
  return run(() => createGoal(title))
}

export async function renameGoalAction(id: string, title: string): Promise<GoalsResult> {
  return run(() => renameGoal(id, title))
}

export async function moveGoalAction(id: string, direction: 'up' | 'down'): Promise<GoalsResult> {
  return run(() => moveGoal(id, direction))
}

export async function archiveGoalAction(id: string): Promise<GoalsResult> {
  return run(() => archiveGoal(id))
}

export async function setCategoryGoalAction(
  slug: string,
  goalId: string | null
): Promise<GoalsResult> {
  return run(() => setCategoryGoal(slug, goalId))
}
