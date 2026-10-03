'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
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

export type Category = { slug: string; name: string; energy: number }

const MINUTE = 60_000
/** Drags land on the five-minute grid. Nobody remembers a block to the minute. */
const SNAP = 5

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

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

function energyColor(energy: number): string {
  if (energy > 0) return 'var(--color-charge)'
  if (energy < 0) return 'var(--color-drain)'
  return 'var(--color-neutral)'
}

/** The tint a block wears on the tape: its energy mixed into the surface. */
function tint(segment: Segment, selected: boolean): string {
  if (segment.kind === 'gap') return 'transparent'
  return `color-mix(in srgb, ${energyColor(segment.energy)} ${selected ? 42 : 24}%, var(--color-surface))`
}

const ms = (iso: string) => new Date(iso).getTime()
const snap = (t: number) => Math.round(t / (SNAP * MINUTE)) * SNAP * MINUTE

/** A held handle. The zoom window is frozen with it, so the ground under your
 * finger doesn't rescale as the block you're dragging changes length. */
type Drag = {
  edge: 'start' | 'end'
  original: number
  value: number
  range: [number, number]
  /** Let go and saving: the edge stays where it was dropped until the save lands,
   * rather than snapping back to its old place for a beat and then jumping. */
  released?: boolean
}

export default function ReconcileClient({ categories }: { categories: Category[] }) {
  const params = useSearchParams()
  const [offset, setOffset] = useState(() => offsetForDate(params.get('date')))
  const [day, setDay] = useState<Day | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [splitAt, setSplitAt] = useState<number | null>(null)
  const [fillUntil, setFillUntil] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The zoom window last used for a drag. It is kept while the same block stays
  // selected and still fits, so a save doesn't re-centre the tape under you.
  const [sticky, setSticky] = useState<[number, number] | null>(null)
  const [pending, startTransition] = useTransition()
  const tapeRef = useRef<HTMLDivElement>(null)

  const window = useMemo(() => localWindow(offset), [offset])

  const apply = useCallback((result: ActionResult) => {
    if (result.day) setDay(result.day)
    setError(result.ok ? null : result.error)
  }, [])

  const dispatch = useCallback(
    (work: () => Promise<ActionResult>, onSuccess?: () => void, onSettled?: () => void) => {
      startTransition(async () => {
        const result = await work()
        apply(result)
        if (result.ok) onSuccess?.()
        onSettled?.()
      })
    },
    [apply]
  )

  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const result = await loadDayAction(window)
      if (cancelled) return
      // Open on the first gap, since that is what reconcile is for; with no gaps,
      // on the latest block, the one most likely to need a correction.
      if (result.day) {
        const segs = result.day.segments
        const gap = segs.findIndex((x) => x.kind === 'gap')
        setSelected(gap >= 0 ? gap : Math.max(0, segs.length - 1))
      }
      setSplitAt(null)
      setFillUntil(null)
      setSticky(null)
      apply(result)
    })
    return () => {
      cancelled = true
    }
  }, [window, apply])

  const select = (index: number) => {
    setSelected(index)
    setSplitAt(null)
    setFillUntil(null)
    setSticky(null)
  }

  if (!day) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="label">Loading the day…</p>
      </main>
    )
  }

  const segments = day.segments
  const index = Math.min(selected, segments.length - 1)
  const current = segments[index] as Segment | undefined
  const isGap = current?.kind === 'gap'
  const dayFrom = ms(day.from)
  const dayTo = ms(day.to)
  const daySpan = Math.max(MINUTE, dayTo - dayFrom)
  const dateLabel = new Date(`${day.date}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

  // ---- the selected block's edges, live while dragging ----
  const segStart = current ? ms(current.startedAt) : dayFrom
  const segEnd = current ? ms(current.endedAt) : dayTo
  const shownStart = drag?.edge === 'start' ? drag.value : segStart
  const shownEnd = drag?.edge === 'end' ? drag.value : isGap && fillUntil ? fillUntil : segEnd
  const split = splitAt ?? snap((segStart + segEnd) / 2)

  // ---- the zoom window around the selection ----
  const range: [number, number] = (() => {
    if (drag) return drag.range
    if (sticky && segStart >= sticky[0]) {
      // The running block ends at "now", which moves on between saves, so its
      // window follows the clock rather than being dropped and re-centred.
      if (current?.live) return [sticky[0], Math.max(sticky[1], dayTo)]
      if (segEnd <= sticky[1]) return sticky
    }
    const len = segEnd - segStart
    const pad = Math.max(30 * MINUTE, len * 0.45)
    let a = segStart - pad
    let b = segEnd + pad
    const minSpan = 2 * 60 * MINUTE
    if (b - a < minSpan) {
      const extra = (minSpan - (b - a)) / 2
      a -= extra
      b += extra
    }
    if (a < dayFrom) {
      b += dayFrom - a
      a = dayFrom
    }
    if (b > dayTo) {
      a -= b - dayTo
      b = dayTo
    }
    return [Math.max(dayFrom, a), Math.min(dayTo, b)]
  })()
  const span = Math.max(MINUTE, range[1] - range[0])
  const pct = (t: number) => ((t - range[0]) / span) * 100

  const timeAt = (clientX: number) => {
    const rect = tapeRef.current?.getBoundingClientRect()
    if (!rect) return range[0]
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return range[0] + f * span
  }

  // ---- dragging a handle ----
  const beginDrag = (edge: 'start' | 'end', original: number) => (event: React.PointerEvent) => {
    if (pending || drag) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setSticky(range)
    setDrag({ edge, original, value: original, range })
  }

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag || drag.released) return
    let t = snap(timeAt(event.clientX))
    // Keep at least five minutes of the block, and never past the window.
    if (drag.edge === 'start') t = Math.min(t, (isGap ? segEnd : shownEnd) - SNAP * MINUTE)
    else t = Math.max(t, shownStart + SNAP * MINUTE)
    // An edge pushes its neighbour but may not swallow it: the server refuses
    // that, and finding out only on release reads as the drag not working.
    const prev = segments[index - 1]
    const next = segments[index + 1]
    if (!isGap && drag.edge === 'start' && prev) {
      t = Math.max(t, ms(prev.startedAt) + (prev.kind === 'block' ? SNAP * MINUTE : 0))
    }
    if (!isGap && drag.edge === 'end' && next) {
      t = Math.min(t, ms(next.endedAt) - (next.kind === 'block' ? SNAP * MINUTE : 0))
    }
    if (isGap) t = Math.min(t, segEnd)
    t = Math.max(dayFrom, Math.min(dayTo, t))
    if (t !== drag.value) {
      setDrag({ ...drag, value: t })
      if (navigator.vibrate) navigator.vibrate(4)
    }
  }

  const endDrag = () => {
    if (!drag || drag.released || !current) return
    const finished = drag
    // Rounded up, not to nearest: block starts carry seconds (12:41:40), and the
    // server moves the edge by whole minutes from there. Rounding up lands it in
    // the minute the handle showed; rounding to nearest could land a minute short
    // and the label would tick back as the save arrived.
    const delta = Math.ceil((finished.value - finished.original) / MINUTE)
    if (delta === 0 || isGap) {
      setDrag(null)
      // On a gap the handle doesn't move anything yet — it chooses how much of
      // the gap the next category tap will fill.
      if (delta !== 0) setFillUntil(finished.value)
      return
    }
    setDrag({ ...finished, released: true })
    dispatch(
      () => moveEdgeAction(window, current.id!, finished.edge, delta),
      undefined,
      () => setDrag(null)
    )
  }

  const tapTape = (event: React.MouseEvent) => {
    if (!current || isGap || current.minutes < 2) return
    const t = snap(timeAt(event.clientX))
    if (t > segStart && t < segEnd) setSplitAt(t)
  }

  const ticks: number[] = []
  {
    const stepH = span > 8 * 60 * MINUTE ? 3 : span > 4 * 60 * MINUTE ? 2 : 1
    const first = new Date(range[0])
    first.setMinutes(0, 0, 0)
    for (let t = first.getTime(); t <= range[1]; t += stepH * 60 * MINUTE) if (t >= range[0]) ticks.push(t)
  }

  const canDragStart = !!current && !isGap
  const canDragEnd = !!current && (isGap || !current.running)

  return (
    <main className="flex flex-1 flex-col md:mx-auto md:w-full md:max-w-[640px]">
      <header className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setOffset((o) => o + 1)} className="label hover:text-ink">
            ‹ Prev
          </button>
          <span className="label">{dateLabel}</span>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            className="label hover:text-ink disabled:opacity-30"
          >
            Next ›
          </button>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h1 className="tnum font-display text-[28px] leading-tight font-semibold">
            {duration(day.loggedMinutes)} logged
          </h1>
          <span className={`label ${day.gapCount === 0 ? '' : 'text-drain-ink'}`}>
            {day.gapCount === 0 ? 'No gaps' : `${day.gapCount} gap${day.gapCount === 1 ? '' : 's'} · ${duration(day.gapMinutes)}`}
          </span>
        </div>
      </header>

      {/* The whole day. Tap any piece to select it; the outlined window is the
          stretch the tape below is zoomed into. */}
      <div className="px-5">
        <div className="relative">
          <div className="flex h-[20px] gap-px overflow-hidden rounded-[4px]">
            {segments.map((segment, i) => (
              <button
                key={`${segment.kind}-${segment.startedAt}`}
                type="button"
                onClick={() => select(i)}
                aria-label={`${segment.name} ${clock(ms(segment.startedAt))}`}
                className={`block h-full min-w-[3px] ${segment.kind === 'gap' ? 'gap-hatch' : ''}`}
                style={{
                  flexGrow: segment.minutes,
                  flexBasis: 0,
                  background: segment.kind === 'gap' ? undefined : energyColor(segment.energy),
                  opacity: i === index ? 1 : 0.85,
                }}
              />
            ))}
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[4px] -bottom-[4px] rounded-[5px] border-[1.5px] border-ink transition-[left,width] duration-200"
            style={{
              left: `${((range[0] - dayFrom) / daySpan) * 100}%`,
              width: `${((range[1] - range[0]) / daySpan) * 100}%`,
            }}
          />
        </div>
        <div className="tnum mt-1.5 flex justify-between font-mono text-[9.5px] text-ink-3">
          <span>{clock(dayFrom)}</span>
          <span>{clock(dayTo)}</span>
        </div>
      </div>

      {/* The tape: the zoomed stretch, with handles on the selected block. */}
      <div
        onClick={tapTape}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative mt-5 h-[150px] touch-none border-y border-rule bg-surface select-none"
      >
        {/* Inset, so a handle at either end of the window stays on screen. */}
        <div ref={tapeRef} className="absolute inset-y-0 right-6 left-6">
        {segments.map((segment, i) => {
          let a = ms(segment.startedAt)
          let b = ms(segment.endedAt)
          if (i === index) {
            a = shownStart
            b = isGap ? segEnd : shownEnd
          } else if (drag && !isGap) {
            // A dragged edge pushes its neighbour rather than overlapping it.
            if (i === index - 1 && drag.edge === 'start') b = Math.min(b, shownStart)
            if (i === index + 1 && drag.edge === 'end') a = Math.max(a, shownEnd)
          }
          const s = Math.max(a, range[0])
          const e = Math.min(b, range[1])
          if (e <= s) return null
          const width = pct(e) - pct(s)
          return (
            <button
              key={`${segment.kind}-${segment.startedAt}`}
              type="button"
              onClick={(event) => {
                if (i !== index) {
                  event.stopPropagation()
                  select(i)
                }
              }}
              className={`absolute top-[34px] bottom-[38px] flex items-end overflow-hidden rounded-[4px] px-1.5 pb-1.5 text-left text-[11px] font-medium whitespace-nowrap text-ink ${
                segment.kind === 'gap' ? 'gap-hatch text-drain-ink' : ''
              } ${i === index ? 'outline-2 outline-offset-1 outline-ink' : ''}`}
              style={{
                left: `calc(${pct(s)}% + 1px)`,
                width: `calc(${width}% - 2px)`,
                background: segment.kind === 'gap' ? undefined : tint(segment, i === index),
              }}
            >
              {width > 14 ? (segment.kind === 'gap' ? duration(segment.minutes) : segment.name) : ''}
            </button>
          )
        })}

        {isGap && fillUntil !== null && fillUntil > segStart ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-[34px] bottom-[38px] rounded-[4px] border-2 border-dashed border-ink"
            style={{ left: `${pct(Math.max(segStart, range[0]))}%`, width: `${pct(fillUntil) - pct(Math.max(segStart, range[0]))}%` }}
          />
        ) : null}

        {!isGap && current && current.minutes >= 2 && !drag ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-[28px] bottom-[32px] w-0 border-l-2 border-dashed border-ink/70"
            style={{ left: `${pct(split)}%` }}
          />
        ) : null}

        {ticks.map((t) => (
          <span key={t}>
            <span className="absolute bottom-0 h-2 w-px bg-rule" style={{ left: `${pct(t)}%` }} />
            <span
              className="tnum absolute bottom-[12px] -translate-x-1/2 font-mono text-[9.5px] text-ink-3"
              style={{ left: `${pct(t)}%` }}
            >
              {String(new Date(t).getHours()).padStart(2, '0')}
            </span>
          </span>
        ))}

        {canDragStart ? (
          <Handle
            left={pct(shownStart)}
            label={clock(shownStart)}
            active={drag?.edge === 'start'}
            onPointerDown={beginDrag('start', segStart)}
            name="start"
          />
        ) : null}
        {canDragEnd ? (
          <Handle
            left={pct(isGap ? (drag?.edge === 'end' ? drag.value : fillUntil ?? segEnd) : shownEnd)}
            label={clock(isGap ? (drag?.edge === 'end' ? drag.value : fillUntil ?? segEnd) : shownEnd)}
            active={drag?.edge === 'end'}
            onPointerDown={beginDrag('end', isGap ? fillUntil ?? segEnd : segEnd)}
            name={isGap ? 'fill until' : 'end'}
          />
        ) : null}
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-3 rounded-lg bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {current ? (
        <section className="flex flex-col gap-3 px-5 pt-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className={`label ${isGap ? 'text-drain-ink' : ''}`}>
                {isGap ? 'Unlogged' : current.live ? 'Running now' : 'Selected'} · {clock(shownStart)} –{' '}
                {current.live ? 'now' : clock(isGap ? fillUntil ?? segEnd : shownEnd)}
              </div>
              <h2 className="truncate font-display text-[22px] leading-tight font-semibold">
                {isGap ? 'Nothing recorded' : current.name}
              </h2>
            </div>
            <div className="tnum font-display text-[28px] leading-none font-medium">
              {duration(Math.round(((isGap ? fillUntil ?? segEnd : shownEnd) - shownStart) / MINUTE))}
            </div>
          </div>

          <div className="label">{isGap ? 'Fill with' : 'Recategorise'}</div>
          {/* A grid, not a scrolling row: every category is one glance and one
              tap away, in the same order as the Capture keypad. */}
          <div className="grid grid-cols-3 gap-1.5">
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
                            fillUntil ? new Date(fillUntil).toISOString() : current.endedAt,
                            category.slug
                          )
                        : recategorizeAction(window, current.id!, category.slug)
                    )
                  }
                  className={`relative min-h-[40px] overflow-hidden rounded-lg border py-2 pr-2 pl-3 text-left text-[12px] leading-tight font-medium disabled:opacity-100 ${
                    active ? 'border-ink bg-ink text-surface' : 'border-rule bg-surface text-ink active:bg-surface-2'
                  }`}
                >
                  <span
                    aria-hidden
                    className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[2px]"
                    style={{ background: energyColor(category.energy) }}
                  />
                  {category.name}
                </button>
              )
            })}
          </div>

          {!isGap && current.id ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending || current.minutes < 2}
                onClick={() =>
                  dispatch(
                    () => splitBlockAction(window, current.id!, new Date(split).toISOString()),
                    // Land on the second half — the piece you split off is
                    // almost always the one you meant to relabel.
                    () => {
                      setSelected((i) => i + 1)
                      setSplitAt(null)
                    }
                  )
                }
                className="rounded-lg bg-ink px-3.5 py-2.5 text-[13px] font-medium text-surface disabled:opacity-40"
              >
                Split at {clock(split)}
              </button>
              <span className="text-[11.5px] text-ink-3">Tap the tape to move the split</span>
              {!current.running ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => dispatch(() => deleteBlockAction(window, current.id!))}
                  className="ml-auto px-2 py-2 text-[12.5px] font-medium text-drain-ink disabled:opacity-40"
                >
                  Delete
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-3">
              Drag the handle to fill part of the gap. What&rsquo;s left stays unlogged.
            </p>
          )}
        </section>
      ) : null}

      <div className="mt-auto p-4">
        {day.complete ? (
          <Link
            href={`/tally/check?date=${day.date}`}
            className="flex w-full items-center justify-between rounded-xl bg-ink px-4 py-4 text-[14px] font-medium text-surface"
          >
            <span>Day complete — go to check</span>
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => dispatch(() => completeDayAction(window))}
            className="flex w-full items-center justify-between rounded-xl bg-ink px-4 py-4 text-[14px] font-medium text-surface disabled:opacity-40"
          >
            <span>
              {day.gapCount === 0
                ? `Mark ${new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'long' })} complete`
                : 'Mark complete anyway'}
            </span>
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </main>
  )
}

function Handle({
  left,
  label,
  active,
  onPointerDown,
  name,
}: {
  left: number
  label: string
  active: boolean
  onPointerDown: (event: React.PointerEvent) => void
  name: string
}) {
  return (
    <>
      <span
        className={`tnum pointer-events-none absolute top-[5px] -translate-x-1/2 rounded-[3px] px-1.5 py-px font-mono text-[11px] font-medium ${
          active ? 'bg-charge text-white' : 'bg-ink text-surface'
        }`}
        style={{ left: `${left}%` }}
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={`Drag the ${name}`}
        onPointerDown={onPointerDown}
        onClick={(event) => event.stopPropagation()}
        className="absolute top-[22px] bottom-[26px] z-10 -ml-[16px] grid w-[32px] cursor-ew-resize touch-none place-items-center"
        style={{ left: `${left}%` }}
      >
        <span className="absolute inset-y-0 w-[4px] rounded-full bg-ink" />
        <span
          className={`relative h-[28px] w-[15px] rounded-[8px] border-2 border-ink ${active ? 'bg-ink' : 'bg-surface'}`}
        />
      </button>
    </>
  )
}
