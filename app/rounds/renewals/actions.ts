'use server'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import {
  archiveRenewal,
  completeRenewal,
  createRenewal,
  getRenewalsView,
  updateRenewal,
  undoRenewal,
  type RenewalInput,
  type RenewalsView,
} from '@/lib/renewals'
import { getSettings, RoundsError, todayIn } from '@/lib/rounds'

/**
 * Server actions for the renewals screen. Same contract as the rest of Rounds:
 * every action returns the whole refreshed view, and each checks the session
 * itself because a server action is a public endpoint.
 */

export type RenewalsResult =
  | { ok: true; view: RenewalsView }
  | { ok: false; error: string; view: RenewalsView | null }

async function requireSession(): Promise<void> {
  const jar = await cookies()
  if (!(await sessionIsValid(jar.get(SESSION_COOKIE)?.value))) {
    throw new RoundsError('Session expired — reload and log in again')
  }
}

async function view(): Promise<RenewalsView> {
  const settings = await getSettings()
  return getRenewalsView(todayIn(settings.timezone))
}

async function run(work: () => Promise<void>): Promise<RenewalsResult> {
  try {
    await requireSession()
    await work()
    return { ok: true, view: await view() }
  } catch (error) {
    const message =
      error instanceof RoundsError ? error.message : 'Could not save that — nothing was changed'
    if (!(error instanceof RoundsError)) console.error('renewals action failed', error)

    let current: RenewalsView | null = null
    try {
      await requireSession()
      current = await view()
    } catch {
      // Keep null; the client holds what it has and shows the error.
    }
    return { ok: false, error: message, view: current }
  }
}

export async function loadRenewalsAction(): Promise<RenewalsResult> {
  return run(async () => {})
}

export async function createRenewalAction(input: RenewalInput): Promise<RenewalsResult> {
  return run(() => createRenewal(input))
}

export async function updateRenewalAction(id: string, input: RenewalInput): Promise<RenewalsResult> {
  return run(() => updateRenewal(id, input))
}

export async function archiveRenewalAction(id: string): Promise<RenewalsResult> {
  return run(() => archiveRenewal(id))
}

export async function completeRenewalAction(
  id: string,
  completedOn: string,
  newDueOn: string | null,
  note: string | null
): Promise<RenewalsResult> {
  return run(() => completeRenewal(id, completedOn, newDueOn, note?.trim() || null))
}

export async function undoRenewalAction(id: string): Promise<RenewalsResult> {
  return run(() => undoRenewal(id))
}
