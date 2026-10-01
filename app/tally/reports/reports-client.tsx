'use client'

import { useMemo, useState } from 'react'
import type { Reports } from '@/lib/reports'
import { BarRows, CHARGE, DRAIN, energyColor, Legend, LineChart, NEUTRAL } from './charts'

/**
 * The week-4 review screen.
 *
 * Ordered as the review has to be read, not as the data happens to sit: how far
 * the log can be trusted comes FIRST, because every number after it inherits
 * that answer. Then where the time went, then the three displacement claims —
 * which is what the allocation report became once goals and hours were
 * decoupled — then the response variable, then the systems meant to move it.
 */

const DISPLACEMENTS = [
  { slug: 'media-scroll', label: 'Media / scroll', note: 'Unilateral — yours alone' },
  { slug: 'yard-garden', label: 'Yard / garden', note: 'Needs C' },
  { slug: 'household-chores', label: 'Household chores', note: 'Needs C' },
  { slug: 'commute', label: 'Commute', note: 'Needs the WFH lever' },
]

function hoursLabel(h: number): string {
  return h >= 10 ? h.toFixed(0) : h.toFixed(1)
}

function Stat({
  value,
  label,
  note,
  tone = 'ink',
}: {
  value: string
  label: string
  note?: string
  tone?: 'ink' | 'charge' | 'drain'
}) {
  const color = tone === 'charge' ? CHARGE : tone === 'drain' ? DRAIN : undefined
  return (
    <div className="border border-rule bg-surface px-4 py-3.5">
      <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">{label.toUpperCase()}</div>
      <div
        className="tnum mt-1.5 font-sans text-[27px] leading-none font-semibold tracking-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      {note ? <div className="mt-1.5 text-[11px] leading-snug text-ink-3">{note}</div> : null}
    </div>
  )
}

function Section({
  n,
  title,
  lede,
  children,
}: {
  n: string
  title: string
  lede: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-10 border-t border-rule pt-6">
      <div className="font-mono text-[9px] tracking-[0.14em] text-ink-4">{n}</div>
      <h2 className="mt-1.5 text-[19px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-ink-3">{lede}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function ReportsClient({ reports }: { reports: Reports }) {
  const [weeks, setWeeks] = useState<number | null>(null)

  const allWeeks = useMemo(() => {
    const set = new Set<string>()
    for (const c of reports.categoryWeeks) for (const w of c.weeks) set.add(w.weekStart)
    return [...set].sort()
  }, [reports.categoryWeeks])

  const shownWeeks = weeks === null ? allWeeks : allWeeks.slice(-weeks)
  const firstShown = shownWeeks[0] ?? '0000-00-00'

  const days = reports.days.filter((d) => d.date >= firstShown)
  const checks = reports.checks.filter((c) => c.date >= firstShown)

  // --- 1. trust ------------------------------------------------------------
  const loggedMin = days.reduce((n, d) => n + d.loggedMinutes, 0)
  const coverage = days.length === 0 ? 0 : (loggedMin / (days.length * 1440)) * 100
  const checkedDays = days.filter((d) => d.checked).length
  const worstDay = [...days].sort((a, b) => a.loggedMinutes - b.loggedMinutes)[0]
  const overLogged = days.filter((d) => d.loggedMinutes > 1445)

  // --- 2. where it went ----------------------------------------------------
  const catInWindow = useMemo(() => {
    const totals = new Map<string, number>()
    for (const c of reports.categoryWeeks) {
      const sum = c.weeks.filter((w) => w.weekStart >= firstShown).reduce((n, w) => n + w.hours, 0)
      if (sum > 0) totals.set(c.slug, sum)
    }
    return reports.categories
      .map((c) => ({ ...c, hours: totals.get(c.slug) ?? 0 }))
      .filter((c) => c.hours > 0)
      .sort((a, b) => b.hours - a.hours)
  }, [reports, firstShown])

  const charge = catInWindow.filter((c) => c.energy > 0).reduce((n, c) => n + c.hours, 0)
  const drain = catInWindow.filter((c) => c.energy < 0).reduce((n, c) => n + c.hours, 0)
  const unrated = catInWindow.filter((c) => c.energy === 0).reduce((n, c) => n + c.hours, 0)

  // --- 3. displacements ----------------------------------------------------
  const displacementSeries = DISPLACEMENTS.map((d) => {
    const found = reports.categoryWeeks.find((c) => c.slug === d.slug)
    const byWeek = new Map(found?.weeks.map((w) => [w.weekStart, w.hours]) ?? [])
    return { ...d, points: shownWeeks.map((w) => ({ x: w.slice(5), y: byWeek.get(w) ?? 0 })) }
  }).filter((d) => d.points.some((p) => p.y > 0))

  // One scale across the facets, or the panels stop being comparable.
  const displacementPeak = Math.max(
    1,
    ...displacementSeries.flatMap((d) => d.points.map((p) => p.y))
  )

  // --- 4. response ---------------------------------------------------------
  const answered = checks.filter((c) => c.energy !== null)
  const meanEnergy =
    answered.length === 0 ? null : answered.reduce((n, c) => n + (c.energy ?? 0), 0) / answered.length
  const movedDays = checks.filter((c) => c.movedPriority === true).length
  const movedAnswered = checks.filter((c) => c.movedPriority !== null).length

  // --- 5. outsourcing queue ------------------------------------------------
  const queue = catInWindow
    .filter((c) => c.buybackCost !== null && c.valueTier <= 1)
    .map((c) => ({ ...c, monthly: (c.hours / Math.max(1, days.length)) * 30 * (c.buybackCost ?? 0) }))
    .sort((a, b) => b.monthly - a.monthly)

  // --- 6. rounds -----------------------------------------------------------
  const doneChores = reports.chores.filter((c) => c.completions > 0)
  const neverDone = reports.chores.filter((c) => c.completions === 0)
  const timed = reports.chores.filter((c) => c.actualMinutes !== null)
  const drifted = reports.chores
    .filter((c) => c.actualIntervalDays !== null)
    .map((c) => ({ ...c, drift: (c.actualIntervalDays as number) - c.intervalDays }))
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10">
      <header>
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
          REVIEW · {reports.window.from} → {reports.window.to}
        </div>
        <h1 className="mt-2 text-[27px] font-semibold tracking-tight">
          {days.length} days of the log, read back
        </h1>
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink-3">
          Days are cut in {reports.window.timezone}, and a block that crosses midnight is split
          between the two days it touches — which matters most for sleep, and would otherwise
          leave a hole in every morning.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-4">SHOW</span>
          {[
            { label: 'Last 4 weeks', v: 4 as number | null },
            { label: 'Last 8 weeks', v: 8 as number | null },
            { label: 'Everything', v: null },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setWeeks(o.v)}
              className={`border px-2.5 py-1.5 text-[12px] ${
                weeks === o.v
                  ? 'border-ink bg-ink text-surface'
                  : 'border-rule bg-surface text-ink-2'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      <Section
        n="01"
        title="Can this data be trusted?"
        lede="First, because every number below inherits the answer. A day logged at 60% is not a day you spent 40% of doing nothing — it is a day the instrument missed, and reading a category total off it would be reading the gaps as much as the hours."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            value={`${coverage.toFixed(0)}%`}
            label="of the clock logged"
            note={`${hoursLabel(loggedMin / 60)}h across ${days.length} days`}
            tone={coverage >= 85 ? 'charge' : coverage >= 70 ? 'ink' : 'drain'}
          />
          <Stat
            value={`${checkedDays}/${days.length}`}
            label="days checked"
            note="Reconciled and both questions answered"
          />
          <Stat
            value={worstDay ? `${(worstDay.loggedMinutes / 60).toFixed(1)}h` : '—'}
            label="thinnest day"
            note={worstDay ? `${worstDay.date} — the day most worth repairing` : undefined}
            tone="drain"
          />
          <Stat
            value={String(overLogged.length)}
            label="days over 24h"
            note={
              overLogged.length === 0
                ? 'No overlapping blocks — the log is internally consistent'
                : `Overlaps: ${overLogged.map((d) => d.date).join(', ')}`
            }
            tone={overLogged.length === 0 ? 'charge' : 'drain'}
          />
        </div>

        <div className="mt-4 border border-rule bg-surface p-4">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            HOURS LOGGED PER DAY · 24H IS A COMPLETE DAY
          </div>
          <div className="mt-2.5">
            <LineChart
              yMax={24}
              band={{ from: 20, to: 24 }}
              yLabel="BAND = 20–24H LOGGED"
              series={[
                {
                  label: 'Logged',
                  color: CHARGE,
                  points: days.map((d) => ({ x: d.date.slice(5), y: d.loggedMinutes / 60 })),
                },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section
        n="02"
        title="Where the time went"
        lede="Hue is energy, never identity: blue charges, red drains, grey is unrated. Unrated is not a gap in the data — it is the deliberate 0 from migration 0004, and it is the single biggest thing standing between this chart and a decision."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat value={`${hoursLabel(charge)}h`} label="charging" tone="charge" />
          <Stat value={`${hoursLabel(drain)}h`} label="draining" tone="drain" />
          <Stat
            value={`${hoursLabel(unrated)}h`}
            label="unrated"
            note={
              unrated > charge + drain
                ? 'More than charge and drain combined — rate these and the quadrant starts working'
                : undefined
            }
          />
        </div>
        <div className="mt-3 border border-rule bg-surface p-4">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
              HOURS BY CATEGORY
            </span>
            <Legend
              items={[
                { label: 'Charges', color: CHARGE },
                { label: 'Unrated', color: NEUTRAL },
                { label: 'Drains', color: DRAIN },
              ]}
            />
          </div>
          <BarRows
            rows={catInWindow.map((c) => ({
              label: c.name,
              value: c.hours,
              energy: c.energy,
              sub: `${c.blocks} blocks · ${((c.hours / (loggedMin / 60)) * 100).toFixed(0)}% of logged time`,
            }))}
          />
        </div>
      </Section>

      <Section
        n="03"
        title="The three displacements"
        lede="This is what the allocation report became. Hours can't measure a goal — B succeeds in one conversation — but they can measure a subtraction, which is a claim about quantity. Falling lines are the claim holding."
      >
        {displacementSeries.length === 0 ? (
          <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
            None of the named categories have hours in this window.
          </p>
        ) : (
          <>
            {/* Small multiples rather than four lines on one plot. Four series
                would need four hues, and this design system has three — the
                fourth would have to be a second red, which no one can tell from
                the first. Faceting also fits the data: each of these is a
                separate claim, not a comparison between them. Shared y-scale so
                the panels remain comparable; one hue, because they are all the
                same kind of thing and the title carries identity. */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {displacementSeries.map((d) => {
                const first = d.points[0]?.y ?? 0
                const last = d.points[d.points.length - 1]?.y ?? 0
                const delta = last - first
                return (
                  <div key={d.slug} className="border border-rule bg-surface p-3.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{d.label}</span>
                      <span
                        className="tnum shrink-0 font-mono text-[13px]"
                        style={{ color: delta < 0 ? CHARGE : delta > 0 ? DRAIN : undefined }}
                      >
                        {delta > 0 ? '+' : ''}
                        {delta.toFixed(1)}
                      </span>
                    </div>
                    <div className="mt-2">
                      <LineChart
                        height={110}
                        yMax={displacementPeak}
                        series={[{ label: d.label, color: DRAIN, points: d.points }]}
                      />
                    </div>
                    <div className="mt-1 text-[10px] leading-snug text-ink-4">{d.note}</div>
                  </div>
                )
              })}
            </div>
            <p className="mt-2.5 max-w-[68ch] text-[11px] leading-relaxed text-ink-3">
              All four panels share one vertical scale, so the heights are comparable. The number
              beside each title is the change from the first week shown to the last — blue is the
              subtraction happening, red is it going the other way.
            </p>
          </>
        )}
      </Section>

      <Section
        n="04"
        title="The response variable"
        lede="End-of-day energy and whether a priority moved. This is the only thing in the whole system that measures the outcome rather than the activity — and moved_priority is the closest thing to goal progress the data holds, because it asks you rather than inferring from hours."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat
            value={meanEnergy === null ? '—' : meanEnergy.toFixed(1)}
            label="mean energy"
            note={`${answered.length} of ${days.length} days answered`}
          />
          <Stat
            value={movedAnswered === 0 ? '—' : `${((movedDays / movedAnswered) * 100).toFixed(0)}%`}
            label="days a priority moved"
            note={`${movedDays} of ${movedAnswered} answered`}
            tone={movedAnswered > 0 && movedDays / movedAnswered >= 0.5 ? 'charge' : 'drain'}
          />
          <Stat
            value={`${days.length - answered.length}`}
            label="days unanswered"
            note="Every one is a hole in the run chart"
          />
        </div>
        <div className="mt-3 border border-rule bg-surface p-4">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            END-OF-DAY ENERGY · 1–10
          </div>
          <div className="mt-2.5">
            <LineChart
              yMax={10}
              series={[
                {
                  label: 'Energy',
                  color: CHARGE,
                  points: checks.map((c) => ({ x: c.date.slice(5), y: c.energy })),
                },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section
        n="05"
        title="The outsourcing queue"
        lede="Low-value categories with a price on them, costed at what this window's rate would run to over a month. Ferriss before Martell: ask whether it should exist at all before asking who should do it."
      >
        {queue.length === 0 ? (
          <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
            Nothing qualifies yet — a category needs a buyback cost and a low value tier.
          </p>
        ) : (
          <div className="overflow-x-auto border border-rule bg-surface">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead>
                <tr className="border-b border-rule text-left font-mono text-[9px] tracking-[0.1em] text-ink-3">
                  <th className="px-3 py-2 font-normal">CATEGORY</th>
                  <th className="px-3 py-2 text-right font-normal">HOURS</th>
                  <th className="px-3 py-2 text-right font-normal">$/HR</th>
                  <th className="px-3 py-2 text-right font-normal">~$/MONTH</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((c) => (
                  <tr key={c.slug} className="border-b border-rule-2/60 last:border-0">
                    <td className="px-3 py-2">
                      <span
                        className="mr-2 inline-block h-2 w-3.5 align-middle"
                        style={{ background: energyColor(c.energy) }}
                      />
                      {c.name}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.hours.toFixed(1)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink-3">
                      {c.buybackCost}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">
                      {c.monthly.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        n="06"
        title="Rounds — what the house actually asks for"
        lede="Intervals are guesses and the app assumes they're wrong. The number that matters is the gap between how often you said a chore comes round and how often you actually did it, and the gap between the minutes you budgeted and the minutes it took."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            value={String(doneChores.length)}
            label="chores done at least once"
            note={`of ${reports.chores.length} on the list`}
          />
          <Stat
            value={String(neverDone.length)}
            label="never done in window"
            note={
              neverDone.length > 0
                ? neverDone.slice(0, 3).map((c) => c.name).join(', ') +
                  (neverDone.length > 3 ? `, +${neverDone.length - 3}` : '')
                : undefined
            }
            tone={neverDone.length > reports.chores.length / 2 ? 'drain' : 'ink'}
          />
          <Stat
            value={String(timed.length)}
            label="chores with a real time"
            note="From the clock, not the estimate"
          />
          <Stat
            value={String(reports.chores.reduce((n, c) => n + c.completions, 0))}
            label="completions logged"
          />
        </div>

        {drifted.length > 0 ? (
          <div className="mt-3 overflow-x-auto border border-rule bg-surface">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-rule text-left font-mono text-[9px] tracking-[0.1em] text-ink-3">
                  <th className="px-3 py-2 font-normal">CHORE</th>
                  <th className="px-3 py-2 font-normal">AREA</th>
                  <th className="px-3 py-2 text-right font-normal">SAID</th>
                  <th className="px-3 py-2 text-right font-normal">ACTUAL</th>
                  <th className="px-3 py-2 text-right font-normal">DRIFT</th>
                  <th className="px-3 py-2 text-right font-normal">EST</th>
                  <th className="px-3 py-2 text-right font-normal">REAL</th>
                </tr>
              </thead>
              <tbody>
                {drifted.map((c) => (
                  <tr key={c.slug} className="border-b border-rule-2/60 last:border-0">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] tracking-[0.08em] text-ink-4">
                      {(c.area ?? '—').toUpperCase()}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink-3">
                      {c.intervalDays}d
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.actualIntervalDays}d</td>
                    <td
                      className="tnum px-3 py-2 text-right font-mono"
                      style={{ color: Math.abs(c.drift) > c.intervalDays * 0.5 ? DRAIN : undefined }}
                    >
                      {c.drift > 0 ? '+' : ''}
                      {c.drift.toFixed(1)}d
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink-3">
                      {c.estimateMinutes}m
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">
                      {c.actualMinutes === null ? '—' : `${c.actualMinutes}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-rule-2 px-3 py-2 text-[11px] leading-snug text-ink-3">
              Drift needs two completions to mean anything. A positive drift means it comes round
              slower than you said — the interval is too short. Negative means you do it more often
              than the app asks, which usually means the interval is too long and you notice the
              mess first.
            </p>
          </div>
        ) : (
          <p className="mt-3 border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
            No chore has been completed twice in this window yet, so there is no drift to read.
          </p>
        )}
      </Section>

      <Section
        n="07"
        title="The systems meant to move the goals"
        lede="Lead measures, entered by hand. Hours were never going to measure these — a conversation that happened is a fact only you hold — so this is a count against a target, and a sequence rather than a total, because “never miss twice” is a question you can only ask of a sequence."
      >
        {reports.goals.length === 0 ? (
          <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
            No active goals.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.goals.map((g) => {
              const shown = g.periods.filter((p) => p.periodStart >= firstShown).slice(-12)
              const hit = shown.filter((p) => g.targetCount !== null && p.doneCount >= g.targetCount)
              return (
                <div key={g.id} className="border border-rule bg-surface p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tnum font-mono text-[15px] text-ink-4">{g.rank}</span>
                    <span className="text-[15px] font-medium tracking-tight">{g.title}</span>
                    {g.targetCount !== null ? (
                      <span className="font-mono text-[9px] tracking-[0.1em] text-ink-3">
                        TARGET {g.targetCount}/{g.targetPeriod.toUpperCase()}
                      </span>
                    ) : null}
                    <span className="tnum ml-auto font-mono text-[13px]">
                      {shown.length === 0 ? '—' : `${hit.length}/${shown.length} periods hit`}
                    </span>
                  </div>
                  {g.leadMeasure ? (
                    <p className="mt-1.5 max-w-[70ch] text-[12px] leading-snug text-ink-3">
                      {g.leadMeasure}
                    </p>
                  ) : null}
                  {shown.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-[3px]">
                      {shown.map((p) => {
                        const met = g.targetCount !== null && p.doneCount >= g.targetCount
                        const part = p.doneCount > 0
                        return (
                          <span
                            key={p.periodStart}
                            title={`${p.periodStart} — ${p.doneCount}`}
                            className="flex h-7 w-9 items-center justify-center border font-mono text-[10px]"
                            style={{
                              borderColor: met ? CHARGE : part ? 'var(--color-rule)' : 'var(--color-rule)',
                              background: met ? CHARGE : part ? 'var(--color-charge-fill)' : 'var(--color-surface)',
                              color: met ? 'var(--color-surface)' : 'var(--color-ink-2)',
                            }}
                          >
                            {p.doneCount}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 font-mono text-[10px] tracking-[0.1em] text-drain-ink">
                      NOTHING LOGGED — A LEAD MEASURE WITH NO ENTRIES IS AN INTENTION
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </main>
  )
}
