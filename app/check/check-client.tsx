'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import type { Day } from '@/lib/day'
import { loadDayAction, saveCheckAction, type ActionResult } from '../actions'

function localWindow() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000).toISOString(),
  }
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

export default function CheckClient() {
  const [window] = useState(localWindow)
  const [day, setDay] = useState<Day | null>(null)
  const [energy, setEnergy] = useState<number | null>(null)
  const [moved, setMoved] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const apply = useCallback((result: ActionResult) => {
    if (result.day) {
      setDay(result.day)
      if (result.day.check) {
        setEnergy(result.day.check.energy)
        setMoved(result.day.check.movedPriority)
        setNote(result.day.check.note ?? '')
      }
    }
    setError(result.ok ? null : result.error)
    return result.ok
  }, [])

  useEffect(() => {
    startTransition(async () => {
      apply(await loadDayAction(window))
    })
  }, [window, apply])

  const ready = energy !== null && moved !== null

  const submit = () => {
    if (!ready) return
    startTransition(async () => {
      if (apply(await saveCheckAction(window, energy, moved, note))) setSaved(true)
    })
  }

  // The end state. The plan is explicit that the day has a finish line and the
  // app offers nothing after it — no streak, no summary, nothing to linger over.
  if (saved) {
    return (
      <main className="flex min-h-dvh flex-col justify-center px-8">
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
          {new Date(`${window.date}T12:00:00`).toLocaleDateString([], {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).toUpperCase()}
        </div>
        <div className="mt-2.5 text-[32px] leading-tight font-semibold tracking-tight">
          Day closed.
        </div>
        <div className="tnum mt-3.5 font-mono text-sm leading-[1.9] text-ink-2">
          {day ? duration(day.loggedMinutes) : '—'} logged
          <br />
          {day ? day.segments.filter((s) => s.kind === 'block').length : 0} blocks
          <br />
          energy {energy} / 10
        </div>
        <p className="mt-7 max-w-[260px] text-sm leading-relaxed text-ink-3">
          Nothing else to do here. The week reads itself on Sunday.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="px-4 pt-6 pb-4">
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
          DAILY CHECK ·{' '}
          {new Date(`${window.date}T12:00:00`)
            .toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
            .toUpperCase()}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">Two questions.</div>
      </div>

      {error ? (
        <div className="mx-4 mb-3 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">
          {error}
        </div>
      ) : null}

      <div className="px-4">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3">
          ENERGY AT END OF DAY
        </div>
        <div className="mt-2.5 grid grid-cols-5 gap-[5px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setEnergy(n)}
              className={`tnum h-16 border font-mono text-[19px] font-medium ${
                energy === n ? 'border-ink bg-ink text-surface' : 'border-rule bg-surface text-ink-2'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9px] tracking-[0.1em] text-ink-3">
          <span>1 · EMPTY</span>
          <span>10 · CHARGED</span>
        </div>
      </div>

      <div className="px-4 pt-7">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3">
          DID YOU MOVE A TOP PRIORITY?
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {[
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setMoved(option.value)}
              className={`flex-1 border p-5 text-[15px] ${
                moved === option.value
                  ? 'border-ink bg-ink text-surface'
                  : 'border-rule bg-surface text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-7">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3">NOTE — OPTIONAL</div>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything worth remembering about today."
          className="mt-2.5 w-full resize-none border border-rule bg-surface p-3 text-sm outline-none placeholder:text-ink-4 focus:border-rule-strong"
        />
      </div>

      <div className="mt-auto border-t border-rule p-4">
        <button
          type="button"
          onClick={submit}
          disabled={!ready || pending}
          className={`w-full border px-3 py-[17px] text-[15px] ${
            ready ? 'border-ink bg-ink text-surface' : 'border-rule bg-surface-2 text-ink-4'
          }`}
        >
          {ready ? 'Done' : 'Answer both to finish'}
        </button>
        {!day?.complete ? (
          <Link
            href="/reconcile"
            className="mt-3 block text-center font-mono text-[10px] tracking-[0.12em] text-ink-4"
          >
            RECONCILE THE DAY FIRST
          </Link>
        ) : null}
      </div>
    </main>
  )
}
