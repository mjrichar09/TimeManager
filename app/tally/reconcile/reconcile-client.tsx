'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Day, Segment } from '@/lib/day'
import {
  completeDayAction,
  deleteBlockAction,
  fillGapAction,
  loadDayAction,
  moveEdgeAction,
  recategorizeAction,
  splitBlockAction,
  type ActionResult,
} from '../actions'

export type Category = { slug: string; name: string }

function localWindow(offsetDays: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays)
  const end = new Date(start.getTime() + 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    from: start.toISOString(),
    to: end.toISOString(),
  }
}

/** How many days back a given YYYY-MM-DD is from today, local time. */
function offsetForDate(date: string | null): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0
  const [y, m, d] = date.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000))
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

/** "HH:MM" in local time, for a native <input type="time">. */
function toTimeValue(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Turn "HH:MM" back into an instant, anchored to the day `base` falls on. If the
 * result lands before `base` it belongs to the next day — which happens for a
 * segment running up to midnight.
 */
function fromTimeValue(base: string, hhmm: string): string {
  const anchor = new Date(base)
  const [h, m] = hhmm.split(':').map(Number)
  const candidate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), h, m, 0, 0)
  if (candidate.getTime() < anchor.getTime()) candidate.setDate(candidate.getDate() + 1)
  return candidate.toISOString()
}

function midpoint(a: string, b: string): string {
  return new Date(Math.round((new Date(a).getTime() + new Date(b).getTime()) / 2 / 60000) * 60000).toISOString()
}

function fill(segment: Segment, selected: boolean): string {
  if (segment.kind === 'gap') return 'transparent'
  if (selected) return segment.energy > 0 ? '#7fb0ea' : segment.energy < 0 ? '#ef9a99' : '#c9c7bd'
  return segment.energy > 0 ? '#cfdff6' : segment.energy < 0 ? '#f7d5d4' : '#e4e3dd'
}

export default function ReconcileClient({ categories }: { categories: Category[] }) {
  const params = useSearchParams()
  const [offset, setOffset] = useState(() => offsetForDate(params.get('date')))
  const [day, setDay] = useState<Day | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [splitTime, setSplitTime] = useState<string | null>(null)
  const [fillUntil, setFillUntil] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const window = useMemo(() => localWindow(offset), [offset])

  const apply = useCallback((result: ActionResult) => {
    if (result.day) setDay(result.day)
    setError(result.ok ? null : result.error)
  }, [])

  const dispatch = useCallback(
    (work: () => Promise<ActionResult>, onSuccess?: () => void) => {
      startTransition(async () => {
        const result = await work()
        apply(result)
        if (result.ok) onSuccess?.()
      })
    },
    [apply]
  )

  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const result = await loadDayAction(window)
      if (cancelled) return
      setSelected(0)
      setSplitTime(null)
      setFillUntil(null)
      apply(result)
    })
    return () => {
      cancelled = true
    }
  }, [window, apply])

  if (!day) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-3">LOADING THE DAY…</p>
      </main>
    )
  }

  const segments = day.segments
  const current = segments[Math.min(selected, segments.length - 1)] as Segment | undefined
  const isGap = current?.kind === 'gap'
  const dateLabel = new Date(`${day.date}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

  return (
    <main className="flex flex-1 flex-col">
      <header className="px-4 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            className="font-mono text-[10px] tracking-[0.14em] text-ink-3"
          >
            ‹ PREV
          </button>
          <span className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
            RECONCILE · {dateLabel.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            className="font-mono text-[10px] tracking-[0.14em] text-ink-3 disabled:text-ink-4/40"
          >
            NEXT ›
          </button>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tracking-tight">
            {duration(day.loggedMinutes)} logged
          </div>
          <div
            className={`tnum font-mono text-[13px] ${day.gapCount === 0 ? 'text-ink-2' : 'text-drain-ink'}`}
          >
            {day.gapCount === 0 ? 'no gaps' : `${day.gapCount} gaps · ${duration(day.gapMinutes)}`}
          </div>
        </div>
      </header>

      <div className="px-4">
        <div className="flex h-[104px] gap-[2px] border border-rule bg-surface p-[2px]">
          {segments.map((segment, index) => (
            <button
              key={`${segment.kind}-${segment.startedAt}`}
              type="button"
              onClick={() => {
                setSelected(index)
                setSplitTime(null)
                setFillUntil(null)
              }}
              aria-label={`${segment.name} ${clock(segment.startedAt)}`}
              className={`block h-full min-w-[8px] ${segment.kind === 'gap' ? 'gap-hatch' : ''}`}
              style={{
                flexGrow: segment.minutes,
                flexBasis: 0,
                background: fill(segment, index === selected),
                boxShadow: index === selected ? 'inset 0 0 0 2px #141414' : 'none',
              }}
            />
          ))}
        </div>
        <div className="tnum mt-1.5 flex justify-between font-mono text-[9px] tracking-[0.08em] text-ink-3">
          <span>{clock(day.from)}</span>
          <span>{clock(day.to)}</span>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">
          {error}
        </div>
      ) : null}

      {current ? (
        <div className="mx-4 mt-4 border border-rule bg-surface p-4">
          <div
            className={`font-mono text-[10px] tracking-[0.14em] ${isGap ? 'text-drain-ink' : 'text-ink-3'}`}
          >
            {isGap ? 'UNLOGGED GAP' : current.live ? 'RUNNING NOW' : 'SELECTED BLOCK'}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <div className="text-[19px] font-semibold tracking-tight">{current.name}</div>
            <div className="tnum font-mono text-[13px] text-ink-2">
              {clock(current.startedAt)} – {current.live ? 'now' : clock(current.endedAt)}
            </div>
          </div>

          {!isGap && current.id ? (
            <div className="mt-3.5 flex gap-5 border-t border-rule-2 pt-3.5">
              <div>
                <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">START</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => dispatch(() => moveEdgeAction(window, current.id!, 'start', -5))}
                    className="size-[46px] border border-rule-strong bg-surface text-[17px] active:bg-surface-2 disabled:opacity-40"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => dispatch(() => moveEdgeAction(window, current.id!, 'start', 5))}
                    className="size-[46px] border border-rule-strong bg-surface text-[17px] active:bg-surface-2 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">END</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending || current.running}
                    onClick={() => dispatch(() => moveEdgeAction(window, current.id!, 'end', -5))}
                    className="size-[46px] border border-rule-strong bg-surface text-[17px] active:bg-surface-2 disabled:opacity-40"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    disabled={pending || current.running}
                    onClick={() => dispatch(() => moveEdgeAction(window, current.id!, 'end', 5))}
                    className="size-[46px] border border-rule-strong bg-surface text-[17px] active:bg-surface-2 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">LENGTH</div>
                <div className="tnum mt-1 font-mono text-[21px] font-medium tracking-tight">
                  {duration(current.minutes)}
                </div>
              </div>
            </div>
          ) : null}

          {!isGap && current.id ? (
            <div className="mt-4 flex items-end gap-2.5 border-t border-rule-2 pt-3.5">
              <div className="flex-1">
                <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                  SPLIT AT
                </div>
                <input
                  type="time"
                  value={splitTime ?? toTimeValue(midpoint(current.startedAt, current.endedAt))}
                  onChange={(event) => setSplitTime(event.target.value)}
                  className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-3 font-mono text-[17px] outline-none focus:border-rule-strong"
                />
              </div>
              <button
                type="button"
                disabled={pending || current.minutes < 2}
                onClick={() =>
                  dispatch(
                    () =>
                      splitBlockAction(
                        window,
                        current.id!,
                        fromTimeValue(
                          current.startedAt,
                          splitTime ?? toTimeValue(midpoint(current.startedAt, current.endedAt))
                        )
                      ),
                    // Land on the second half — the piece you split off is
                    // almost always the one you meant to relabel.
                    () => setSelected((i) => i + 1)
                  )
                }
                className="border border-ink bg-ink px-4 py-3.5 text-sm text-surface disabled:opacity-40"
              >
                Split
              </button>
            </div>
          ) : null}

          {isGap ? (
            <div className="mt-4 border-t border-rule-2 pt-3.5">
              <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                FILL FROM {clock(current.startedAt)} UNTIL
              </div>
              <input
                type="time"
                value={fillUntil ?? toTimeValue(current.endedAt)}
                onChange={(event) => setFillUntil(event.target.value)}
                className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-3 font-mono text-[17px] outline-none focus:border-rule-strong"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
                Defaults to the whole gap. Shorten it to log one thing at a time — what is
                left stays a gap.
              </p>
            </div>
          ) : null}

          <div className="mt-4 font-mono text-[9px] tracking-[0.12em] text-ink-3">
            {isGap ? 'FILL WITH' : 'RECATEGORISE'}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-[5px]">
            {categories.map((category) => {
              const active = !isGap && category.slug === current.slug
              return (
                <button
                  key={category.slug}
                  type="button"
                  disabled={pending || active}
                  onClick={() =>
                    dispatch(() =>
                      isGap
                        ? fillGapAction(
                            window,
                            current.startedAt,
                            fillUntil
                              ? fromTimeValue(current.startedAt, fillUntil)
                              : current.endedAt,
                            category.slug
                          )
                        : recategorizeAction(window, current.id!, category.slug)
                    )
                  }
                  className={`border px-2.5 py-[11px] text-left text-xs leading-tight disabled:opacity-100 ${
                    active ? 'border-ink bg-ink text-surface' : 'border-rule bg-surface text-ink'
                  }`}
                >
                  {category.name}
                </button>
              )
            })}
          </div>

          {!isGap && current.id && !current.running ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => dispatch(() => deleteBlockAction(window, current.id!))}
              className="mt-3 w-full border border-rule px-3 py-2.5 font-mono text-[10px] tracking-[0.12em] text-drain-ink disabled:opacity-40"
            >
              DELETE — LEAVE IT UNLOGGED
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto border-t border-rule p-4">
        {day.complete ? (
          <Link
            href={`/tally/check?date=${day.date}`}
            className="block w-full border border-ink bg-ink px-3 py-[17px] text-center text-[15px] text-surface"
          >
            Day complete — go to check
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => dispatch(() => completeDayAction(window))}
            className="w-full border border-ink bg-ink px-3 py-[17px] text-[15px] text-surface disabled:opacity-40"
          >
            {day.gapCount === 0 ? 'Mark day complete' : 'Mark day complete anyway'}
          </button>
        )}
      </div>
    </main>
  )
}
