'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import type { OpenBlock } from '@/lib/switch'
import { splitOpenAction } from './actions'

/** Past this, the app is allowed to interrupt once and ask (build-plan §5). */
const LONG_BLOCK_MINUTES = 90

export type Tile = {
  id: string
  slug: string
  name: string
  isQuick: boolean
}

type Flash =
  | { kind: 'closed'; text: string }
  | { kind: 'error'; text: string }
  | null

function elapsedLabel(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function clockLabel(startedAt: string): string {
  return new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function CaptureGrid({
  tiles,
  initialOpen,
}: {
  tiles: Tile[]
  initialOpen: OpenBlock | null
}) {
  const [open, setOpen] = useState<OpenBlock | null>(initialOpen)
  const [flash, setFlash] = useState<Flash>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Long-block prompt state. `dismissed` remembers the block you've already
  // vouched for, so saying "still going" doesn't get you asked again a second
  // later — the app gets to interrupt once per block, not continuously.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [splitAt, setSplitAt] = useState<number | null>(null)
  const [splitSlug, setSplitSlug] = useState<string | null>(null)
  const [splitPending, startSplit] = useTransition()

  // The header is a live clock, so it has to tick on its own.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const showFlash = useCallback((next: Flash, ms: number) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(next)
    flashTimer.current = setTimeout(() => setFlash(null), ms)
  }, [])

  const tap = useCallback(
    async (tile: Tile) => {
      if (tile.slug === open?.slug || pending) return

      const previous = open
      setPending(tile.slug)

      // Optimistic: the tile responds now, the network catches up.
      setOpen({ slug: tile.slug, name: tile.name, startedAt: new Date().toISOString() })
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
      } catch {
        // Capture failing silently is the one thing that would poison the log:
        // you'd never know whether a gap was a missed tap or a real untracked
        // hour. Roll back and say so loudly.
        setOpen(previous)
        showFlash({ kind: 'error', text: 'Not saved — tap again' }, 5000)
      } finally {
        setPending(null)
      }
    },
    [open, pending, showFlash]
  )

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
    const local = new Date()
    const dayStart = new Date(local.getFullYear(), local.getMonth(), local.getDate())
    const win = {
      date: `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`,
      from: dayStart.toISOString(),
      to: new Date(dayStart.getTime() + 86_400_000).toISOString(),
    }
    startSplit(async () => {
      const result = await splitOpenAction(win, new Date(splitAt).toISOString(), splitSlug)
      if (result.ok) {
        const name = tiles.find((t) => t.slug === splitSlug)?.name ?? splitSlug
        setOpen({ slug: splitSlug, name, startedAt: new Date(splitAt).toISOString() })
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

  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="relative border-b border-rule px-4 pt-6 pb-4">
        {open ? (
          <>
            <div className="flex items-center gap-[7px]">
              <span className="block size-[7px] animate-pulse rounded-full bg-drain" />
              <span className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
                OPEN SINCE {clockLabel(open.startedAt)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div className="text-[27px] leading-tight font-semibold tracking-tight">{open.name}</div>
              <div className="tnum font-mono text-[27px] font-medium tracking-tight">
                {elapsedLabel(open.startedAt, now)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">NOTHING OPEN</div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div className="text-[27px] leading-tight font-semibold tracking-tight">Tally</div>
              <div className="tnum font-mono text-[27px] font-medium tracking-tight text-ink-4">—</div>
            </div>
          </>
        )}

        {asking && !splitting ? (
          <div className="mt-4 flex gap-1.5">
            <button
              type="button"
              onClick={() => setDismissed(open!.startedAt)}
              className="flex-1 border border-ink bg-ink px-3 py-[15px] text-sm text-surface"
            >
              Yes, still going
            </button>
            <button
              type="button"
              onClick={beginSplit}
              className="flex-1 border border-rule-strong px-3 py-[15px] text-sm text-ink"
            >
              Split it
            </button>
          </div>
        ) : null}

        {splitting && open && splitAt !== null ? (
          <div className="mt-4">
            <div className="flex h-[34px] border border-rule-strong bg-ground">
              <div
                className="bg-charge-fill"
                style={{
                  width: `${Math.round(((splitAt - new Date(open.startedAt).getTime()) / (now - new Date(open.startedAt).getTime())) * 100)}%`,
                  borderRight: '2px solid #fcfcfb',
                }}
              />
              <div className="flex-1 bg-surface-2" />
            </div>
            <div className="tnum mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-ink-3">
              <span>{hhmm(new Date(open.startedAt).getTime())}</span>
              <span>{hhmm(now)}</span>
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => nudgeSplit(-5)}
                className="size-14 border border-rule-strong bg-surface text-[21px]"
              >
                −
              </button>
              <div className="text-center">
                <div className="tnum font-mono text-[30px] font-medium tracking-tight">
                  {hhmm(splitAt)}
                </div>
                <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">SPLIT POINT</div>
              </div>
              <button
                type="button"
                onClick={() => nudgeSplit(5)}
                className="size-14 border border-rule-strong bg-surface text-[21px]"
              >
                +
              </button>
            </div>

            <div className="mt-4 font-mono text-[10px] tracking-[0.12em] text-ink-3">
              SECOND HALF BECOMES
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {tiles
                .filter((t) => t.isQuick && t.slug !== open.slug)
                .slice(0, 4)
                .map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setSplitSlug(t.slug)}
                    className={`border px-2.5 py-[13px] text-left text-[13px] ${
                      splitSlug === t.slug
                        ? 'border-ink bg-ink text-surface'
                        : 'border-rule bg-surface text-ink'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
            </div>

            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => setSplitting(false)}
                className="border border-rule-strong px-4 py-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSplit}
                disabled={splitPending || !splitSlug}
                className="flex-1 border border-ink bg-ink px-3 py-4 text-sm text-surface disabled:opacity-40"
              >
                Split at {hhmm(splitAt)}
              </button>
            </div>
          </div>
        ) : null}

        {flash ? (
          <div
            className={`absolute inset-x-4 top-full z-10 -translate-y-2 px-[14px] py-[13px] font-mono text-xs tracking-[0.01em] ${
              flash.kind === 'error' ? 'bg-drain-ink text-surface' : 'bg-ink text-surface'
            }`}
            role="status"
          >
            <span className="flex items-center justify-between gap-3">
              <span>{flash.text}</span>
              <span className={flash.kind === 'error' ? 'text-surface/70' : 'text-ink-3'}>
                {flash.kind === 'error' ? 'FAILED' : 'CLOSED'}
              </span>
            </span>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-3 gap-[7px] px-4 pt-4">
        {tiles.map((tile) => {
          const isOpen = tile.slug === open?.slug
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => tap(tile)}
              disabled={isOpen}
              className={`flex h-28 flex-col justify-between border p-3 text-left transition-colors duration-100 active:bg-surface-2 disabled:active:bg-transparent ${
                isOpen
                  ? 'border-ink bg-ink'
                  : tile.isQuick
                    ? 'border-rule bg-surface'
                    : 'border-rule bg-surface-2'
              }`}
            >
              <span
                className={`font-mono text-[9px] tracking-[0.12em] ${
                  isOpen ? 'text-drain' : 'text-ink-4'
                }`}
              >
                {isOpen ? 'OPEN' : tile.isQuick ? 'QUICK' : ''}
              </span>
              <span
                className={`text-[15px] leading-tight font-medium ${
                  isOpen ? 'text-surface' : tile.isQuick ? 'text-ink' : 'text-ink-2'
                }`}
                style={{ textWrap: 'pretty' }}
              >
                {tile.name}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-auto border-t border-rule p-4">
        <Link
          href="/tally/reconcile"
          className="block w-full border border-rule-strong px-3 py-3.5 text-center text-[13px] text-ink-2"
        >
          End the day
        </Link>
      </div>
    </main>
  )
}
