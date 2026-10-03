'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import type { Day } from '@/lib/day'
import type { OpenBlock } from '@/lib/switch'
import { loadDayAction, shiftOpenStartAction, splitOpenAction } from './actions'
import DayDial from './day-dial'

/** Past this, the app is allowed to interrupt once and ask (build-plan §5). */
const LONG_BLOCK_MINUTES = 90

export type Tile = {
  id: string
  slug: string
  name: string
  isQuick: boolean
  /** -1 drain, 0 neutral, +1 charge — the mark on the key's edge. */
  energy: number
  lastUsed: string | null
}

type Flash =
  | { kind: 'closed'; text: string }
  | { kind: 'moved'; text: string }
  | { kind: 'paused'; text: string }
  | { kind: 'error'; text: string }
  | null

/** How long after the last ±5 tap the shift is saved, so three taps are one edit. */
const SHIFT_SETTLE_MS = 800

function todayWindow() {
  const local = new Date()
  const start = new Date(local.getFullYear(), local.getMonth(), local.getDate())
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000).toISOString(),
  }
}

/** m:ss for the first hour, h:mm:ss after — the dial's centre is a stopwatch. */
function stopwatch(startedAt: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "52m ago", "3h ago", "yesterday", "Tue" — how long since this key was pressed. */
function sinceLabel(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const today = new Date(now)
  const then = new Date(iso)
  const sameDay = then.toDateString() === today.toDateString()
  if (sameDay) return `${Math.floor(minutes / 60)}h ago`
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'yesterday'
  if (minutes < 7 * 1440) return then.toLocaleDateString([], { weekday: 'short' })
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const noSubscribe = () => () => {}

function energyColor(energy: number): string {
  if (energy > 0) return 'var(--color-charge)'
  if (energy < 0) return 'var(--color-drain)'
  return 'var(--color-neutral)'
}

export default function CaptureGrid({
  tiles: initialTiles,
  initialOpen,
}: {
  tiles: Tile[]
  initialOpen: OpenBlock | null
}) {
  const [tiles, setTiles] = useState(initialTiles)
  const [open, setOpen] = useState<OpenBlock | null>(initialOpen)
  const [day, setDay] = useState<Day | null>(null)
  const [flash, setFlash] = useState<Flash>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Everything on the dial is wall-clock time in the phone's own timezone. The
  // server renders in UTC, so the clock-dependent parts wait for the client
  // rather than flashing a wrong hour and failing hydration.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Long-block prompt state. `dismissed` remembers the block you've already
  // vouched for, so saying "still going" doesn't get you asked again a second
  // later — the app gets to interrupt once per block, not continuously.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [splitAt, setSplitAt] = useState<number | null>(null)
  const [splitSlug, setSplitSlug] = useState<string | null>(null)
  const [splitPending, startSplit] = useTransition()

  // "I switched ten minutes ago": ±5 taps move the open block's start at once on
  // screen and are saved together once the taps stop.
  const [shift, setShift] = useState(0)
  const shiftTotal = useRef(0)
  const shiftBase = useRef<string | null>(null)
  const shiftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The dial is a live clock, so it has to tick on its own.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // The ring needs the day so far. It is fetched after first paint so the
  // keypad is usable at once; the ring fills in a moment later.
  const refreshDay = useCallback(async () => {
    const result = await loadDayAction(todayWindow())
    if (result.day) setDay(result.day)
  }, [])

  useEffect(() => {
    const first = setTimeout(refreshDay, 0)
    // Once a minute is plenty: between taps only the open block grows, and the
    // dial draws that one from the clock.
    const id = setInterval(refreshDay, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [refreshDay])

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const showFlash = useCallback((next: Flash, ms: number) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(next)
    flashTimer.current = setTimeout(() => setFlash(null), ms)
  }, [])

  const flushShift = useCallback(async () => {
    if (shiftTimer.current) clearTimeout(shiftTimer.current)
    shiftTimer.current = null
    const delta = shiftTotal.current
    const base = shiftBase.current
    shiftTotal.current = 0
    shiftBase.current = null
    setShift(0)
    if (!delta || !base) return

    const result = await shiftOpenStartAction(todayWindow(), delta)
    if (result.day) setDay(result.day)
    if (result.ok) {
      const at = new Date(new Date(base).getTime() + delta * 60000)
      showFlash({ kind: 'moved', text: `Started ${Math.abs(delta)}m ${delta < 0 ? 'earlier' : 'later'} · ${clockLabel(at.getTime())}` }, 1800)
    } else {
      // Put the clock back where the server still has it.
      setOpen((o) => (o ? { ...o, startedAt: base } : o))
      showFlash({ kind: 'error', text: result.error }, 5000)
    }
  }, [showFlash])

  // Leaving the screen inside the settle window still saves the shift.
  useEffect(() => () => {
    if (shiftTotal.current) void shiftOpenStartAction(todayWindow(), shiftTotal.current)
  }, [])

  const nudgeStart = (deltaMinutes: number) => {
    if (!open || pending) return
    const current = new Date(open.startedAt).getTime()
    const next = current + deltaMinutes * 60000
    // Not into the future, and not through the whole of the block before it.
    if (next > Date.now() - 60000) return
    const segs = day?.segments ?? []
    const liveAt = segs.findIndex((x) => x.live)
    const prevBlock = liveAt > 0 ? segs.slice(0, liveAt).reverse().find((x) => x.kind === 'block') : undefined
    if (deltaMinutes < 0 && prevBlock && next < new Date(prevBlock.startedAt).getTime() + 60000) {
      showFlash({ kind: 'error', text: `That would swallow ${prevBlock.name}` }, 2600)
      return
    }
    if (shiftBase.current === null) shiftBase.current = open.startedAt
    setOpen({ ...open, startedAt: new Date(next).toISOString() })
    shiftTotal.current += deltaMinutes
    setShift(shiftTotal.current)
    if (navigator.vibrate) navigator.vibrate(8)
    if (shiftTimer.current) clearTimeout(shiftTimer.current)
    shiftTimer.current = setTimeout(() => void flushShift(), SHIFT_SETTLE_MS)
  }

  // Stop logging without starting anything else. The time until the next tap
  // stays unlogged and shows on the dial as a gap, which is the honest record of
  // a stretch you didn't want to track.
  const pause = useCallback(async () => {
    if (!open || pending) return
    if (shiftTotal.current) await flushShift()
    const previous = open
    const stamp = new Date().toISOString()
    setPending('pause')
    setOpen(null)
    setTiles((list) => list.map((t) => (t.slug === previous.slug ? { ...t, lastUsed: stamp } : t)))
    if (navigator.vibrate) navigator.vibrate(12)
    try {
      const response = await fetch('/api/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'pause' }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      if (data.closed) showFlash({ kind: 'paused', text: `${data.closed.name} · ${data.closed.minutes}m` }, 1800)
      void refreshDay()
    } catch {
      setOpen(previous)
      showFlash({ kind: 'error', text: 'Not paused — tap again' }, 5000)
    } finally {
      setPending(null)
    }
  }, [open, pending, flushShift, showFlash, refreshDay])

  const tap = useCallback(
    async (tile: Tile) => {
      if (tile.slug === open?.slug || pending) return
      // A shift still waiting to save belongs to the block being closed now.
      if (shiftTotal.current) await flushShift()

      const previous = open
      const previousTiles = tiles
      const stamp = new Date().toISOString()
      setPending(tile.slug)

      // Optimistic: the key responds now, the network catches up.
      setOpen({ slug: tile.slug, name: tile.name, startedAt: stamp })
      setTiles((list) =>
        list.map((t) => (t.slug === previous?.slug || t.slug === tile.slug ? { ...t, lastUsed: stamp } : t))
      )
      if (navigator.vibrate) navigator.vibrate(12)

      try {
        const response = await fetch('/api/switch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: tile.slug }),
        })
        const data = await response.json()

        if (!response.ok || !data.ok) {
          throw new Error(data?.error ?? `HTTP ${response.status}`)
        }

        setOpen(data.now)
        if (data.closed) {
          showFlash({ kind: 'closed', text: `${data.closed.name} · ${data.closed.minutes}m` }, 1800)
        }
        void refreshDay()
      } catch {
        // Capture failing silently is the one thing that would poison the log:
        // you'd never know whether a gap was a missed tap or a real untracked
        // hour. Roll back and say so loudly.
        setOpen(previous)
        setTiles(previousTiles)
        showFlash({ kind: 'error', text: 'Not saved — tap again' }, 5000)
      } finally {
        setPending(null)
      }
    },
    [open, pending, tiles, showFlash, refreshDay, flushShift]
  )

  const openTile = open ? tiles.find((t) => t.slug === open.slug) : undefined
  const openEnergy = openTile?.energy ?? 0
  const openMinutes = open ? Math.floor((now - new Date(open.startedAt).getTime()) / 60000) : 0
  const asking =
    open !== null &&
    openMinutes >= LONG_BLOCK_MINUTES &&
    dismissed !== open.startedAt &&
    !pending

  const beginSplit = () => {
    if (!open) return
    // Default to the midpoint — if you can't remember when it changed, halfway
    // is the least-wrong guess, and it's one tap from there to adjust.
    const start = new Date(open.startedAt).getTime()
    setSplitAt(Math.round((start + now) / 2 / 60000) * 60000)
    setSplitSlug(tiles.find((t) => t.slug !== open.slug)?.slug ?? null)
    setSplitting(true)
  }

  const confirmSplit = () => {
    if (!open || splitAt === null || !splitSlug) return
    const start = new Date(open.startedAt).getTime()
    startSplit(async () => {
      const result = await splitOpenAction(todayWindow(), new Date(splitAt).toISOString(), splitSlug)
      if (result.ok) {
        const name = tiles.find((t) => t.slug === splitSlug)?.name ?? splitSlug
        setOpen({ slug: splitSlug, name, startedAt: new Date(splitAt).toISOString() })
        setDay(result.day)
        setSplitting(false)
        setDismissed(null)
        showFlash(
          { kind: 'closed', text: `Split · ${Math.round((splitAt - start) / 60000)}m` },
          1800
        )
      } else {
        showFlash({ kind: 'error', text: result.error }, 5000)
      }
    })
  }

  const nudgeSplit = (deltaMinutes: number) => {
    if (!open || splitAt === null) return
    const start = new Date(open.startedAt).getTime()
    const next = splitAt + deltaMinutes * 60000
    if (next <= start + 60000 || next >= now - 60000) return
    setSplitAt(next)
  }

  // While paused, the gap since the last block ended. The day's last segment is
  // that gap when nothing is running.
  const lastSeg = day?.segments[day.segments.length - 1]
  const pausedSince =
    !open && lastSeg?.kind === 'gap' ? new Date(lastSeg.startedAt).getTime() : null

  const dayStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime()
  const unlogged = day?.gapMinutes ?? 0

  return (
    <main className="flex flex-1 flex-col">
      <header className="relative flex flex-1 flex-col px-5 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="label">
            {mounted ? new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
          </span>
          <span className={`label ${unlogged > 0 ? 'text-drain-ink' : ''}`}>
            {day ? (unlogged > 0 ? `${unlogged}m unlogged` : 'no gaps') : ''}
          </span>
        </div>

        <div className="relative m-auto grid w-fit place-items-center py-1">
          <DayDial
            segments={day?.segments ?? []}
            dayStart={dayStart}
            now={now}
            open={mounted && open ? { startedAt: open.startedAt, energy: openEnergy } : null}
            ready={mounted}
          />
          <div className="pointer-events-none absolute inset-0 grid place-content-center gap-0.5 text-center">
            {!mounted ? null : open ? (
              <>
                <span className="label" style={{ color: energyColor(openEnergy) }}>
                  ● Open
                </span>
                <span className="mx-auto max-w-[150px] font-display text-[16px] leading-tight font-semibold">
                  {open.name}
                </span>
                <span className="tnum font-display text-[clamp(38px,12vw,52px)] leading-none font-medium tracking-[-0.02em]">
                  {stopwatch(open.startedAt, now)}
                </span>
                <span className="tnum font-mono text-[10.5px] text-ink-3">
                  since {clockLabel(new Date(open.startedAt).getTime())}
                </span>
              </>
            ) : (
              <>
                <span className="label">{pausedSince ? 'Paused' : 'Nothing open'}</span>
                {pausedSince ? (
                  <span className="tnum font-display text-[clamp(38px,12vw,52px)] leading-none font-medium tracking-[-0.02em] text-ink-3">
                    {stopwatch(new Date(pausedSince).toISOString(), now)}
                  </span>
                ) : (
                  <span className="font-display text-[22px] font-semibold">Tally</span>
                )}
                <span className="font-mono text-[10.5px] text-ink-3">
                  {pausedSince ? `unlogged since ${clockLabel(pausedSince)}` : 'Tap what you\u2019re doing'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Caught the switch late? Move the start back without leaving the
            screen. The block before it gives up the same minutes. */}
        {mounted && open ? (
          <div className="mx-auto mb-1 flex items-center gap-3">
            <button
              type="button"
              disabled={!!pending}
              onClick={() => nudgeStart(-5)}
              aria-label="It started 5 minutes earlier"
              className="h-10 min-w-[64px] rounded-full border border-rule-strong px-3 font-mono text-[12px] font-medium text-ink active:bg-surface-2 disabled:opacity-40"
            >
              −5m
            </button>
            <span className={`label w-[92px] text-center ${shift ? 'text-charge' : ''}`} aria-live="polite">
              {shift ? `Start ${shift > 0 ? '+' : '−'}${Math.abs(shift)}m` : 'Started earlier?'}
            </span>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => nudgeStart(5)}
              aria-label="It started 5 minutes later"
              className="h-10 min-w-[64px] rounded-full border border-rule-strong px-3 font-mono text-[12px] font-medium text-ink active:bg-surface-2 disabled:opacity-40"
            >
              +5m
            </button>
          </div>
        ) : null}

        {flash ? (
          <div
            className={`fill-in absolute inset-x-4 top-3 z-10 flex items-center justify-between gap-3 rounded-xl px-4 py-3 font-mono text-xs ${
              flash.kind === 'error' ? 'bg-drain-ink text-surface' : 'bg-ink text-surface'
            }`}
            role="status"
          >
            <span>{flash.text}</span>
            <span className="opacity-60">
              {flash.kind === 'error'
                ? 'FAILED'
                : flash.kind === 'moved'
                  ? 'SAVED'
                  : flash.kind === 'paused'
                    ? 'PAUSED'
                    : 'CLOSED'}
            </span>
          </div>
        ) : null}

        {asking && !splitting ? (
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDismissed(open!.startedAt)}
              className="flex-1 rounded-xl bg-ink px-3 py-3.5 text-sm text-surface"
            >
              Yes, still going
            </button>
            <button
              type="button"
              onClick={beginSplit}
              className="flex-1 rounded-xl border border-rule-strong px-3 py-3.5 text-sm text-ink"
            >
              Split it
            </button>
          </div>
        ) : null}

        {splitting && open && splitAt !== null ? (
          <div className="mb-4 rounded-2xl border border-rule bg-surface p-4">
            <div className="flex h-[28px] overflow-hidden rounded-md">
              <div
                className="bg-charge-fill"
                style={{
                  width: `${Math.round(((splitAt - new Date(open.startedAt).getTime()) / (now - new Date(open.startedAt).getTime())) * 100)}%`,
                  borderRight: '2px solid var(--color-ink)',
                }}
              />
              <div className="flex-1 bg-surface-2" />
            </div>
            <div className="tnum mt-1.5 flex justify-between font-mono text-[10px] text-ink-3">
              <span>{clockLabel(new Date(open.startedAt).getTime())}</span>
              <span>{clockLabel(now)}</span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => nudgeSplit(-5)}
                aria-label="Five minutes earlier"
                className="size-12 rounded-full border border-rule-strong text-[20px]"
              >
                −
              </button>
              <div className="text-center">
                <div className="tnum font-display text-[32px] leading-none font-medium">{clockLabel(splitAt)}</div>
                <div className="label mt-1">Split point</div>
              </div>
              <button
                type="button"
                onClick={() => nudgeSplit(5)}
                aria-label="Five minutes later"
                className="size-12 rounded-full border border-rule-strong text-[20px]"
              >
                +
              </button>
            </div>

            <div className="label mt-4">Second half becomes</div>
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
              {tiles
                .filter((t) => t.isQuick && t.slug !== open.slug)
                .map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setSplitSlug(t.slug)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${
                      splitSlug === t.slug ? 'border-ink bg-ink text-surface' : 'border-rule text-ink-2'
                    }`}
                  >
                    <span className="size-[7px] rounded-full" style={{ background: energyColor(t.energy) }} />
                    {t.name}
                  </button>
                ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setSplitting(false)}
                className="rounded-xl border border-rule-strong px-4 py-3 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSplit}
                disabled={splitPending || !splitSlug}
                className="flex-1 rounded-xl bg-ink px-3 py-3 text-sm text-surface disabled:opacity-40"
              >
                Split at {clockLabel(splitAt)}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {/* The keypad. Hairline gaps instead of a box round every key; the edge
          mark carries the category's energy so the colour stays data. */}
      <div className="grid grid-cols-3 gap-px border-t border-rule-2 bg-rule-2 md:mx-auto md:w-full md:max-w-[560px] md:border-x">
        {tiles.map((tile) => {
          const isOpen = tile.slug === open?.slug
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => tap(tile)}
              disabled={isOpen}
              className={`relative flex min-h-[56px] flex-col justify-between gap-1 py-2 pr-2.5 pl-[14px] [@media(max-height:700px)]:min-h-[48px] [@media(max-height:700px)]:py-1.5 text-left transition-colors duration-100 ${
                isOpen
                  ? 'fill-in bg-ink text-surface'
                  : tile.isQuick
                    ? 'bg-surface text-ink active:bg-surface-2'
                    : 'bg-ground text-ink-2 active:bg-surface-2'
              }`}
            >
              <span
                aria-hidden
                className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-[2px]"
                style={{ background: energyColor(tile.energy) }}
              />
              <span className="text-[13px] leading-[1.2] font-medium" style={{ textWrap: 'pretty' }}>
                {tile.name}
              </span>
              <span className={`tnum font-mono text-[9.5px] ${isOpen ? 'text-surface/60' : 'text-ink-3'}`}>
                {isOpen ? 'open' : mounted ? sinceLabel(tile.lastUsed, now) : '\u00a0'}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={pause}
          disabled={!open || !!pending}
          className="relative col-span-3 flex min-h-[44px] items-center justify-between bg-ground py-2.5 pr-4 pl-[14px] text-left text-ink-2 active:bg-surface-2 disabled:text-ink-4"
        >
          <span aria-hidden className="gap-hatch absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[2px]" />
          <span className="flex items-center gap-2.5 text-[13px] font-medium">
            <span aria-hidden className="font-mono text-[11px] tracking-[-0.1em]">❚❚</span>
            {open ? 'Pause logging' : 'Paused'}
          </span>
          <span className="font-mono text-[9.5px] text-ink-3">
            {open ? 'leave this time unlogged' : 'tap a category to resume'}
          </span>
        </button>
      </div>
    </main>
  )
}
