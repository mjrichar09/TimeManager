'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import type { Chore, RoundsView } from '@/lib/rounds'
import { dayNumber } from '@/lib/rounds-plan'
import {
  completeChoreAction,
  completeTimedChoreAction,
  skipPlannedAction,
  undoCompletionAction,
  type RoundsResult,
} from './actions'
import { dueLabel, longDate, minutesLabel } from './format'

/**
 * The running timer lives in localStorage, not only in React state.
 *
 * Timing a chore means putting the phone down and doing the chore, and a phone
 * put down locks, backgrounds the tab and eventually reloads it. A timer that
 * only exists in memory is a timer that loses the one measurement you went to
 * the trouble of taking. Only the start instant is stored, so the elapsed time
 * is computed rather than counted — a sleeping tab whose interval never fired
 * still comes back with the right number.
 */
const TIMER_KEY = 'rounds.timer'

type RunningTimer = { choreId: string; startedAt: number }

function readTimer(): RunningTimer | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RunningTimer>
    if (typeof parsed?.choreId !== 'string' || typeof parsed?.startedAt !== 'number') return null
    return { choreId: parsed.choreId, startedAt: parsed.startedAt }
  } catch {
    // Private mode, blocked storage, or something else wrote nonsense here.
    return null
  }
}

function writeTimer(timer: RunningTimer | null): void {
  try {
    if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer))
    else localStorage.removeItem(TIMER_KEY)
  } catch {
    // Storage is a convenience here; the timer still works for this page view.
  }
}

/**
 * Storage read through `useSyncExternalStore` rather than an effect that sets
 * state on mount: the server cannot know a timer is running, so the first paint
 * has to say "none" and the client has to correct it. This is the way to do that
 * without a hydration mismatch — and it picks up a timer started in another tab
 * for free.
 *
 * The snapshot is cached because `useSyncExternalStore` compares snapshots by
 * identity, and parsing JSON afresh on every render would hand it a new object
 * every time.
 */
let snapshot: RunningTimer | null = null
let snapshotLoaded = false
const listeners = new Set<() => void>()

function timerSnapshot(): RunningTimer | null {
  if (!snapshotLoaded) {
    snapshot = readTimer()
    snapshotLoaded = true
  }
  return snapshot
}

function noTimer(): null {
  return null
}

function subscribeTimer(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TIMER_KEY) return
    snapshotLoaded = false
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function setStoredTimer(next: RunningTimer | null): void {
  snapshot = next
  snapshotLoaded = true
  writeTimer(next)
  for (const listener of listeners) listener()
}

/** m:ss while a chore is plausible, h:mm:ss once you have clearly forgotten to stop it. */
function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const rest = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

function StateChip({ chore }: { chore: Chore }) {
  const tone =
    chore.state === 'overdue'
      ? 'bg-drain-fill text-drain-ink'
      : chore.state === 'due'
        ? 'bg-surface-2 text-ink-2'
        : 'bg-transparent text-ink-3'

  return (
    <span className={`tnum shrink-0 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] ${tone}`}>
      {dueLabel(chore.daysOverdue).toUpperCase()}
    </span>
  )
}

export default function TodayClient({ initial }: { initial: RoundsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const timer = useSyncExternalStore(subscribeTimer, timerSnapshot, noTimer)
  const [now, setNow] = useState(() => Date.now())

  // One second of clock. Only while something is being timed: an interval left
  // running behind an idle screen is a battery bug with no upside.
  useEffect(() => {
    if (!timer) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer])

  const dispatch = useCallback((work: () => Promise<RoundsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
    })
  }, [])

  const elapsed = timer ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0

  const startTimer = useCallback((choreId: string) => {
    setStoredTimer({ choreId, startedAt: Date.now() })
    setNow(Date.now())
  }, [])

  const discardTimer = useCallback(() => setStoredTimer(null), [])

  // Stopping the clock is what marks the chore done: the measured length becomes
  // the completion's minutes and the chore's new estimate.
  const finishTimer = useCallback(() => {
    if (!timer) return
    const seconds = Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000))
    const { choreId } = timer
    setStoredTimer(null)
    dispatch(() => completeTimedChoreAction(choreId, view.today, seconds, view.weekStart))
  }, [timer, dispatch, view.today, view.weekStart])

  const byId = useMemo(
    () => new Map(view.chores.map((c) => [c.id, c])),
    [view.chores]
  )

  /**
   * The timer control for one chore row.
   *
   * One chore at a time: two clocks running at once aren't two measurements,
   * they're two wrong ones, so every other row's button goes quiet while one is
   * going. Stopping the clock finishes the chore — there is no separate ✓ to
   * remember afterwards — and × throws the timing away without logging
   * anything, which is what you want when the phone was in your pocket through
   * lunch.
   */
  const timerControl = (choreId: string, name: string) => {
    if (timer?.choreId === choreId) {
      return (
        <span className="flex shrink-0 items-center gap-2">
          <span className="tnum font-mono text-[12px] text-ink" aria-live="polite">
            {clockLabel(elapsed)}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={finishTimer}
            className="border border-ink bg-ink px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-surface disabled:opacity-40"
          >
            STOP
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={discardTimer}
            className="px-1 font-mono text-[13px] leading-none text-ink-4 hover:text-drain-ink disabled:opacity-40"
            aria-label={`Throw away the timing for ${name}`}
          >
            ×
          </button>
        </span>
      )
    }

    return (
      <button
        type="button"
        disabled={pending || timer !== null}
        onClick={() => startTimer(choreId)}
        className="shrink-0 border border-rule px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-2 hover:border-rule-strong disabled:opacity-40"
        aria-label={`Time ${name}`}
      >
        TIME IT
      </button>
    )
  }

  const todayPlan = view.plan.filter((p) => p.plannedOn === view.today)
  const todo = todayPlan.filter((p) => p.status === 'planned')
  const done = todayPlan.filter((p) => p.status === 'done')

  const plannedIds = new Set(
    view.plan
      .filter((p) => p.status === 'planned' && p.kind === 'chore')
      .map((p) => p.itemId)
  )

  // Overdue and nobody has decided when it will happen. This is the list the app
  // exists to keep short.
  const loose = view.chores
    .filter((c) => c.state === 'overdue' && !plannedIds.has(c.id))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const soon = view.chores
    .filter((c) => (c.state === 'due' || c.state === 'soon') && !plannedIds.has(c.id))
    .sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn))

  const minutes = todo.reduce((n, p) => n + p.effortMinutes, 0)

  // A clock can outlive the row that started it — the chore gets done from
  // another device, or the plan changes under it. A running timer with nowhere
  // on screen to stop it is worse than no timer, so it gets its own strip.
  const timedChore = timer ? byId.get(timer.choreId) : undefined
  const timerOnScreen =
    timer !== null &&
    (todo.some((p) => p.kind === 'chore' && p.itemId === timer.choreId) ||
      loose.some((c) => c.id === timer.choreId))

  return (
    <main className="pt-6">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-[27px] font-semibold tracking-tight">{longDate(view.today)}</h1>
        <p className="tnum text-[13px] text-ink-3">
          {todo.length === 0
            ? done.length > 0
              ? 'Everything planned for today is done.'
              : 'Nothing planned for today.'
            : `${todo.length} to do · ${minutesLabel(minutes)}`}
        </p>
      </div>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {timer && !timerOnScreen ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border border-ink bg-surface px-3 py-2.5">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">TIMING</span>
          <span className="min-w-[120px] flex-1 text-[14px]">
            {timedChore?.name ?? 'A chore that is no longer listed'}
          </span>
          {timedChore ? timerControl(timedChore.id, timedChore.name) : (
            <button
              type="button"
              onClick={discardTimer}
              className="shrink-0 border border-rule px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-2 hover:border-rule-strong"
            >
              DISCARD
            </button>
          )}
        </div>
      ) : null}

      <section className="mt-6 border border-rule bg-surface p-5">
        <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">TODAY</div>

        {todo.length === 0 && done.length === 0 ? (
          <div className="mt-3 border border-dashed border-rule px-4 py-8 text-center">
            <p className="text-sm text-ink-3">
              Nothing on the plan. That is either a good week or an unplanned one.
            </p>
            <Link
              href="/rounds/plan"
              className="mt-4 inline-block border border-ink bg-ink px-4 py-2.5 text-[13px] text-surface"
            >
              Plan the week
            </Link>
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          {todo.map((entry) => {
            const chore = entry.kind === 'chore' ? byId.get(entry.itemId) : undefined
            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-3 border border-rule-2 px-3 py-3"
              >
                {/* A renewal cannot be ticked off here. Completing one needs the
                    new expiry date off the paperwork, and a one-tap ✓ that
                    invented that date would be the one bug that matters — so it
                    sends you to the screen that asks. */}
                {entry.kind === 'renewal' ? (
                  <Link
                    href="/rounds/renewals"
                    className="flex h-7 w-7 shrink-0 items-center justify-center border border-rule-strong bg-surface text-[13px] leading-none text-ink-3 hover:bg-surface-2"
                    aria-label={`Open ${entry.name} to renew it`}
                  >
                    →
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={pending || timer?.choreId === entry.itemId}
                    onClick={() =>
                      dispatch(() => completeChoreAction(entry.itemId, view.today, view.weekStart))
                    }
                    className="h-7 w-7 shrink-0 border border-rule-strong bg-surface text-[13px] leading-none text-ink-3 hover:bg-surface-2 disabled:opacity-40"
                    aria-label={`Mark ${entry.name} done`}
                  >
                    ✓
                  </button>
                )}

                <span className="min-w-[140px] flex-1 text-[15px]">{entry.name}</span>
                {entry.kind === 'renewal' ? (
                  <span className="shrink-0 border border-rule px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-ink-3">
                    RENEWAL
                  </span>
                ) : null}
                {chore ? <StateChip chore={chore} /> : null}
                <span className="tnum w-10 shrink-0 text-right font-mono text-[11px] text-ink-3">
                  {minutesLabel(entry.effortMinutes)}
                </span>

                {entry.kind === 'chore' ? timerControl(entry.itemId, entry.name) : null}

                <button
                  type="button"
                  disabled={pending || (entry.kind === 'chore' && timer?.choreId === entry.itemId)}
                  onClick={() => dispatch(() => skipPlannedAction(entry.id, view.weekStart))}
                  className="shrink-0 px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-ink-2 disabled:opacity-40"
                >
                  SKIP
                </button>
              </div>
            )
          })}
        </div>

        {done.length > 0 ? (
          <div className="mt-4 border-t border-rule-2 pt-3">
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4">DONE TODAY</div>
            <div className="mt-2 flex flex-col gap-1">
              {done.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="text-[13px] text-ink-4 line-through">{entry.name}</span>
                  {entry.kind === 'chore' ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        dispatch(() => undoCompletionAction(entry.itemId, view.weekStart))
                      }
                      className="font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-ink-2 disabled:opacity-40"
                    >
                      UNDO
                    </button>
                  ) : (
                    <Link
                      href="/rounds/renewals"
                      className="font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-ink-2"
                    >
                      UNDO
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {loose.length > 0 ? (
        <section className="mt-5 border border-drain-fill bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[9px] tracking-[0.12em] text-drain-ink">
              OVERDUE · NOT PLANNED
            </div>
            <Link
              href="/rounds/plan"
              className="font-mono text-[10px] tracking-[0.1em] text-ink-3 hover:text-ink"
            >
              PLAN THESE →
            </Link>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {loose.map((chore) => (
              <div
                key={chore.id}
                className="flex flex-wrap items-center gap-3 border border-rule-2 px-3 py-2.5"
              >
                <span className="min-w-[140px] flex-1 text-[14px]">{chore.name}</span>
                <StateChip chore={chore} />
                <span className="tnum w-10 shrink-0 text-right font-mono text-[11px] text-ink-3">
                  {minutesLabel(chore.effortMinutes)}
                </span>
                {timerControl(chore.id, chore.name)}
                <button
                  type="button"
                  disabled={pending || timer?.choreId === chore.id}
                  onClick={() =>
                    dispatch(() => completeChoreAction(chore.id, view.today, view.weekStart))
                  }
                  className="shrink-0 border border-rule px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-2 hover:border-rule-strong disabled:opacity-40"
                >
                  DID IT
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {soon.length > 0 ? (
        <section className="mt-5 border border-rule bg-surface p-5">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">COMING UP</div>
          <div className="mt-3 flex flex-col">
            {soon.slice(0, 8).map((chore) => (
              <div
                key={chore.id}
                className="flex items-center gap-3 border-b border-rule-2 py-2 last:border-b-0"
              >
                <span className="flex-1 text-[14px] text-ink-2">{chore.name}</span>
                <span className="tnum font-mono text-[11px] text-ink-3">
                  {dueLabel(chore.daysOverdue)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
