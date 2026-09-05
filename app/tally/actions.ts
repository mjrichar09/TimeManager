'use server'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import { getDay, type Day } from '@/lib/day'
import {
  completeDay,
  deleteBlock,
  EditError,
  fillGap,
  moveEdge,
  recategorize,
  saveCheck,
  splitBlock,
  splitOpenBlock,
} from '@/lib/edits'

/**
 * Server actions for the reconcile and daily-check screens.
 *
 * Each one performs the edit and returns the whole refreshed day, so the client
 * never has to guess what the database now looks like — no optimistic state to
 * drift out of sync while you're rewriting history.
 *
 * Server actions are public endpoints, so each checks the session itself.
 */

export type ActionResult =
  | { ok: true; day: Day }
  | { ok: false; error: string; day: Day | null }

async function requireSession(): Promise<void> {
  const jar = await cookies()
  if (!(await sessionIsValid(jar.get(SESSION_COOKIE)?.value))) {
    throw new EditError('Session expired — reload and log in again')
  }
}

type Window = { date: string; from: string; to: string }

async function run(window: Window, work: () => Promise<void>): Promise<ActionResult> {
  try {
    await requireSession()
    await work()
    return { ok: true, day: await getDay(window.date, window.from, window.to) }
  } catch (error) {
    const message =
      error instanceof EditError ? error.message : 'Could not save that — nothing was changed'
    if (!(error instanceof EditError)) console.error('reconcile edit failed', error)

    let day: Day | null = null
    try {
      await requireSession()
      day = await getDay(window.date, window.from, window.to)
    } catch {
      // Leave day null; the client keeps what it has and shows the error.
    }
    return { ok: false, error: message, day }
  }
}

export async function loadDayAction(window: Window): Promise<ActionResult> {
  return run(window, async () => {})
}

export async function recategorizeAction(
  window: Window,
  blockId: string,
  slug: string
): Promise<ActionResult> {
  return run(window, () => recategorize(blockId, slug))
}

export async function moveEdgeAction(
  window: Window,
  blockId: string,
  edge: 'start' | 'end',
  deltaMinutes: number
): Promise<ActionResult> {
  return run(window, () => moveEdge(blockId, edge, deltaMinutes))
}

export async function fillGapAction(
  window: Window,
  fromISO: string,
  toISO: string,
  slug: string
): Promise<ActionResult> {
  return run(window, () => fillGap(fromISO, toISO, slug))
}

export async function deleteBlockAction(window: Window, blockId: string): Promise<ActionResult> {
  return run(window, () => deleteBlock(blockId))
}

export async function splitOpenAction(
  window: Window,
  atISO: string,
  slug: string
): Promise<ActionResult> {
  return run(window, () => splitOpenBlock(atISO, slug))
}

export async function splitBlockAction(
  window: Window,
  blockId: string,
  atISO: string
): Promise<ActionResult> {
  return run(window, () => splitBlock(blockId, atISO))
}

export async function completeDayAction(window: Window): Promise<ActionResult> {
  return run(window, () => completeDay(window.date))
}

export async function saveCheckAction(
  window: Window,
  energy: number | null,
  movedPriority: boolean | null,
  note: string | null
): Promise<ActionResult> {
  return run(window, () => saveCheck(window.date, energy, movedPriority, note?.trim() || null))
}
