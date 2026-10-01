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

/**
 * Lateness as a length. The grey bar is how far through its interval a chore is;
 * the tick is the due date; anything past the tick is red. "22 days late" becomes
 * something you see down the list without reading a single label.
 */
function DueBar({ chore }: { chore: Chore }) {
  if (!chore.lastDoneOn) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-[6px] flex-1 rounded-full border border-dashed border-rule-strong" />
        <span className="font-mono text-[9.5px] text-ink-3">never done</span>
      </div>
    )
  }
  const since = Math.max(0, chore.intervalDays + chore.daysOverdue)
  const cap = Math.max(since, chore.intervalDays) * 1.08
  const line = (chore.intervalDays / cap) * 100
  const fill = (Math.min(since, chore.intervalDays) / cap) * 100
  const late = since > chore.intervalDays ? ((since - chore.intervalDays) / cap) * 100 : 0
  return (
    <div
      className="relative h-[6px] rounded-full bg-neutral-fill"
      role="img"
      aria-label={`${since} of ${chore.intervalDays} days since last done`}
    >
      <span className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${fill}%` }} />
      {late > 0 ? (
        <span
          className="absolute inset-y-0 rounded-r-full bg-drain"
          style={{ left: `${line}%`, width: `${late}%` }}
        />
      ) : null}
      <span className="absolute -top-[4px] -bottom-[4px] w-[2px] -translate-x-1/2 bg-ink" style={{ left: `${line}%` }} />
    </div>
  )
}

function lateText(chore: Chore): string | null {
  if (chore.daysOverdue > 0) return `${chore.daysOverdue}d late`
  if (chore.daysOverdue === 0) return 'due today'
  return null
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
   * The row-level timer button. One chore at a time: two clocks running at once
   * aren't two measurements, they're two wrong ones, so every other row's button
   * goes quiet while one is going. Stopping happens on the strip at the top.
   */
  const timeButton = (choreId: string, name: string) => (
    <button
      type="button"
      disabled={pending || timer !== null}
      onClick={() => startTimer(choreId)}
      className={`font-mono text-[10px] font-medium tracking-[0.08em] disabled:opacity-40 ${
        timer?.choreId === choreId ? 'text-charge' : 'text-ink-2 hover:text-ink'
      }`}
      aria-label={`Time ${name}`}
    >
      {timer?.choreId === choreId ? 'TIMING…' : 'TIME IT'}
    </button>
  )

  /** The round button on the right of a row: finishes the chore. */
  const doneButton = (choreId: string, name: string) => (
    <button
      type="button"
      disabled={pending || timer?.choreId === choreId}
      onClick={() => dispatch(() => completeChoreAction(choreId, view.today, view.weekStart))}
      className="grid size-[40px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink-3 text-[16px] text-transparent transition-colors hover:border-ink hover:text-ink-3 active:bg-ink active:text-surface disabled:opacity-30"
      aria-label={`Mark ${name} done`}
    >
      ✓
    </button>
  )

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

  // The running clock is one strip at the top rather than a control inside a
  // row: it can outlive the row that started it (the chore gets done from
  // another device, or the plan changes under it), and a timer with nowhere on
  // screen to stop it is worse than no timer.
  const timedChore = timer ? byId.get(timer.choreId) : undefined

  return (
    <main className="mx-auto max-w-[560px] pt-5">
      <div className="label">Rounds</div>
      <h1 className="font-display text-[30px] leading-[1.05] font-semibold">{longDate(view.today)}</h1>
      <p className="tnum mt-1 font-mono text-[11px] text-ink-3">
        {todo.length === 0
          ? done.length > 0
            ? 'Everything planned for today is done.'
            : 'Nothing planned for today.'
          : `${todo.length} planned · ${minutesLabel(minutes)}`}
        {loose.length > 0 ? ` · ${loose.length} late` : ''}
      </p>

      {error ? (
        <div className="mt-4 rounded-lg bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {timer ? (
        <div className="fill-in sticky top-2 z-20 mt-4 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-surface">
          <div className="min-w-0">
            <div className="label truncate text-surface/60">
              Timing · {timedChore?.name ?? 'a chore that is no longer listed'}
            </div>
            <div className="tnum font-display text-[30px] leading-none font-medium" aria-live="polite">
              {clockLabel(elapsed)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={discardTimer}
              className="px-2 font-mono text-[15px] leading-none text-surface/50 hover:text-surface disabled:opacity-40"
              aria-label="Throw the timing away without logging it"
            >
              ×
            </button>
            {timedChore ? (
              <button
                type="button"
                disabled={pending}
                onClick={finishTimer}
                className="rounded-full bg-drain px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-white disabled:opacity-40"
              >
                STOP
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="mt-5">
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <span className="label">Planned today</span>
          <span className="label">{minutesLabel(minutes)}</span>
        </div>

        {todo.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-ink-3">Nothing on the plan. That is either a good week or an unplanned one.</p>
            <Link href="/rounds/plan" className="rounded-lg bg-ink px-4 py-2.5 text-[13px] text-surface">
              Plan the week
            </Link>
          </div>
        ) : null}

        {todo.map((entry) => {
          const chore = entry.kind === 'chore' ? byId.get(entry.itemId) : undefined
          const late = chore ? lateText(chore) : null
          return (
            <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-rule-2 py-3">
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{entry.name}</div>
                <div className="tnum mt-0.5 flex flex-wrap items-center gap-x-2.5 font-mono text-[10.5px] text-ink-3">
                  <span>{minutesLabel(entry.effortMinutes)}</span>
                  {chore ? <span>every {chore.intervalDays}d</span> : <span>renewal</span>}
                  {late ? <span className={chore && chore.daysOverdue > 0 ? 'text-drain-ink' : ''}>{late}</span> : null}
                  {entry.kind === 'chore' ? timeButton(entry.itemId, entry.name) : null}
                  <button
                    type="button"
                    disabled={pending || (entry.kind === 'chore' && timer?.choreId === entry.itemId)}
                    onClick={() => dispatch(() => skipPlannedAction(entry.id, view.weekStart))}
                    className="font-mono text-[10px] tracking-[0.08em] text-ink-4 hover:text-ink-2 disabled:opacity-40"
                  >
                    SKIP
                  </button>
                </div>
              </div>
              {/* A renewal cannot be ticked off here. Completing one needs the
                  new expiry date off the paperwork, and a one-tap ✓ that
                  invented that date would be the one bug that matters — so it
                  sends you to the screen that asks. */}
              {entry.kind === 'renewal' ? (
                <Link
                  href="/rounds/renewals"
                  className="row-span-2 grid size-[40px] place-items-center rounded-full border-[1.5px] border-ink-3 text-[14px] text-ink-3"
                  aria-label={`Open ${entry.name} to renew it`}
                >
                  →
                </Link>
              ) : (
                <div className="row-span-2">{doneButton(entry.itemId, entry.name)}</div>
              )}
              {chore ? <DueBar chore={chore} /> : null}
            </div>
          )
        })}

        {done.length > 0 ? (
          <div className="pt-2">
            {done.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-1.5">
                <span className="grid size-[22px] place-items-center rounded-full bg-ink text-[11px] text-surface">✓</span>
                <span className="text-[13px] text-ink-3 line-through">{entry.name}</span>
                {entry.kind === 'chore' ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => dispatch(() => undoCompletionAction(entry.itemId, view.weekStart))}
                    className="ml-auto font-mono text-[10px] tracking-[0.08em] text-ink-4 hover:text-ink-2 disabled:opacity-40"
                  >
                    UNDO
                  </button>
                ) : (
                  <Link href="/rounds/renewals" className="ml-auto font-mono text-[10px] tracking-[0.08em] text-ink-4 hover:text-ink-2">
                    UNDO
                  </Link>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {loose.length > 0 ? (
        <section className="mt-7">
          <div className="flex items-baseline justify-between border-b border-rule pb-2">
            <span className="label text-drain-ink">Late, not planned</span>
            <Link href="/rounds/plan" className="label hover:text-ink">
              Plan these →
            </Link>
          </div>
          {loose.map((chore) => (
            <div key={chore.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-rule-2 py-3">
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{chore.name}</div>
                <div className="tnum mt-0.5 flex flex-wrap items-center gap-x-2.5 font-mono text-[10.5px] text-ink-3">
                  <span>{minutesLabel(chore.effortMinutes)}</span>
                  <span>every {chore.intervalDays}d</span>
                  <span className="text-drain-ink">{lateText(chore)}</span>
                  {timeButton(chore.id, chore.name)}
                </div>
              </div>
              <div className="row-span-2">{doneButton(chore.id, chore.name)}</div>
              <DueBar chore={chore} />
            </div>
          ))}
        </section>
      ) : null}

      {soon.length > 0 ? (
        <section className="mt-7">
          <div className="border-b border-rule pb-2">
            <span className="label">Coming up</span>
          </div>
          {soon.slice(0, 8).map((chore) => (
            <div key={chore.id} className="flex items-center gap-3 border-b border-rule-2 py-2.5 last:border-b-0">
              <span className="flex-1 text-[14px] text-ink-2">{chore.name}</span>
              <span className="tnum font-mono text-[10.5px] text-ink-3">{dueLabel(chore.daysOverdue).toLowerCase()}</span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  )
}
