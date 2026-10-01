'use client'

import { useId, useState } from 'react'

/**
 * Chart primitives for the review screen.
 *
 * Colour follows globals.css: the data colours are a DIVERGING pair — charge
 * blue at one pole, drain red at the other, neutral grey as the midpoint — and
 * there is deliberately no categorical palette to reach for. So nothing here
 * ever colours a mark by which category it is; hue always means energy, and
 * identity is carried by the label. That also sidesteps the usual failure of
 * ramping a nominal axis, which would double-encode bar length as hue.
 *
 * Marks are thin, grid lines are hairlines one shade off the surface, and every
 * chart carries a hover layer — an SVG chart that doesn't respond to a pointer
 * is throwing away the one thing it has over a printed one.
 */

export const CHARGE = 'var(--color-charge)'
export const DRAIN = 'var(--color-drain)'
export const NEUTRAL = 'var(--color-ink-3)'
export const CHARGE_FILL = 'var(--color-charge-fill)'
export const DRAIN_FILL = 'var(--color-drain-fill)'
export const NEUTRAL_FILL = 'var(--color-neutral-fill)'

export function energyColor(energy: number, fill = false): string {
  if (energy > 0) return fill ? CHARGE_FILL : CHARGE
  if (energy < 0) return fill ? DRAIN_FILL : DRAIN
  return fill ? NEUTRAL_FILL : NEUTRAL
}

export function Tip({ x, y, lines }: { x: number; y: number; lines: string[] }) {
  return (
    <div
      className="pointer-events-none absolute z-20 border border-ink bg-ink px-2 py-1.5 font-mono text-[10px] leading-relaxed text-surface"
      style={{ left: x, top: y, transform: 'translate(-50%, -115%)', whiteSpace: 'nowrap' }}
    >
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? '' : 'text-surface/70'}>
          {l}
        </div>
      ))}
    </div>
  )
}

type Bar = { label: string; value: number; energy: number; sub?: string }

/** Horizontal bars. One row per thing, length is the magnitude, hue is energy. */
export function BarRows({ rows, unit = 'h' }: { rows: Bar[]; unit?: string }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const peak = Math.max(1, ...rows.map((r) => r.value))

  return (
    <div className="relative">
      {hover !== null && rows[hover.i] ? (
        <Tip
          x={hover.x}
          y={hover.y}
          lines={[
            `${rows[hover.i].label} · ${rows[hover.i].value.toFixed(1)}${unit}`,
            rows[hover.i].sub ?? '',
          ].filter(Boolean)}
        />
      ) : null}
      <div className="flex flex-col">
        {rows.map((row, i) => (
          <div
            key={row.label}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              const parent = e.currentTarget.parentElement!.getBoundingClientRect()
              setHover({ i, x: e.clientX - parent.left, y: box.top - parent.top })
            }}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-3 border-b border-rule-2/50 py-[5px] last:border-0"
          >
            <span className="w-[136px] shrink-0 truncate text-[12px]" title={row.label}>
              {row.label}
            </span>
            <span className="relative h-[13px] flex-1 bg-surface-2/60">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[3px]"
                style={{
                  width: `${Math.max(1, (row.value / peak) * 100)}%`,
                  background: energyColor(row.energy),
                }}
              />
            </span>
            <span className="tnum w-14 shrink-0 text-right font-mono text-[11px] text-ink-2">
              {row.value.toFixed(1)}
              {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

type Series = { label: string; color: string; points: Array<{ x: string; y: number | null }> }

/**
 * A multi-series line chart over dates. One y-axis, always — two measures of
 * different scale get two charts rather than a second scale, because the
 * alignment of two scales is arbitrary and invents a correlation.
 */
export function LineChart({
  series,
  height = 170,
  yMax,
  yLabel,
  band,
}: {
  series: Series[]
  height?: number
  yMax?: number
  yLabel?: string
  /** A shaded reference band, e.g. the target range. */
  band?: { from: number; to: number }
}) {
  const clip = useId().replace(/:/g, '')
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null)

  const xs = series[0]?.points.map((p) => p.x) ?? []
  if (xs.length === 0) return null

  const top = yMax ?? Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y ?? 0)))
  // A wide coordinate space, scaled UNIFORMLY. A narrow viewBox stretched with
  // preserveAspectRatio="none" squashes every round cap and marker into a
  // horizontal dash — the line ends up looking dotted when it isn't.
  const W = 1000
  const padL = height >= 140 ? 44 : 6
  const plotW = W - padL
  const px = (i: number) => padL + (xs.length === 1 ? plotW / 2 : (i / (xs.length - 1)) * plotW)
  const py = (v: number) => height - 22 - (v / top) * (height - 34)

  // Below this the three tick labels stack into each other. A facet is small by
  // design and its scale is stated in prose, so drop them rather than ship a
  // collision.
  const showTicks = height >= 140
  const ticks = [0, top / 2, top]

  return (
    <div
      className="relative"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const frac = (e.clientX - box.left) / box.width
        const i = Math.round(frac * (xs.length - 1))
        if (i >= 0 && i < xs.length) setHover({ i, left: e.clientX - box.left })
      }}
    >
      {hover ? (
        <Tip
          x={hover.left}
          y={26}
          lines={[
            xs[hover.i],
            ...series.map(
              (s) =>
                `${s.label}: ${s.points[hover.i]?.y === null ? '—' : s.points[hover.i]?.y?.toFixed(1)}`
            ),
          ]}
        />
      ) : null}

      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ height: 'auto' }}>
        <defs>
          <clipPath id={clip}>
            <rect x={padL} y={0} width={plotW} height={height - 20} />
          </clipPath>
        </defs>

        {band ? (
          <rect
            x={padL}
            y={py(band.to)}
            width={plotW}
            height={Math.max(1, py(band.from) - py(band.to))}
            fill={CHARGE_FILL}
            opacity={0.5}
          />
        ) : null}

        {/* Hairline grid, solid — dashing reads as a threshold it isn't. */}
        {(showTicks ? ticks : []).map((t) => (
          <text
            key={`l-${t}`}
            x={padL - 8}
            y={py(t) + 3.5}
            textAnchor="end"
            fill="var(--color-ink-4)"
            style={{ fontSize: '10px', fontFamily: 'var(--font-plex-mono), monospace' }}
          >
            {t % 1 === 0 ? t : t.toFixed(1)}
          </text>
        ))}
        {ticks.map((t) => (
          <line
            key={t}
            x1={padL}
            x2={W}
            y1={py(t)}
            y2={py(t)}
            stroke="var(--color-rule-2)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {hover ? (
          <line
            x1={px(hover.i)}
            x2={px(hover.i)}
            y1={4}
            y2={height - 20}
            stroke="var(--color-rule-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        <g clipPath={`url(#${clip})`}>
          {series.map((s) => {
            const d = s.points
              .map((p, i) =>
                p.y === null ? null : `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(p.y)}`
              )
              .filter(Boolean)
              .join(' ')
              // A null restarts the path rather than bridging the gap — a line
              // drawn through a day you didn't answer is a day you didn't answer.
              .replace(/L (\S+) (\S+)(?= M)/g, 'L $1 $2')
            return (
              <path
                key={s.label}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {series.map((s) =>
            s.points.map((p, i) =>
              p.y === null ? null : (
                <circle
                  key={`${s.label}-${i}`}
                  cx={px(i)}
                  cy={py(p.y)}
                  r={hover?.i === i ? 5 : 2.5}
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth={hover?.i === i ? 1 : 0}
                  vectorEffect="non-scaling-stroke"
                />
              )
            )
          )}
        </g>
      </svg>

      <div className="tnum -mt-1 flex justify-between font-mono text-[9px] tracking-[0.06em] text-ink-4">
        <span>{xs[0]}</span>
        {yLabel ? <span className="text-ink-3">{yLabel}</span> : null}
        <span>{xs[xs.length - 1]}</span>
      </div>
    </div>
  )
}

/** Legend. Always present from two series up; identity is never colour alone. */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="block h-[3px] w-4 rounded-full" style={{ background: i.color }} />
          <span className="font-mono text-[9px] tracking-[0.1em] text-ink-3">
            {i.label.toUpperCase()}
          </span>
        </span>
      ))}
    </div>
  )
}
