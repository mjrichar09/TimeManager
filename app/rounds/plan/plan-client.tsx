'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import type { RoundsView } from '@/lib/rounds'
import { addDays, dayNumber, weekCapacity, type SuggestedWeek } from '@/lib/rounds-plan'
import {
  saveWeekPlanAction,
  suggestWeekAction,
  type RoundsResult,
} from '../actions'
import { dayOfMonth, dueLabel, minutesLabel, weekdayName } from '../format'

type Item = { itemId: string; date: string }

/** A chip being carried between days. `from` is null for one lifted out of the tray. */
type Carry = { ref: string; from: string | null; x: number; y: number; moved: boolean; over: string | null }

/** Past this many pixels a press is a drag; under it, it was a tap. */
const DRAG_THRESHOLD = 6

/** Flatten a suggestion into the flat list the board and the save action both speak. */
function itemsOf(suggestion: SuggestedWeek): Item[] {
  return suggestion.days.flatMap((day) =>
    day.items.map((i) => ({ itemId: i.itemId, date: day.date }))
  )
}

/** The saved week, in the same flat shape — what the board shows when there is a plan. */
function committedItems(view: RoundsView): Item[] {
  return view.plan
    .filter((p) => p.status === 'planned')
    .map((p) => ({ itemId: p.ref, date: p.plannedOn }))
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
  /** Null for a week that already has a saved plan — that plan is the board. */
  suggestion: SuggestedWeek | null
}) {
  const [view, setView] = useState(initial)
  const [items, setItems] = useState<Item[]>(() =>
    suggestion ? itemsOf(suggestion) : committedItems(initial)
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [carry, setCarry] = useState<Carry | null>(null)
  const pressAt = useRef<{ x: number; y: number } | null>(null)
  const [pending, startTransition] = useTransition()

  const start = view.weekStart

  // Derived, not held: capacity is settings plus which days have already gone,
  // and both of those come back fresh inside `view` after every save.
  const capacity = useMemo(
    () => weekCapacity(start, view.today, view.settings.dayMinutes),
    [start, view.today, view.settings.dayMinutes]
  )
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

  // Whether the board differs from what is stored, worked out rather than
  // tracked with a flag: shuffle something and shuffle it back and there is
  // genuinely nothing to save, so the button should say so.
  const dirty = useMemo(
    () =>
      items.length !== committed.size ||
      items.some((i) => !committed.has(`${i.itemId}|${i.date}`)),
    [items, committed]
  )

  const change = useCallback((next: Item[]) => {
    setItems(next)
    setSaved(false)
  }, [])

  const dispatch = useCallback((work: () => Promise<RoundsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
      if (result.ok) setSaved(true)
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

  const capFor = (date: string) => capacity[dates.indexOf(date)] ?? 0
  const usedOn = (date: string) =>
    items
      .filter((i) => i.date === date)
      .reduce((n, i) => n + (byRef.get(i.itemId)?.effortMinutes ?? 0), 0)

  // The day the panel below the gauges is showing. Today, when today is in this
  // week; otherwise the first day that still has room to plan into.
  const selected =
    focus && dates.includes(focus)
      ? focus
      : dates.includes(view.today)
        ? view.today
        : (dates.find((d) => dayNumber(d) >= dayNumber(view.today)) ?? dates[0])

  const place = useCallback(
    (ref: string, from: string | null, to: string) => {
      if (from === to) return
      if (from === null) change([...items.filter((i) => i.itemId !== ref), { itemId: ref, date: to }])
      else change(items.map((i) => (i.itemId === ref ? { ...i, date: to } : i)))
      if (navigator.vibrate) navigator.vibrate(10)
    },
    [items, change]
  )

  // ---- carrying a chip onto a gauge ----
  const dayUnder = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-day]') as HTMLElement | null
    return el?.dataset.day ?? null
  }

  const lift = (ref: string, from: string | null) => (event: React.PointerEvent) => {
    if (event.button !== 0) return
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    pressAt.current = { x: event.clientX, y: event.clientY }
    setCarry({ ref, from, x: event.clientX, y: event.clientY, moved: false, over: null })
  }

  const carryMove = (event: React.PointerEvent) => {
    if (!carry || !pressAt.current) return
    const moved =
      carry.moved ||
      Math.hypot(event.clientX - pressAt.current.x, event.clientY - pressAt.current.y) > DRAG_THRESHOLD
    setCarry({ ...carry, x: event.clientX, y: event.clientY, moved, over: moved ? dayUnder(event.clientX, event.clientY) : null })
  }

  const drop = () => {
    if (!carry) return
    const { ref, from, moved, over } = carry
    setCarry(null)
    pressAt.current = null
    if (moved) {
      if (over) place(ref, from, over)
      return
    }
    // A tap, not a drag: a tray chip goes onto the day being shown.
    if (from === null) place(ref, null, selected)
  }

  const chipProps = (ref: string, from: string | null) => ({
    onPointerDown: lift(ref, from),
    onPointerMove: carryMove,
    onPointerUp: drop,
    onPointerCancel: () => {
      setCarry(null)
      pressAt.current = null
    },
  })

  const maxCap = Math.max(60, ...capacity, ...dates.map(usedOn))
  const GAUGE_H = 150
  const selectedItems = items.filter((i) => i.date === selected)
  const selectedDone = settled.filter((p) => p.plannedOn === selected)
  const carried = carry?.moved ? byRef.get(carry.ref) : undefined

  return (
    <main className="mx-auto max-w-[620px] pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label">Week of {dayOfMonth(start)}</div>
          <h1 className="tnum font-display text-[28px] leading-tight font-semibold">
            {minutesLabel(totalMinutes)} of {minutesLabel(totalCapacity)}
          </h1>
          <p className="tnum font-mono text-[10.5px] text-ink-3">
            {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
            {committed.size > 0 ? 'saved weeks reopen as saved' : 'suggested, not saved yet'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <Link
            href={`/rounds/plan?week=${addDays(start, -7)}`}
            className="grid size-9 place-items-center rounded-full border border-rule text-[13px] text-ink-2 hover:border-rule-strong"
            aria-label="Previous week"
          >
            ←
          </Link>
          <Link
            href={`/rounds/plan?week=${addDays(start, 7)}`}
            className="grid size-9 place-items-center rounded-full border border-rule text-[13px] text-ink-2 hover:border-rule-strong"
            aria-label="Next week"
          >
            →
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {/* Seven gauges. Height is the day's capacity, the fill is what's planned
          on it, and anything over capacity spills out of the top in red. They
          are also where a carried chip is dropped. */}
      <div className="mt-5 grid grid-cols-7 items-end gap-1.5 sm:gap-3" style={{ height: GAUGE_H + 64 }}>
        {dates.map((date) => {
          const cap = capFor(date)
          const used = usedOn(date)
          const h = Math.max(16, (cap / maxCap) * GAUGE_H)
          const level = cap > 0 ? (Math.min(used, cap) / cap) * (h - 4) : 0
          const spill = used > cap ? Math.min(GAUGE_H - h + 10, ((used - cap) / maxCap) * GAUGE_H) : 0
          const isToday = date === view.today
          const past = dayNumber(date) < dayNumber(view.today)
          const over = carry?.moved && carry.over === date
          return (
            <button
              key={date}
              type="button"
              data-day={date}
              onClick={() => setFocus(date)}
              aria-pressed={date === selected}
              aria-label={`${weekdayName(date)} ${dayOfMonth(date)}: ${minutesLabel(used)} of ${minutesLabel(cap)}`}
              className={`flex h-full flex-col items-stretch justify-end gap-1 text-center ${past ? 'opacity-45' : ''}`}
            >
              <span
                className={`relative block rounded-[7px] border bg-surface transition-[border-color,transform] duration-150 ${
                  over
                    ? 'scale-[1.04] border-2 border-charge'
                    : date === selected
                      ? 'border-2 border-ink'
                      : cap === 0
                        ? 'border-dashed border-rule-strong'
                        : 'border-[1.5px] border-rule-strong'
                }`}
                style={{ height: h }}
              >
                {level > 0 ? (
                  <span
                    className="absolute inset-x-[2px] bottom-[2px] rounded-[4px] bg-charge/85 transition-[height] duration-300"
                    style={{ height: level }}
                  />
                ) : null}
                {spill > 0 ? (
                  <span
                    className="absolute inset-x-[2px] rounded-[4px] bg-drain transition-[height] duration-300"
                    style={{ bottom: h + 2, height: spill }}
                  />
                ) : null}
              </span>
              <span
                className={`font-display text-[12px] font-semibold ${isToday ? 'underline decoration-2 underline-offset-[3px]' : ''}`}
              >
                {weekdayName(date).slice(0, 1)} {dayOfMonth(date).split(' ')[0]}
              </span>
              <span className={`tnum font-mono text-[9px] ${used > cap ? 'text-drain-ink' : 'text-ink-3'}`}>
                {cap === 0 && used === 0 ? 'off' : `${used}/${cap}`}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => dispatch(() => saveWeekPlanAction(start, items))}
          className="rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-surface disabled:bg-surface-2 disabled:text-ink-4"
        >
          {dirty ? 'Save this plan' : saved ? 'Saved' : 'Nothing to save'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={resuggest}
          className="rounded-lg border border-rule px-4 py-2.5 text-[13px] font-medium text-ink-2 hover:border-rule-strong disabled:opacity-40"
        >
          Suggest again
        </button>
        <Link href="/rounds/settings" className="label ml-auto hover:text-ink-2">
          Day capacity →
        </Link>
      </div>

      {/* The day under the gauges. */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <span className="label">
            {weekdayName(selected)} {dayOfMonth(selected)} · {minutesLabel(usedOn(selected))} of{' '}
            {minutesLabel(capFor(selected))}
          </span>
          {selected === view.today ? <span className="label">Today</span> : null}
        </div>

        <div className="flex flex-col gap-1.5 pt-2.5">
          {selectedItems.map((item) => {
            const subject = byRef.get(item.itemId)
            if (!subject) return null
            const late = dayNumber(item.date) > dayNumber(subject.dueOn)
            const isCommitted = committed.has(`${item.itemId}|${item.date}`)
            return (
              <div
                key={item.itemId}
                {...chipProps(item.itemId, item.date)}
                className={`flex touch-none cursor-grab items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 select-none active:cursor-grabbing ${
                  isCommitted ? 'border-rule-2' : 'border-dashed border-rule-strong'
                } ${carry?.moved && carry.ref === item.itemId ? 'opacity-30' : ''}`}
              >
                <span aria-hidden className="font-mono text-[11px] leading-none text-ink-4">⋮⋮</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {subject.name}
                  {subject.kind === 'renewal' ? <span className="label ml-2">Renewal</span> : null}
                </span>
                <span className={`tnum font-mono text-[10px] ${late ? 'text-drain-ink' : 'text-ink-3'}`}>
                  {late ? 'after due' : dueLabel(subject.daysOverdue).toLowerCase()}
                </span>
                <span className="tnum w-10 text-right font-mono text-[10.5px] text-ink-3">
                  {minutesLabel(subject.effortMinutes)}
                </span>
                <select
                  value={item.date}
                  aria-label={`Move ${subject.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => place(item.itemId, item.date, event.target.value)}
                  className="w-[22px] appearance-none bg-transparent text-center font-mono text-[11px] text-ink-3"
                  title="Move to another day"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {weekdayName(d)} {dayOfMonth(d)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => change(items.filter((i) => i.itemId !== item.itemId))}
                  className="px-1 font-mono text-[14px] leading-none text-ink-4 hover:text-drain-ink"
                  aria-label={`Remove ${subject.name}`}
                >
                  ×
                </button>
              </div>
            )
          })}

          {selectedDone.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-1">
              <span className={`text-[13px] text-ink-4 ${entry.status === 'done' ? 'line-through' : ''}`}>
                {entry.name}
              </span>
              <span className="label">{entry.status === 'done' ? 'Done' : 'Skipped'}</span>
            </div>
          ))}

          {selectedItems.length === 0 && selectedDone.length === 0 ? (
            <div className="rounded-lg border-[1.5px] border-dashed border-rule-strong px-3 py-3 text-center text-[12.5px] text-ink-3">
              Clear. Drop something here, or tap a chip below.
            </div>
          ) : null}

          {adding === selected ? (
            <select
              autoFocus
              defaultValue=""
              onBlur={() => setAdding(null)}
              onChange={(event) => {
                if (event.target.value) change([...items, { itemId: event.target.value, date: selected }])
                setAdding(null)
              }}
              className="w-full rounded-lg border border-rule-strong bg-surface px-2 py-2 text-[13px]"
            >
              <option value="">Pick something…</option>
              {addable.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.name}
                  {c.kind === 'renewal' ? ' (renewal)' : ''} — {minutesLabel(c.effortMinutes)},{' '}
                  {dueLabel(c.daysOverdue).toLowerCase()}
                </option>
              ))}
            </select>
          ) : (
            <button type="button" onClick={() => setAdding(selected)} className="label self-start py-1 hover:text-ink-2">
              + Add anything
            </button>
          )}
        </div>
      </section>

      {leftOut.length > 0 ? (
        <section className="mt-6 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-baseline justify-between">
            <span className="label text-drain-ink">
              Didn&rsquo;t fit · {minutesLabel(leftOut.reduce((n, c) => n + c.effortMinutes, 0))}
            </span>
            <span className="label">Drag onto a day, or tap</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {leftOut.map((chore) => (
              <span
                key={chore.ref}
                {...chipProps(chore.ref, null)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    place(chore.ref, null, selected)
                  }
                }}
                className={`inline-flex touch-none cursor-grab items-center gap-1.5 rounded-full border border-drain-fill bg-surface px-3 py-1.5 text-[12px] font-medium select-none active:cursor-grabbing ${
                  carry?.moved && carry.ref === chore.ref ? 'opacity-30' : ''
                }`}
              >
                {chore.name}
                <span className="tnum font-mono text-[9.5px] text-drain-ink">
                  {minutesLabel(chore.effortMinutes)}
                  {chore.daysOverdue > 0 ? ` · ${chore.daysOverdue}d late` : ''}
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {carried && carry ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rotate-[-3deg] rounded-lg border-[1.5px] border-ink bg-surface px-3 py-1.5 text-[12px] font-medium whitespace-nowrap shadow-[0_12px_24px_-10px_rgba(0,0,0,0.4)]"
          style={{ left: carry.x, top: carry.y }}
        >
          {carried.name}
          <span className="tnum block font-mono text-[9.5px] text-ink-3">
            {minutesLabel(carried.effortMinutes)}
            {carry.over ? ` → ${weekdayName(carry.over)} ${dayOfMonth(carry.over)}` : ''}
          </span>
        </div>
      ) : null}
    </main>
  )
}
