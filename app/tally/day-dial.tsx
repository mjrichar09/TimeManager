'use client'

import type { Segment } from '@/lib/day'

/**
 * Today as a 24-hour ring.
 *
 * A ring rather than a bar because the day really is circular in this data:
 * sleep crosses midnight every night, and on a strip it is two stubs at either
 * end. On a ring it is one arc. Blocks are drawn by energy (blue charges, red
 * drains, grey neutral), unlogged stretches are hatched, and the open block is
 * drawn thicker and grows with the clock.
 */

const SIZE = 268
const PAD = 14
const C = SIZE / 2
const R = 108
const W = 17

const MINUTES = 1440

function angle(minute: number): number {
  return (minute / MINUTES) * Math.PI * 2
}

function point(r: number, a: number): [number, number] {
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = point(r, a0)
  const [x1, y1] = point(r, a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}

function stroke(energy: number): string {
  if (energy > 0) return 'var(--color-charge)'
  if (energy < 0) return 'var(--color-drain)'
  return 'var(--color-neutral)'
}

export default function DayDial({
  segments,
  dayStart,
  now,
  open,
  ready = true,
}: {
  segments: Segment[]
  /** Local midnight, as epoch ms. */
  dayStart: number
  now: number
  /** The running block, drawn live from its start to `now`. */
  open: { startedAt: string; energy: number } | null
  /** False on the server render: draw the empty ring and ticks, no needle. */
  ready?: boolean
}) {
  const minuteOf = (ms: number) => Math.min(MINUTES, Math.max(0, (ms - dayStart) / 60000))
  const nowMinute = minuteOf(now)
  const openStart = open ? minuteOf(new Date(open.startedAt).getTime()) : null

  // The loaded day stops at the moment it was fetched; the open block takes over
  // from its own start, so anything the server drew after that is superseded.
  const closed = segments.filter((s) => !s.live)

  // A one-minute block would be a sliver thinner than the gap between arcs.
  const gapAngle = 0.012

  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
      role="img"
      aria-label="Today as a 24-hour dial"
      // Grows into a tall phone's spare height, never past the screen's width.
      className="block aspect-square h-auto w-[min(330px,84vw,42dvh)]"
    >
      <defs>
        <pattern
          id="dial-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="var(--color-hatch-b)" />
          <rect width="3" height="6" fill="var(--color-hatch-a)" />
        </pattern>
      </defs>

      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-neutral-fill)" strokeWidth={W} />

      {Array.from({ length: 24 }, (_, h) => {
        const a = angle(h * 60)
        const major = h % 6 === 0
        const r0 = R - W / 2 - 6
        const r1 = r0 - (major ? 7 : 3)
        const [x0, y0] = point(r0, a)
        const [x1, y1] = point(r1, a)
        return (
          <line
            key={h}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke={major ? 'var(--color-ink-2)' : 'var(--color-ink-4)'}
            strokeWidth={major ? 1.5 : 1}
          />
        )
      })}

      {[0, 6, 12, 18].map((h) => {
        const [x, y] = point(R + W / 2 + 10, angle(h * 60))
        return (
          <text
            key={h}
            x={x}
            y={y + 3.5}
            textAnchor="middle"
            fill="var(--color-ink-3)"
            className="font-mono"
            fontSize="9.5"
            fontWeight="500"
          >
            {String(h).padStart(2, '0')}
          </text>
        )
      })}

      {closed.map((s) => {
        const start = minuteOf(new Date(s.startedAt).getTime())
        let end = minuteOf(new Date(s.endedAt).getTime())
        if (openStart !== null) end = Math.min(end, openStart)
        const a0 = angle(start) + gapAngle
        const a1 = angle(end) - gapAngle
        if (a1 <= a0) return null
        return (
          <path
            key={`${s.kind}-${s.startedAt}`}
            d={arc(R, a0, a1)}
            fill="none"
            stroke={s.kind === 'gap' ? 'url(#dial-hatch)' : stroke(s.energy)}
            strokeWidth={W}
          />
        )
      })}

      {open && openStart !== null && nowMinute - openStart > 0.5 ? (
        <path
          d={arc(R, angle(openStart) + gapAngle, Math.max(angle(openStart) + gapAngle * 2, angle(nowMinute)))}
          fill="none"
          stroke={stroke(open.energy)}
          strokeWidth={W + 6}
        />
      ) : null}

      {ready && (() => {
        const a = angle(nowMinute)
        const [x0, y0] = point(R - W, a)
        const [x1, y1] = point(R + W, a)
        return (
          <g>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink)" strokeWidth={2} strokeLinecap="round" />
            <circle cx={x1} cy={y1} r={3} fill="var(--color-ink)" />
          </g>
        )
      })()}
    </svg>
  )
}
