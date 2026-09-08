'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { DayState, DayStates } from '@/lib/calendar'

/**
 * The month at a glance: one square per day, coloured by how far that day got.
 *
 * A client component because the day boundaries have to be the browser's. The
 * rest of Tally derives a day from local midnight (`localWindow` in reconcile,
 * `windowFor` in check), and a calendar that disagreed about which square is
 * today would send you to reconcile the wrong day near midnight — the one bug
 * this screen exists to help you catch.
 *
 * Weeks start Monday, matching Rounds' plan screen.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/** Monday-first index: Monday 0 … Sunday 6. */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

/**
 * The colours. Charge blue deepens as the day gets further along, so the month
 * reads as a fill level rather than a set of unrelated states — and it stays
 * inside the two data colours the design tokens allow (globals.css).
 */
const SWATCH: Record<DayState, string> = {
  open: 'border-rule bg-surface text-ink-3',
  complete: 'border-charge-fill bg-charge-fill text-ink',
  checked: 'border-charge bg-charge text-surface',
}

const LEGEND: Array<{ state: DayState; label: string }> = [
  { state: 'open', label: 'Not complete' },
  { state: 'complete', label: 'Complete, no check' },
  { state: 'checked', label: 'Checked' },
]

export default function CalendarClient({ states }: { states: DayStates }) {
  const today = useMemo(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth(), date: now.getDate() }
  }, [])
  const [view, setView] = useState({ year: today.year, month: today.month })

  const todayISO = isoDate(today.year, today.month, today.date)

  const first = new Date(view.year, view.month, 1)
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const leading = weekdayIndex(first)

  const monthLabel = first.toLocaleDateString([], { month: 'long', year: 'numeric' })
  const isThisMonth = view.year === today.year && view.month === today.month

  const step = (delta: number) =>
    setView(({ year, month }) => {
      const moved = new Date(year, month + delta, 1)
      return { year: moved.getFullYear(), month: moved.getMonth() }
    })

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = isoDate(view.year, view.month, i + 1)
    return {
      day: i + 1,
      date,
      state: states[date] ?? ('open' as DayState),
      // You can't reconcile a day that hasn't happened; reconcile clamps the
      // offset to today anyway, so a future square would be a link to nowhere.
      future: date > todayISO,
      isToday: date === todayISO,
    }
  })

  const checked = days.filter((d) => !d.future && d.state === 'checked').length
  const elapsed = days.filter((d) => !d.future).length

  return (
    <main className="flex flex-1 flex-col">
      <header className="px-4 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => step(-1)}
            className="font-mono text-[10px] tracking-[0.14em] text-ink-3"
          >
            ‹ PREV
          </button>
          <span className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
            {monthLabel.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={isThisMonth}
            className="font-mono text-[10px] tracking-[0.14em] text-ink-3 disabled:text-ink-4/40"
          >
            NEXT ›
          </button>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tracking-tight">
            {checked} of {elapsed} checked
          </div>
          {!isThisMonth ? (
            <button
              type="button"
              onClick={() => setView({ year: today.year, month: today.month })}
              className="font-mono text-[10px] tracking-[0.12em] text-ink-3 underline underline-offset-4"
            >
              TODAY
            </button>
          ) : null}
        </div>
      </header>

      <div className="px-4">
        <div className="grid grid-cols-7 gap-[5px] font-mono text-[9px] tracking-[0.12em] text-ink-4">
          {WEEKDAYS.map((letter, index) => (
            <div key={index} className="text-center">
              {letter}
            </div>
          ))}
        </div>

        <div className="mt-1.5 grid grid-cols-7 gap-[5px]">
          {Array.from({ length: leading }, (_, i) => (
            <div key={`lead-${i}`} />
          ))}

          {days.map((day) => {
            const face = (
              <>
                <span className="tnum font-mono text-[15px] font-medium">{day.day}</span>
                {day.state === 'checked' ? (
                  <span className="font-mono text-[8px] tracking-[0.1em] opacity-70">✓</span>
                ) : null}
              </>
            )
            const shell = `flex aspect-square flex-col items-center justify-center gap-0.5 border ${
              day.future ? 'border-rule-2 bg-surface-2 text-ink-4' : SWATCH[day.state]
            }`
            const ring = day.isToday ? { boxShadow: 'inset 0 0 0 2px #141414' } : undefined

            return day.future ? (
              <div key={day.date} className={shell} style={ring} aria-disabled="true">
                {face}
              </div>
            ) : (
              <Link
                key={day.date}
                href={`/tally/reconcile?date=${day.date}`}
                aria-label={`Reconcile ${day.date}`}
                className={`${shell} active:opacity-80`}
                style={ring}
              >
                {face}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="mt-auto border-t border-rule px-4 py-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LEGEND.map((item) => (
            <div key={item.state} className="flex items-center gap-1.5">
              <span className={`block size-3 border ${SWATCH[item.state]}`} />
              <span className="font-mono text-[9px] tracking-[0.1em] text-ink-3">
                {item.label.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-snug text-ink-3">
          Tap a day to reconcile it.
        </p>
      </div>
    </main>
  )
}
