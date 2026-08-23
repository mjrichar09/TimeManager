'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenBlock } from '@/lib/switch'

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
        <p className="text-center font-mono text-[10px] tracking-[0.12em] text-ink-4">
          RECONCILE ARRIVES IN M2
        </p>
      </div>
    </main>
  )
}
