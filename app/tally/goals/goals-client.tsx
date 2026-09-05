'use client'

import { useCallback, useState, useTransition } from 'react'
import type { GoalsView } from '@/lib/goals'
import {
  archiveGoalAction,
  createGoalAction,
  moveGoalAction,
  renameGoalAction,
  setCategoryGoalAction,
  type GoalsResult,
} from './actions'

function Sparkline({ weeks }: { weeks: number[] }) {
  const peak = Math.max(1, ...weeks)
  const points = weeks.map((v, i) => ({
    x: (i / Math.max(1, weeks.length - 1)) * 120,
    y: 33 - (v / peak) * 30,
  }))
  const rising = weeks[weeks.length - 1] >= weeks[0]
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox="0 0 120 34" width="120" height="34" className="shrink-0 overflow-visible">
      <line x1="0" y1="33" x2="120" y2="33" stroke="#efeee9" strokeWidth="1" />
      <path
        d={path}
        fill="none"
        stroke={rising ? '#2a78d6' : '#e34948'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function GoalsClient({ initial }: { initial: GoalsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [selected, setSelected] = useState<string>(initial.categories[0]?.slug ?? '')
  const [pending, startTransition] = useTransition()

  const dispatch = useCallback((work: () => Promise<GoalsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
    })
  }, [])

  const current = view.categories.find((c) => c.slug === selected)
  const goalTitle = (id: string | null) =>
    id ? (view.goals.find((g) => g.id === id)?.title ?? 'archived goal') : 'no goal'

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10">
      <header>
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">GOALS &amp; PRIORITIES</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-4">
          <h1 className="text-[27px] font-semibold tracking-tight">Five goals, ranked by hand</h1>
          <p className="text-[13px] text-ink-3">
            The rank is a declaration. The hours are the measurement. Keeping them apart is the point.
          </p>
        </div>
      </header>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      <div className="mt-6 flex flex-col gap-5 lg:flex-row">
        <section className="flex-1 border border-rule bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
              ACTIVE · HORIZON “CURRENT”
            </div>
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4">
              LAST 4 WEEKS · THIS WEEK
            </div>
          </div>

          <div className="mt-3.5 flex flex-col gap-2">
            {view.goals.length === 0 ? (
              <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
                No goals yet. Add up to five — the ones you would defend if someone asked where your
                week went.
              </p>
            ) : null}

            {view.goals.map((goal, index) => (
              <div
                key={goal.id}
                className="flex flex-wrap items-center gap-3.5 border border-rule-2 p-3"
              >
                <div className="flex shrink-0 flex-col gap-[3px]">
                  <button
                    type="button"
                    disabled={pending || index === 0}
                    onClick={() => dispatch(() => moveGoalAction(goal.id, 'up'))}
                    className="h-[22px] w-[26px] border border-rule bg-surface text-[11px] leading-none text-ink-2 disabled:text-rule"
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={pending || index === view.goals.length - 1}
                    onClick={() => dispatch(() => moveGoalAction(goal.id, 'down'))}
                    className="h-[22px] w-[26px] border border-rule bg-surface text-[11px] leading-none text-ink-2 disabled:text-rule"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>

                <span className="tnum w-[18px] shrink-0 font-mono text-xl font-medium text-ink-4">
                  {goal.rank}
                </span>

                <div className="min-w-[180px] flex-1">
                  {editing === goal.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        dispatch(() => renameGoalAction(goal.id, editTitle))
                        setEditing(null)
                      }}
                    >
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        onBlur={() => setEditing(null)}
                        className="w-full border border-rule-strong bg-surface px-2 py-1 text-base outline-none"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(goal.id)
                        setEditTitle(goal.title)
                      }}
                      className="text-left text-base font-medium tracking-tight"
                    >
                      {goal.title}
                    </button>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {goal.categories.length === 0 ? (
                      <span className="border border-rule-2 bg-ground px-[7px] py-[3px] text-[11px] text-ink-4">
                        no categories mapped
                      </span>
                    ) : (
                      goal.categories.map((c) => (
                        <span
                          key={c.slug}
                          className="border border-rule-2 bg-ground px-[7px] py-[3px] text-[11px] text-ink-2"
                        >
                          {c.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <Sparkline weeks={goal.weeks} />

                <span
                  className={`tnum w-[62px] shrink-0 text-right font-mono text-[19px] font-medium tracking-tight ${
                    goal.weeks[goal.weeks.length - 1] === 0 ? 'text-drain-ink' : 'text-ink'
                  }`}
                >
                  {goal.weeks[goal.weeks.length - 1].toFixed(1)}h
                </span>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => dispatch(() => archiveGoalAction(goal.id))}
                  className="shrink-0 border border-rule px-2.5 py-1.5 font-mono text-[9px] tracking-[0.1em] text-ink-3 disabled:opacity-40"
                >
                  ARCHIVE
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!draft.trim() || view.atCap) return
              dispatch(() => createGoalAction(draft))
              setDraft('')
            }}
            className="mt-3.5 flex items-center gap-3 border border-dashed border-rule p-3.5"
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={view.atCap || pending}
              placeholder={view.atCap ? 'Archive one to add another' : 'Add a goal'}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
            />
            {view.atCap ? (
              <span className="font-mono text-[10px] tracking-[0.1em] text-drain-ink">
                5 OF 5 USED
              </span>
            ) : (
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                className="border border-ink bg-ink px-3.5 py-2 text-[13px] text-surface disabled:opacity-30"
              >
                Add
              </button>
            )}
          </form>

          <p className="mt-4 max-w-[620px] border-t border-rule-2 pt-4 text-[13px] leading-relaxed text-ink-3">
            Quarter, year and five-year horizons already exist in the data, and a goal can hang off a
            parent. Neither is on screen until there are four weeks of energy data to hang the longer
            horizons on.
          </p>
        </section>

        <section className="w-full shrink-0 border border-rule bg-surface p-5 lg:w-[452px]">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
              CATEGORY → DEFAULT GOAL
            </div>
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4">
              {view.categories.filter((c) => c.goalId).length} OF {view.categories.length}
            </div>
          </div>

          <div className="mt-3 flex flex-col">
            {view.categories.map((category) => (
              <button
                key={category.slug}
                type="button"
                onClick={() => setSelected(category.slug)}
                className={`flex items-center gap-2.5 border-b border-rule-2/60 px-2 py-[7px] text-left ${
                  category.slug === selected ? 'bg-surface-2' : ''
                }`}
              >
                <span
                  className="block h-2.5 w-5 shrink-0"
                  style={{
                    background:
                      category.energy > 0
                        ? '#cfdff6'
                        : category.energy < 0
                          ? '#f7d5d4'
                          : '#e4e3dd',
                  }}
                />
                <span className="flex-1 truncate text-[13px]">{category.name}</span>
                <span className="tnum w-11 shrink-0 text-right font-mono text-xs text-ink-3">
                  {category.hoursThisWeek.toFixed(1)}
                </span>
                <span
                  className={`w-[148px] shrink-0 truncate text-right text-xs ${
                    category.goalId ? 'text-ink' : 'text-ink-4'
                  }`}
                >
                  {goalTitle(category.goalId)}
                </span>
              </button>
            ))}
          </div>

          {current ? (
            <div className="mt-4 border-t border-rule-2 pt-3.5">
              <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                DEFAULT GOAL FOR “{current.name.toUpperCase()}”
              </div>
              <div className="mt-2.5 flex flex-col gap-[5px]">
                {view.goals.map((goal) => (
                  <button
                    key={goal.id}
                    type="button"
                    disabled={pending}
                    onClick={() => dispatch(() => setCategoryGoalAction(current.slug, goal.id))}
                    className={`border px-2.5 py-2 text-left text-xs ${
                      current.goalId === goal.id
                        ? 'border-ink bg-ink text-surface'
                        : 'border-rule bg-surface text-ink'
                    }`}
                  >
                    {goal.title}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => dispatch(() => setCategoryGoalAction(current.slug, null))}
                  className={`border px-2.5 py-2 text-left text-xs ${
                    current.goalId === null
                      ? 'border-ink bg-ink text-surface'
                      : 'border-rule bg-surface text-ink-3'
                  }`}
                >
                  No goal
                </button>
              </div>
            </div>
          ) : null}

          <p className="mt-3.5 text-xs leading-relaxed text-ink-3">
            A block inherits its goal from the category at the moment it opens. Changing a default
            here does not rewrite blocks already logged.
          </p>

          <div className="mt-3.5 flex items-baseline justify-between border-t border-rule-2 pt-3.5">
            <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
              THIS WEEK, AGAINST NO GOAL
            </span>
            <span className="tnum font-mono text-[15px] font-medium">
              {view.unassignedHours.toFixed(1)}h
            </span>
          </div>
        </section>
      </div>
    </main>
  )
}
