'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState, useTransition } from 'react'
import type { Chore, RoundsView } from '@/lib/rounds'
import { dayNumber } from '@/lib/rounds-plan'
import {
  completeChoreAction,
  skipPlannedAction,
  undoCompletionAction,
  type RoundsResult,
} from './actions'
import { dueLabel, longDate, minutesLabel } from './format'

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

  const dispatch = useCallback((work: () => Promise<RoundsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
    })
  }, [])

  const byId = useMemo(
    () => new Map(view.chores.map((c) => [c.id, c])),
    [view.chores]
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
                    disabled={pending}
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

                <button
                  type="button"
                  disabled={pending}
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
                <button
                  type="button"
                  disabled={pending}
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
