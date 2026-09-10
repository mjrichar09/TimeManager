'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState, useTransition } from 'react'
import type { RoundsView } from '@/lib/rounds'
import { addDays, dayNumber, type SuggestedWeek } from '@/lib/rounds-plan'
import {
  saveWeekPlanAction,
  suggestWeekAction,
  type RoundsResult,
} from '../actions'
import { dayOfMonth, dueLabel, minutesLabel, weekdayName } from '../format'

type Item = { itemId: string; date: string }

/** Flatten a suggestion into the flat list the board and the save action both speak. */
function itemsOf(suggestion: SuggestedWeek): Item[] {
  return suggestion.days.flatMap((day) =>
    day.items.map((i) => ({ itemId: i.itemId, date: day.date }))
  )
}

/** Keys the committed plan by subject and day, which is how the board identifies a row. */
function committedKeys(view: RoundsView): Set<string> {
  return new Set(
    view.plan.filter((p) => p.status === 'planned').map((p) => `${p.ref}|${p.plannedOn}`)
  )
}

export default function PlanClient({
  initial,
  suggestion,
}: {
  initial: RoundsView
  suggestion: SuggestedWeek
}) {
  const [view, setView] = useState(initial)
  const [items, setItems] = useState<Item[]>(() => itemsOf(suggestion))
  const [capacity, setCapacity] = useState<number[]>(() =>
    suggestion.days.map((d) => d.capacityMinutes)
  )
  // The board arrives holding a proposal nobody has saved yet, so it starts
  // dirty whenever the suggestion says anything the plan doesn't already.
  const [dirty, setDirty] = useState(() => {
    const committed = committedKeys(initial)
    const proposed = itemsOf(suggestion)
    return proposed.length !== committed.size || proposed.some((i) => !committed.has(`${i.itemId}|${i.date}`))
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const start = view.weekStart
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    [start]
  )

  const byRef = useMemo(
    () => new Map(view.plannable.map((p) => [p.ref, p])),
    [view.plannable]
  )

  // What is already committed, so a proposal can be told apart from a plan.
  const committed = useMemo(() => committedKeys(view), [view])

  // Done and skipped rows are history: shown for context, never edited here.
  const settled = useMemo(
    () => view.plan.filter((p) => p.status !== 'planned'),
    [view.plan]
  )

  const onBoard = useMemo(() => new Set(items.map((i) => i.itemId)), [items])

  const change = useCallback((next: Item[]) => {
    setItems(next)
    setDirty(true)
    setSaved(false)
  }, [])

  const dispatch = useCallback((work: () => Promise<RoundsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
      if (result.ok) {
        setDirty(false)
        setSaved(true)
      }
    })
  }, [])

  const resuggest = useCallback(() => {
    startTransition(async () => {
      const result = await suggestWeekAction(start)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setItems(itemsOf(result.suggestion))
      setCapacity(result.suggestion.days.map((d) => d.capacityMinutes))
      setDirty(true)
      setSaved(false)
    })
  }, [start])

  const totalMinutes = items.reduce(
    (n, i) => n + (byRef.get(i.itemId)?.effortMinutes ?? 0),
    0
  )
  const totalCapacity = capacity.reduce((n, c) => n + c, 0)

  // Everything that has a claim on this week and isn't on the board.
  const weekEnd = addDays(start, 6)
  const leftOut = view.plannable
    .filter((c) => !onBoard.has(c.ref) && dayNumber(c.dueOn) <= dayNumber(weekEnd))
    .filter((c) => !settled.some((p) => p.ref === c.ref))
    .sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn))

  // Anything at all, for the "+ add" picker — including things not due for weeks,
  // because a free Saturday is the right moment to get ahead of the hedges.
  // Renewals outside their lead window are not in `plannable` at all, which is
  // the point: getting ahead is a chore's privilege, not a renewal's.
  const addable = view.plannable
    .filter((c) => !onBoard.has(c.ref))
    .sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn))

  return (
    <main className="pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-[27px] font-semibold tracking-tight">
            {dayOfMonth(start)} &ndash; {dayOfMonth(addDays(start, 6))}
          </h1>
          <p className="tnum text-[13px] text-ink-3">
            {items.length} item{items.length === 1 ? '' : 's'} · {minutesLabel(totalMinutes)} of{' '}
            {minutesLabel(totalCapacity)}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`/rounds/plan?week=${addDays(start, -7)}`}
            className="border border-rule px-2.5 py-1.5 font-mono text-[11px] text-ink-2 hover:border-rule-strong"
            aria-label="Previous week"
          >
            ←
          </Link>
          <Link
            href={`/rounds/plan?week=${addDays(start, 7)}`}
            className="border border-rule px-2.5 py-1.5 font-mono text-[11px] text-ink-2 hover:border-rule-strong"
            aria-label="Next week"
          >
            →
          </Link>
        </div>
      </div>

      <p className="mt-2 max-w-[62ch] text-[13px] text-ink-3">
        Suggested from what comes due and how much time each day has. Move anything you disagree
        with, then save — nothing is planned until you do.
      </p>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => dispatch(() => saveWeekPlanAction(start, items))}
          className="border border-ink bg-ink px-4 py-2.5 text-[13px] text-surface disabled:border-rule disabled:bg-surface-2 disabled:text-ink-4"
        >
          {dirty ? 'Save this plan' : saved ? 'Saved' : 'Nothing to save'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={resuggest}
          className="border border-rule px-4 py-2.5 text-[13px] text-ink-2 hover:border-rule-strong disabled:opacity-40"
        >
          Suggest again
        </button>
        <Link
          href="/rounds/settings"
          className="px-2 py-2.5 font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-ink-2"
        >
          DAY CAPACITY →
        </Link>
      </div>

      {/* A row per day rather than seven columns. Chore names are three or four
          words and a phone is 390 pixels wide; a column narrow enough to fit
          seven of them can hold neither. */}
      <div className="mt-5 flex flex-col gap-2">
        {dates.map((date, index) => {
          const dayItems = items.filter((i) => i.date === date)
          const used = dayItems.reduce((n, i) => n + (byRef.get(i.itemId)?.effortMinutes ?? 0), 0)
          const cap = capacity[index] ?? 0
          const over = used > cap
          const isToday = date === view.today
          const past = dayNumber(date) < dayNumber(view.today)
          const dayDone = settled.filter((p) => p.plannedOn === date)
          const empty = dayItems.length === 0 && dayDone.length === 0

          return (
            <section
              key={date}
              className={`border bg-surface ${isToday ? 'border-ink' : 'border-rule'} ${
                past ? 'opacity-60' : ''
              }`}
            >
              <div className="flex flex-col gap-3 p-3.5 md:flex-row md:items-start md:gap-5">
                <div className="shrink-0 md:w-[136px]">
                  <div className="font-mono text-[10px] tracking-[0.12em] text-ink-2">
                    {weekdayName(date).toUpperCase()}{' '}
                    <span className="text-ink-4">{dayOfMonth(date)}</span>
                    {isToday ? <span className="ml-2 text-ink-3">TODAY</span> : null}
                  </div>

                  {/* Load bar. The only part of this screen trying to stop you
                      planning an eleven-hour Saturday. */}
                  <div className="mt-2 h-[3px] w-full bg-surface-2">
                    <div
                      className={`h-full ${over ? 'bg-drain' : 'bg-charge'}`}
                      style={{
                        width: `${Math.min(100, cap === 0 ? (used > 0 ? 100 : 0) : (used / cap) * 100)}%`,
                      }}
                    />
                  </div>

                  <div
                    className={`tnum mt-1.5 font-mono text-[10px] ${
                      over ? 'text-drain-ink' : 'text-ink-4'
                    }`}
                  >
                    {minutesLabel(used)} / {minutesLabel(cap)}
                    {over ? ' · OVER' : ''}
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {empty ? (
                    <p className="py-1 font-mono text-[10px] tracking-[0.1em] text-ink-4">CLEAR</p>
                  ) : null}

                  {dayItems.map((item) => {
                    const subject = byRef.get(item.itemId)
                    if (!subject) return null
                    const late = dayNumber(date) > dayNumber(subject.dueOn)
                    const isCommitted = committed.has(`${item.itemId}|${date}`)

                    return (
                      <div
                        key={item.itemId}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border px-3 py-2 ${
                          isCommitted ? 'border-rule-2' : 'border-dashed border-rule'
                        }`}
                      >
                        <span className="min-w-[140px] flex-1 text-[14px]">
                          {subject.name}
                          {subject.kind === 'renewal' ? (
                            <span className="ml-2 font-mono text-[9px] tracking-[0.1em] text-ink-4">
                              RENEWAL
                            </span>
                          ) : null}
                        </span>

                        <span
                          className={`tnum shrink-0 font-mono text-[10px] tracking-[0.08em] ${
                            late ? 'text-drain-ink' : 'text-ink-4'
                          }`}
                        >
                          {late ? 'AFTER DUE' : dueLabel(subject.daysOverdue).toUpperCase()}
                        </span>
                        <span className="tnum w-10 shrink-0 text-right font-mono text-[11px] text-ink-3">
                          {minutesLabel(subject.effortMinutes)}
                        </span>

                        <select
                          value={date}
                          aria-label={`Move ${subject.name}`}
                          onChange={(event) =>
                            change(
                              items.map((i) =>
                                i.itemId === item.itemId ? { ...i, date: event.target.value } : i
                              )
                            )
                          }
                          className="shrink-0 border border-rule bg-surface px-1.5 py-1 font-mono text-[10px] text-ink-2"
                        >
                          {dates.map((d) => (
                            <option key={d} value={d}>
                              {weekdayName(d)} {dayOfMonth(d)}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => change(items.filter((i) => i.itemId !== item.itemId))}
                          className="shrink-0 px-1 font-mono text-[13px] leading-none text-ink-4 hover:text-drain-ink"
                          aria-label={`Remove ${subject.name}`}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}

                  {dayDone.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 px-3 py-1">
                      <span
                        className={`text-[13px] text-ink-4 ${
                          entry.status === 'done' ? 'line-through' : ''
                        }`}
                      >
                        {entry.name}
                      </span>
                      <span className="font-mono text-[9px] tracking-[0.1em] text-ink-4">
                        {entry.status === 'done' ? 'DONE' : 'SKIPPED'}
                      </span>
                    </div>
                  ))}

                  {adding === date ? (
                    <select
                      autoFocus
                      defaultValue=""
                      onBlur={() => setAdding(null)}
                      onChange={(event) => {
                        if (event.target.value) {
                          change([...items, { itemId: event.target.value, date }])
                        }
                        setAdding(null)
                      }}
                      className="w-full border border-rule-strong bg-surface px-2 py-2 text-[13px] md:max-w-[420px]"
                    >
                      <option value="">Pick something…</option>
                      {addable.map((c) => (
                        <option key={c.ref} value={c.ref}>
                          {c.name}
                          {c.kind === 'renewal' ? ' (renewal)' : ''} —{' '}
                          {minutesLabel(c.effortMinutes)}, {dueLabel(c.daysOverdue).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(date)}
                      className="self-start px-1 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-ink-2"
                    >
                      + ADD
                    </button>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      {leftOut.length > 0 ? (
        <section className="mt-5 border border-rule bg-surface p-5">
          <div className="font-mono text-[9px] tracking-[0.12em] text-drain-ink">
            DUE THIS WEEK · DIDN&rsquo;T FIT
          </div>
          <p className="mt-2 max-w-[62ch] text-[13px] text-ink-3">
            {minutesLabel(leftOut.reduce((n, c) => n + c.effortMinutes, 0))} more than the week has
            room for. Either put them in anyway, raise a day&rsquo;s capacity, or let them run late
            on purpose — the one thing that doesn&rsquo;t work is pretending they aren&rsquo;t there.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {leftOut.map((chore) => (
              <div
                key={chore.ref}
                className="flex flex-wrap items-center gap-3 border border-rule-2 px-3 py-2"
              >
                <span className="min-w-[140px] flex-1 text-[14px]">
                  {chore.name}
                  {chore.kind === 'renewal' ? (
                    <span className="ml-2 font-mono text-[9px] tracking-[0.1em] text-ink-4">
                      RENEWAL
                    </span>
                  ) : null}
                </span>
                <span className="tnum font-mono text-[10px] tracking-[0.1em] text-ink-3">
                  {dueLabel(chore.daysOverdue).toUpperCase()}
                </span>
                <span className="tnum w-10 text-right font-mono text-[11px] text-ink-3">
                  {minutesLabel(chore.effortMinutes)}
                </span>
                <select
                  defaultValue=""
                  aria-label={`Plan ${chore.name}`}
                  onChange={(event) => {
                    if (event.target.value) {
                      change([...items, { itemId: chore.ref, date: event.target.value }])
                    }
                  }}
                  className="border border-rule bg-surface px-2 py-1 font-mono text-[10px] text-ink-2"
                >
                  <option value="">Put on…</option>
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {weekdayName(d)} {dayOfMonth(d)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
