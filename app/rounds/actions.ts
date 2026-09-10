'use server'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import { composeDailyDigest, removeSubscription, saveSubscription, sendToAll, type StoredSubscription } from '@/lib/push'
import {
  archiveChore,
  completeChore,
  createChore,
  getRoundsView,
  RoundsError,
  saveSettings,
  saveWeekPlan,
  skipPlanned,
  suggestForWeek,
  undoCompletion,
  updateChore,
  type ChoreInput,
  type RoundsView,
  type Settings,
} from '@/lib/rounds'
import type { SuggestedWeek } from '@/lib/rounds-plan'

/**
 * Server actions for Rounds. Same contract as app/actions.ts: every action
 * returns the whole refreshed view, so the client never has to guess what the
 * database now looks like.
 *
 * Server actions are public endpoints. Each one checks the session itself.
 */

export type RoundsResult =
  | { ok: true; view: RoundsView }
  | { ok: false; error: string; view: RoundsView | null }

async function requireSession(): Promise<void> {
  const jar = await cookies()
  if (!(await sessionIsValid(jar.get(SESSION_COOKIE)?.value))) {
    throw new RoundsError('Session expired — reload and log in again')
  }
}

async function run(weekStart: string | undefined, work: () => Promise<void>): Promise<RoundsResult> {
  try {
    await requireSession()
    await work()
    return { ok: true, view: await getRoundsView(weekStart) }
  } catch (error) {
    const message =
      error instanceof RoundsError ? error.message : 'Could not save that — nothing was changed'
    if (!(error instanceof RoundsError)) console.error('rounds action failed', error)

    let view: RoundsView | null = null
    try {
      await requireSession()
      view = await getRoundsView(weekStart)
    } catch {
      // Keep null; the client holds what it has and shows the error.
    }
    return { ok: false, error: message, view }
  }
}

export async function loadRoundsAction(weekStart?: string): Promise<RoundsResult> {
  return run(weekStart, async () => {})
}

export async function completeChoreAction(
  choreId: string,
  doneOn: string,
  weekStart?: string
): Promise<RoundsResult> {
  return run(weekStart, () => completeChore(choreId, doneOn, null, null))
}

export async function undoCompletionAction(
  choreId: string,
  weekStart?: string
): Promise<RoundsResult> {
  return run(weekStart, () => undoCompletion(choreId))
}

export async function skipPlannedAction(planId: string, weekStart?: string): Promise<RoundsResult> {
  return run(weekStart, () => skipPlanned(planId))
}

export async function createChoreAction(input: ChoreInput): Promise<RoundsResult> {
  return run(undefined, () => createChore(input))
}

export async function updateChoreAction(id: string, input: ChoreInput): Promise<RoundsResult> {
  return run(undefined, () => updateChore(id, input))
}

export async function archiveChoreAction(id: string): Promise<RoundsResult> {
  return run(undefined, () => archiveChore(id))
}

export async function saveSettingsAction(settings: Settings): Promise<RoundsResult> {
  return run(undefined, () => saveSettings(settings))
}

// ---------------------------------------------------------------------------
// The planner

export type SuggestResult =
  | { ok: true; suggestion: SuggestedWeek }
  | { ok: false; error: string }

/**
 * Propose a week without writing anything. Nothing is committed until you accept
 * it — a suggestion you have to undo is worse than one you never saw.
 */
export async function suggestWeekAction(weekStart: string): Promise<SuggestResult> {
  try {
    await requireSession()
    return { ok: true, suggestion: await suggestForWeek(weekStart) }
  } catch (error) {
    const message =
      error instanceof RoundsError ? error.message : 'Could not work out a plan for that week'
    if (!(error instanceof RoundsError)) console.error('suggest failed', error)
    return { ok: false, error: message }
  }
}

/**
 * Commit the week exactly as it appears on the planner — the shuffling happens
 * in the browser and lands in one write, so a half-finished rearrangement never
 * reaches the database.
 */
export async function saveWeekPlanAction(
  weekStart: string,
  items: Array<{ itemId: string; date: string }>
): Promise<RoundsResult> {
  return run(weekStart, () => saveWeekPlan(weekStart, items))
}

// ---------------------------------------------------------------------------
// Push

export async function subscribePushAction(
  subscription: StoredSubscription,
  label: string | null
): Promise<RoundsResult> {
  return run(undefined, () => saveSubscription(subscription, label))
}

export async function unsubscribePushAction(endpoint: string): Promise<RoundsResult> {
  return run(undefined, () => removeSubscription(endpoint))
}

/**
 * Send the real morning digest, on demand. This is the button that proves the
 * whole chain works — VAPID keys, subscription, service worker, phone — without
 * waiting until tomorrow morning to find out it doesn't.
 */
export async function testPushAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await requireSession()
    const digest = (await composeDailyDigest()) ?? {
      title: 'Rounds',
      body: 'Nothing due and nothing planned. This is what a quiet morning looks like.',
      url: '/rounds',
      tag: 'rounds-test',
    }
    const { sent, failed } = await sendToAll(digest)
    if (sent === 0) {
      return { ok: false, message: failed > 0 ? 'No device accepted it' : 'No devices subscribed' }
    }
    return { ok: true, message: `Sent to ${sent} device${sent === 1 ? '' : 's'}` }
  } catch (error) {
    console.error('test push failed', error)
    return { ok: false, message: (error as Error).message }
  }
}
