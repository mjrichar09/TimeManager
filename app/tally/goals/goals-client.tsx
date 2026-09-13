'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import type { GoalRow, GoalsView, Periods, TargetPeriod } from '@/lib/goals'
import {
  addMilestoneAction,
  archiveGoalAction,
  createGoalAction,
  deleteMilestoneAction,
  loadGoalsAction,
  moveGoalAction,
  renameGoalAction,
  setCategoryGoalAction,
  setGoalPlanAction,
  setMilestoneDoneAction,
  setProgressAction,
  updateMilestoneAction,
  type GoalsResult,
} from './actions'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The current week and month, in the browser's own timezone.
 *
 * The server renders a guess so the first paint isn't empty, and this replaces
 * it on mount. Same reasoning as reconcile's `localWindow`: a Sunday-night tick
 * must not land in next week because the server happens to be in UTC.
 */
function localPeriods(): Periods {
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return { week: ymd(monday), month: ymd(new Date(now.getFullYear(), now.getMonth(), 1)) }
}

/** "3 Oct", or an em dash for a milestone with no date yet. */
function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Whole days from today to `iso`, local time. Negative is overdue. */
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((then.getTime() - today.getTime()) / 86_400_000)
}

function cadence(goal: GoalRow): string | null {
  if (!goal.targetCount) return null
  const per = goal.targetPeriod === 'month' ? 'month' : 'week'
  const times = `${goal.targetCount}×/${per}`
  return goal.sessionMinutes ? `${goal.sessionMinutes} min · ${times}` : times
}

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

/**
 * The lead-measure scoreboard: sessions done this period against the target.
 *
 * Typed in, not counted from anything. The plus and minus are the whole input
 * method — one tap after the thing happens, which is the most a scoreboard can
 * ask for without becoming a second capture habit.
 */
function Scoreboard({
  goal,
  disabled,
  onChange,
}: {
  goal: GoalRow
  disabled: boolean
  onChange: (done: number) => void
}) {
  const target = goal.targetCount
  const hit = target !== null && goal.done >= target

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || goal.done === 0}
        onClick={() => onChange(goal.done - 1)}
        className="h-[26px] w-[26px] border border-rule bg-surface text-sm leading-none text-ink-2 disabled:text-rule"
        aria-label="One fewer this period"
      >
        −
      </button>
      <span
        className={`tnum w-[52px] text-center font-mono text-[15px] font-medium ${
          hit ? 'text-charge' : 'text-ink'
        }`}
      >
        {goal.done}
        <span className="text-ink-4">{target === null ? '' : ` / ${target}`}</span>
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(goal.done + 1)}
        className="h-[26px] w-[26px] border border-rule bg-surface text-sm leading-none text-ink-2 disabled:text-rule"
        aria-label="One more this period"
      >
        +
      </button>
    </div>
  )
}

/** The last four periods as filled proportions. Flat and small on purpose. */
function History({ goal }: { goal: GoalRow }) {
  const target = goal.targetCount ?? Math.max(1, ...goal.history.map((h) => h.done))
  return (
    <div className="flex items-end gap-1">
      {goal.history.map((period, index) => {
        const share = Math.min(1, period.done / Math.max(1, target))
        const current = index === goal.history.length - 1
        return (
          <div
            key={period.periodStart}
            title={`${period.periodStart}: ${period.done}`}
            className="flex h-[22px] w-[14px] flex-col justify-end border border-rule-2 bg-ground"
          >
            <div
              style={{ height: `${Math.round(share * 100)}%` }}
              className={current ? 'bg-ink-3' : 'bg-rule-strong'}
            />
          </div>
        )
      })}
    </div>
  )
}

function PlanForm({
  goal,
  disabled,
  onSave,
  onCancel,
}: {
  goal: GoalRow
  disabled: boolean
  onSave: (plan: {
    leadMeasure: string
    targetCount: string
    targetPeriod: TargetPeriod
    sessionMinutes: string
    twoMinute: string
    obstacle: string
  }) => void
  onCancel: () => void
}) {
  const [leadMeasure, setLeadMeasure] = useState(goal.leadMeasure ?? '')
  const [targetCount, setTargetCount] = useState(goal.targetCount?.toString() ?? '')
  const [targetPeriod, setTargetPeriod] = useState<TargetPeriod>(goal.targetPeriod)
  const [sessionMinutes, setSessionMinutes] = useState(goal.sessionMinutes?.toString() ?? '')
  const [twoMinute, setTwoMinute] = useState(goal.twoMinute ?? '')
  const [obstacle, setObstacle] = useState(goal.obstacle ?? '')

  const field =
    'w-full border border-rule bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-rule-strong'
  const label = 'font-mono text-[9px] tracking-[0.12em] text-ink-3'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ leadMeasure, targetCount, targetPeriod, sessionMinutes, twoMinute, obstacle })
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label className={label} htmlFor={`lead-${goal.id}`}>
          LEAD MEASURE — WHEN, WHERE, WHAT
        </label>
        <textarea
          id={`lead-${goal.id}`}
          rows={2}
          value={leadMeasure}
          onChange={(event) => setLeadMeasure(event.target.value)}
          placeholder="Sunday 8pm, kitchen table, phones in the other room…"
          className={`${field} resize-y`}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor={`count-${goal.id}`}>
            HOW OFTEN
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`count-${goal.id}`}
              inputMode="numeric"
              value={targetCount}
              onChange={(event) => setTargetCount(event.target.value)}
              placeholder="3"
              className={`${field} tnum w-[58px] text-center`}
            />
            <span className="text-[13px] text-ink-3">× per</span>
            <select
              value={targetPeriod}
              onChange={(event) => setTargetPeriod(event.target.value as TargetPeriod)}
              className={`${field} w-[86px]`}
            >
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={label} htmlFor={`minutes-${goal.id}`}>
            TIME BOX
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`minutes-${goal.id}`}
              inputMode="numeric"
              value={sessionMinutes}
              onChange={(event) => setSessionMinutes(event.target.value)}
              placeholder="30"
              className={`${field} tnum w-[58px] text-center`}
            />
            <span className="text-[13px] text-ink-3">minutes a session</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor={`two-${goal.id}`}>
          TWO-MINUTE VERSION — WHAT COUNTS ON THE WORST DAY
        </label>
        <input
          id={`two-${goal.id}`}
          value={twoMinute}
          onChange={(event) => setTwoMinute(event.target.value)}
          placeholder="One message."
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor={`obstacle-${goal.id}`}>
          OBSTACLE, NAMED IN ADVANCE — IF X, THEN Y
        </label>
        <input
          id={`obstacle-${goal.id}`}
          value={obstacle}
          onChange={(event) => setObstacle(event.target.value)}
          placeholder="If it escalates in the moment, then: can we put that on Sunday?"
          className={field}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled}
          className="border border-ink bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:opacity-30"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-rule px-3.5 py-1.5 text-[13px] text-ink-2"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Milestones({
  goal,
  disabled,
  onAdd,
  onUpdate,
  onToggle,
  onDelete,
}: {
  goal: GoalRow
  disabled: boolean
  onAdd: (title: string, dueOn: string) => void
  onUpdate: (id: string, title: string, dueOn: string) => void
  onToggle: (id: string, done: boolean) => void
  onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDue, setEditDue] = useState('')

  const next = goal.milestones.find((m) => !m.doneOn && m.dueOn)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">MILESTONES</div>
        <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4">
          {goal.milestones.filter((m) => m.doneOn).length} OF {goal.milestones.length} DONE
        </div>
      </div>

      {goal.milestones.length === 0 ? (
        <p className="text-[12px] text-ink-4">
          Nothing dated yet. A goal a year out with no milestone has exactly one reading, and it
          arrives too late to act on.
        </p>
      ) : null}

      {goal.milestones.map((milestone) => {
        const away = milestone.dueOn && !milestone.doneOn ? daysUntil(milestone.dueOn) : null
        const late = away !== null && away < 0
        const soon = away !== null && away >= 0 && away <= 14

        return (
          <div key={milestone.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggle(milestone.id, !milestone.doneOn)}
              aria-label={milestone.doneOn ? 'Mark not done' : 'Mark done'}
              className={`h-[17px] w-[17px] shrink-0 border text-[11px] leading-none ${
                milestone.doneOn ? 'border-ink bg-ink text-surface' : 'border-rule-strong bg-surface'
              }`}
            >
              {milestone.doneOn ? '✓' : ''}
            </button>

            {editing === milestone.id ? (
              <form
                className="flex flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  onUpdate(milestone.id, editTitle, editDue)
                  setEditing(null)
                }}
              >
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="min-w-0 flex-1 border border-rule-strong bg-surface px-1.5 py-1 text-[13px] outline-none"
                />
                <input
                  type="date"
                  value={editDue}
                  onChange={(event) => setEditDue(event.target.value)}
                  className="tnum shrink-0 border border-rule bg-surface px-1.5 py-1 text-[12px] outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 border border-ink bg-ink px-2 py-1 text-[11px] text-surface"
                >
                  Save
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(milestone.id)
                    setEditTitle(milestone.title)
                    setEditDue(milestone.dueOn ?? '')
                  }}
                  className={`min-w-0 flex-1 truncate text-left text-[13px] ${
                    milestone.doneOn ? 'text-ink-4 line-through' : 'text-ink'
                  }`}
                >
                  {milestone.title}
                </button>
                <span
                  className={`tnum w-[86px] shrink-0 text-right font-mono text-[11px] ${
                    late ? 'text-drain-ink' : soon ? 'text-ink-2' : 'text-ink-4'
                  }`}
                >
                  {milestone.doneOn
                    ? shortDate(milestone.doneOn)
                    : milestone.dueOn
                      ? `${shortDate(milestone.dueOn)}${late || soon ? ` · ${away}d` : ''}`
                      : '—'}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDelete(milestone.id)}
                  aria-label="Remove milestone"
                  className="shrink-0 px-1 font-mono text-[11px] text-ink-4"
                >
                  ×
                </button>
              </>
            )}
          </div>
        )
      })}

      {next?.dueOn ? (
        <p className="mt-0.5 font-mono text-[10px] tracking-[0.08em] text-ink-3">
          NEXT · {next.title.toUpperCase()} · {shortDate(next.dueOn)}
        </p>
      ) : null}

      <form
        className="mt-1 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          onAdd(title, dueOn)
          setTitle('')
          setDueOn('')
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a milestone"
          className="min-w-0 flex-1 border border-dashed border-rule bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-ink-4"
        />
        <input
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          className="tnum shrink-0 border border-dashed border-rule bg-transparent px-1.5 py-1 text-[12px] outline-none"
        />
        <button
          type="submit"
          disabled={disabled || !title.trim()}
          className="shrink-0 border border-rule px-2.5 py-1 text-[12px] text-ink-2 disabled:opacity-30"
        >
          Add
        </button>
      </form>
    </div>
  )
}

export default function GoalsClient({ initial }: { initial: GoalsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [planning, setPlanning] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>(initial.categories[0]?.slug ?? '')
  const [pending, startTransition] = useTransition()

  // Fixed for the life of the mount: the periods and the day the browser is in.
  const periods = useMemo(() => localPeriods(), [])
  const today = useMemo(() => ymd(new Date()), [])

  const dispatch = useCallback((work: () => Promise<GoalsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
    })
  }, [])

  // The server rendered against its own guess at the week. Correct it.
  useEffect(() => {
    dispatch(() => loadGoalsAction(periods))
  }, [dispatch, periods])

  const current = view.categories.find((c) => c.slug === selected)
  const goalTitle = (id: string | null) =>
    id ? (view.goals.find((g) => g.id === id)?.title ?? 'archived goal') : 'no goal'

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10">
      <header>
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">GOALS &amp; PRIORITIES</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-4">
          <h1 className="text-[27px] font-semibold tracking-tight">Five goals, ranked by hand</h1>
          <p className="max-w-[560px] text-[13px] text-ink-3">
            The rank is a declaration. The hours are a measurement. The scoreboard is neither — it
            is the commitment you said you would keep, ticked off by hand.
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
              THIS PERIOD · LAST 4 · HOURS
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
              <div key={goal.id} className="border border-rule-2">
                <div className="flex flex-wrap items-center gap-3.5 p-3">
                  <div className="flex shrink-0 flex-col gap-[3px]">
                    <button
                      type="button"
                      disabled={pending || index === 0}
                      onClick={() => dispatch(() => moveGoalAction(periods, goal.id, 'up'))}
                      className="h-[22px] w-[26px] border border-rule bg-surface text-[11px] leading-none text-ink-2 disabled:text-rule"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={pending || index === view.goals.length - 1}
                      onClick={() => dispatch(() => moveGoalAction(periods, goal.id, 'down'))}
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
                          dispatch(() => renameGoalAction(periods, goal.id, editTitle))
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {cadence(goal) ? (
                        <span className="border border-rule-2 bg-ground px-[7px] py-[3px] font-mono text-[10px] text-ink-2">
                          {cadence(goal)}
                        </span>
                      ) : (
                        <span className="border border-dashed border-rule-2 px-[7px] py-[3px] text-[11px] text-ink-4">
                          no lead measure
                        </span>
                      )}
                      {goal.missedTwice ? (
                        <span className="border border-drain-ink px-[7px] py-[3px] font-mono text-[10px] text-drain-ink">
                          MISSED TWICE
                        </span>
                      ) : null}
                      {goal.categories.map((c) => (
                        <span
                          key={c.slug}
                          className="border border-rule-2 bg-ground px-[7px] py-[3px] text-[11px] text-ink-2"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <Scoreboard
                    goal={goal}
                    disabled={pending}
                    onChange={(done) =>
                      dispatch(() =>
                        setProgressAction(
                          periods,
                          goal.id,
                          goal.targetPeriod === 'month' ? periods.month : periods.week,
                          done
                        )
                      )
                    }
                  />

                  <History goal={goal} />

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
                    onClick={() => setExpanded(expanded === goal.id ? null : goal.id)}
                    aria-expanded={expanded === goal.id}
                    className="shrink-0 border border-rule px-2.5 py-1.5 font-mono text-[9px] tracking-[0.1em] text-ink-3"
                  >
                    {expanded === goal.id ? 'CLOSE' : 'PLAN'}
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => dispatch(() => archiveGoalAction(periods, goal.id))}
                    className="shrink-0 border border-rule px-2.5 py-1.5 font-mono text-[9px] tracking-[0.1em] text-ink-3 disabled:opacity-40"
                  >
                    ARCHIVE
                  </button>
                </div>

                {expanded === goal.id ? (
                  <div className="grid gap-5 border-t border-rule-2 bg-ground p-4 md:grid-cols-2">
                    <div className="flex flex-col gap-3">
                      {planning === goal.id ? (
                        <PlanForm
                          goal={goal}
                          disabled={pending}
                          onCancel={() => setPlanning(null)}
                          onSave={(plan) => {
                            dispatch(() => setGoalPlanAction(periods, goal.id, plan))
                            setPlanning(null)
                          }}
                        />
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between">
                            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                              LEAD MEASURE
                            </div>
                            <button
                              type="button"
                              onClick={() => setPlanning(goal.id)}
                              className="font-mono text-[9px] tracking-[0.1em] text-ink-3 underline"
                            >
                              EDIT
                            </button>
                          </div>
                          <p className="text-[13px] leading-relaxed text-ink">
                            {goal.leadMeasure ?? (
                              <span className="text-ink-4">
                                Not written yet. The goal is the direction; this is the system that
                                is supposed to move it.
                              </span>
                            )}
                          </p>
                          {goal.twoMinute ? (
                            <p className="text-[12px] leading-relaxed text-ink-2">
                              <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                                TWO-MINUTE ·
                              </span>{' '}
                              {goal.twoMinute}
                            </p>
                          ) : null}
                          {goal.obstacle ? (
                            <p className="text-[12px] leading-relaxed text-ink-2">
                              <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
                                OBSTACLE ·
                              </span>{' '}
                              {goal.obstacle}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 border-t border-rule-2 pt-3">
                            <History goal={goal} />
                            <span className="font-mono text-[10px] tracking-[0.08em] text-ink-3">
                              LAST 4 {goal.targetPeriod === 'month' ? 'MONTHS' : 'WEEKS'}
                              {goal.missedTwice ? ' · TWICE IS THE LINE' : ''}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <Milestones
                      goal={goal}
                      disabled={pending}
                      onAdd={(title, dueOn) =>
                        dispatch(() => addMilestoneAction(periods, goal.id, title, dueOn))
                      }
                      onUpdate={(id, title, dueOn) =>
                        dispatch(() => updateMilestoneAction(periods, id, title, dueOn))
                      }
                      onToggle={(id, done) =>
                        dispatch(() => setMilestoneDoneAction(periods, id, done, today))
                      }
                      onDelete={(id) => dispatch(() => deleteMilestoneAction(periods, id))}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!draft.trim() || view.atCap) return
              dispatch(() => createGoalAction(periods, draft))
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
            The scoreboard counts sessions, not hours, and you type it in — whether Sunday’s
            conversation actually happened is a judgement no block in the log can make. Quarter,
            year and five-year horizons already exist in the data, and a goal can hang off a parent.
            Neither is on screen until there are four weeks of energy data to hang them on.
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
                    onClick={() =>
                      dispatch(() => setCategoryGoalAction(periods, current.slug, goal.id))
                    }
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
                  onClick={() => dispatch(() => setCategoryGoalAction(periods, current.slug, null))}
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
            here does not rewrite blocks already logged. The hours are context for the scoreboard,
            never a score: mapped or not, they cannot say whether a goal moved.
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
