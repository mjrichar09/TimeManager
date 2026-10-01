'use client'

import { useCallback, useState, useTransition } from 'react'
import type { Renewal, RenewalStage, RenewalsView } from '@/lib/renewals'
import { addMonths } from '@/lib/renewals'
import { longDateWithYear } from '../format'
import {
  archiveRenewalAction,
  completeRenewalAction,
  createRenewalAction,
  updateRenewalAction,
  undoRenewalAction,
  type RenewalsResult,
} from './actions'

/**
 * Renewals — the dated obligations you cannot do early.
 *
 * Sorted by due date and never by category, because the only question this
 * screen answers is "what is coming". Grouping by category would bury a passport
 * two months out underneath four vehicle items that are fine.
 */

/** Cycles worth naming, so the common cases are one tap rather than arithmetic. */
const PERIODS: Array<{ label: string; months: number | null }> = [
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
  { label: '4 years', months: 48 },
  { label: '5 years', months: 60 },
  { label: '8 years', months: 96 },
  { label: '10 years', months: 120 },
  { label: 'Irregular', months: null },
]

/** The examples that prompted this screen, offered as a starting point. */
const SUGGESTIONS = [
  'Car inspection',
  'Registration renewal',
  'Insurance renewal',
  'Global Entry',
  'Passport',
  'Driver’s licence',
]

const STAGE_STYLE: Record<RenewalStage, string> = {
  later: 'border-rule bg-surface',
  lead: 'border-rule-strong bg-surface',
  urgent: 'border-drain bg-drain-fill',
  overdue: 'border-drain-ink bg-drain-ink text-surface',
}

const DAY = 86_400_000

/** Whole days from one YYYY-MM-DD to another. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
}

/**
 * The coming year on one line.
 *
 * Renewals are dated from outside, so what matters is where they fall against
 * each other and against today: two inspections a month apart are one errand
 * if you see them together. Each warning window is hatched, so you can see
 * when the app will start asking.
 */
function YearLine({ renewals, today }: { renewals: Renewal[]; today: string }) {
  const ROW = 28
  const start = new Date(today + 'T00:00:00Z')
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
    return d
  })
  const first = months[0].getTime()
  const end = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 1)
  // Position by real elapsed time, so a 30-day window is the same height in
  // February as it is in March.
  const y = (iso: string) => ((Date.parse(iso + 'T00:00:00Z') - first) / (end - first)) * ROW * 12
  const inYear = renewals.filter((r) => Date.parse(r.dueOn + 'T00:00:00Z') < end)

  return (
    <div className="relative mt-3" style={{ height: ROW * 12 }}>
      {months.map((m, i) => (
        <div key={i} className="absolute inset-x-0 flex items-center gap-3" style={{ top: i * ROW, height: ROW }}>
          <span className="w-9 font-mono text-[10px] font-medium tracking-[0.06em] text-ink-3">
            {m.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}
          </span>
          <span className="h-px flex-1 bg-rule-2" />
        </div>
      ))}

      <span className="absolute right-0 left-12 h-[2px] bg-charge" style={{ top: y(today) }}>
        <span className="label absolute -top-[13px] right-0 text-charge">Today</span>
      </span>

      {inYear.map((r) => {
        const warnFrom = Math.max(y(today), y(r.dueOn) - (r.leadDays / 365) * ROW * 12)
        return (
          <span key={r.id}>
            <span
              className="gap-hatch absolute right-0 left-12 rounded-[4px]"
              style={{ top: warnFrom, height: Math.max(3, y(r.dueOn) - warnFrom) }}
            />
            <span className="absolute right-0 left-12 flex items-center gap-2" style={{ top: y(r.dueOn) - 8 }}>
              <span
                className={`ml-2 size-[10px] shrink-0 rounded-full ring-[3px] ring-ground ${
                  r.stage === 'overdue' || r.stage === 'urgent' ? 'bg-drain' : 'bg-ink'
                }`}
              />
              <span className="truncate bg-ground pr-1.5 text-[12.5px] font-medium">{r.name}</span>
              <span className="tnum font-mono text-[10px] text-ink-3">
                {new Date(r.dueOn + 'T00:00:00Z').toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

const STAGE_LABEL: Record<RenewalStage, string> = {
  later: '',
  lead: 'COMING UP',
  urgent: 'SOON',
  overdue: 'EXPIRED',
}

function countdown(daysUntil: number): string {
  if (daysUntil < 0) {
    const n = -daysUntil
    return `${n} day${n === 1 ? '' : 's'} ago`
  }
  if (daysUntil === 0) return 'Today'
  if (daysUntil === 1) return 'Tomorrow'
  if (daysUntil < 60) return `${daysUntil} days`
  const months = Math.round(daysUntil / 30.44)
  if (months < 24) return `${months} months`
  return `${Math.floor(daysUntil / 365.25)}y ${Math.round((daysUntil % 365.25) / 30.44)}m`
}

function periodLabel(months: number | null): string {
  if (months === null) return 'Irregular'
  return PERIODS.find((p) => p.months === months)?.label ?? `${months} months`
}

const blankDraft = {
  name: '',
  category: '',
  dueOn: '',
  periodMonths: 12 as number | null,
  leadDays: 30,
  effortMinutes: 30,
  notes: '',
}

export default function RenewalsClient({ initial }: { initial: RenewalsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [draft, setDraft] = useState(blankDraft)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [renewing, setRenewing] = useState<string | null>(null)
  const [renewDue, setRenewDue] = useState('')

  const dispatch = useCallback((work: () => Promise<RenewalsResult>, onSuccess?: () => void) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
      if (result.ok) onSuccess?.()
    })
  }, [])

  const submitDraft = () => {
    const input = {
      name: draft.name,
      category: draft.category.trim() || null,
      dueOn: draft.dueOn,
      periodMonths: draft.periodMonths,
      leadDays: draft.leadDays,
      effortMinutes: draft.effortMinutes,
      notes: draft.notes.trim() || null,
    }
    if (editing) {
      dispatch(() => updateRenewalAction(editing, input), () => {
        setEditing(null)
        setDraft(blankDraft)
      })
    } else {
      dispatch(() => createRenewalAction(input), () => {
        setAdding(false)
        setDraft(blankDraft)
      })
    }
  }

  const beginEdit = (renewal: Renewal) => {
    setEditing(renewal.id)
    setAdding(false)
    setRenewing(null)
    setDraft({
      name: renewal.name,
      category: renewal.category ?? '',
      dueOn: renewal.dueOn,
      periodMonths: renewal.periodMonths,
      leadDays: renewal.leadDays,
      effortMinutes: renewal.effortMinutes,
      notes: renewal.notes ?? '',
    })
  }

  const beginRenew = (renewal: Renewal) => {
    setRenewing(renewal.id)
    setEditing(null)
    // Pre-fill from the OLD due date, not from today — renewing early does not
    // move the cycle, and the field is here for when the paperwork disagrees.
    setRenewDue(
      renewal.periodMonths === null ? '' : addMonths(renewal.dueOn, renewal.periodMonths)
    )
  }

  const speaking = view.renewals.filter((r) => r.stage !== 'later')
  const quiet = view.renewals.filter((r) => r.stage === 'later')

  const form = (
    <div className="mt-3 rounded-2xl border border-rule-strong bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">NAME</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Passport"
            className="mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 text-sm outline-none focus:border-rule-strong"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            CATEGORY — OPTIONAL
          </span>
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            placeholder="identity"
            className="mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 text-sm outline-none focus:border-rule-strong"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">EXPIRES ON</span>
          <input
            type="date"
            value={draft.dueOn}
            onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })}
            className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 font-mono text-sm outline-none focus:border-rule-strong"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            WARN ME THIS MANY DAYS AHEAD
          </span>
          <input
            type="number"
            min={1}
            max={730}
            value={draft.leadDays}
            onChange={(e) => setDraft({ ...draft, leadDays: Number(e.target.value) })}
            className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 font-mono text-sm outline-none focus:border-rule-strong"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            MINUTES IT TAKES
          </span>
          <input
            type="number"
            min={1}
            max={600}
            value={draft.effortMinutes}
            onChange={(e) => setDraft({ ...draft, effortMinutes: Number(e.target.value) })}
            className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 font-mono text-sm outline-none focus:border-rule-strong"
          />
          <span className="mt-1 block text-[11px] leading-snug text-ink-3">
            What the weekly planner budgets against once this enters its window.
          </span>
        </label>
      </div>

      <div className="mt-3 font-mono text-[9px] tracking-[0.12em] text-ink-3">CYCLE</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setDraft({ ...draft, periodMonths: p.months })}
            className={`border px-2.5 py-1.5 text-xs ${
              draft.periodMonths === p.months
                ? 'border-ink bg-ink text-surface'
                : 'border-rule bg-surface text-ink-2'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="font-mono text-[9px] tracking-[0.12em] text-ink-3">NOTES — OPTIONAL</span>
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Renew online, needs the old card"
          className="mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 text-sm outline-none focus:border-rule-strong"
        />
      </label>

      <div className="mt-3.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setAdding(false)
            setEditing(null)
            setDraft(blankDraft)
          }}
          className="border border-rule-strong px-3.5 py-2 text-[13px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !draft.name.trim() || !draft.dueOn}
          onClick={submitDraft}
          className="border border-ink bg-ink px-3.5 py-2 text-[13px] text-surface disabled:opacity-30"
        >
          {editing ? 'Save' : 'Add renewal'}
        </button>
      </div>
    </div>
  )

  const row = (renewal: Renewal) => (
    <div key={renewal.id} className={`rounded-2xl border p-4 ${STAGE_STYLE[renewal.stage]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold">{renewal.name}</span>
        {renewal.category ? (
          <span
            className={`font-mono text-[9px] tracking-[0.12em] ${
              renewal.stage === 'overdue' ? 'text-surface/60' : 'text-ink-4'
            }`}
          >
            {renewal.category.toUpperCase()}
          </span>
        ) : null}
        {STAGE_LABEL[renewal.stage] ? (
          <span
            className={`font-mono text-[9px] tracking-[0.12em] ${
              renewal.stage === 'overdue' ? 'text-surface' : 'text-drain-ink'
            }`}
          >
            {STAGE_LABEL[renewal.stage]}
          </span>
        ) : null}
        <span className="tnum ml-auto font-display text-[22px] font-medium">
          {countdown(renewal.daysUntil)}
        </span>
      </div>

      <div
        className={`tnum mt-1 font-mono text-[11px] ${
          renewal.stage === 'overdue' ? 'text-surface/70' : 'text-ink-3'
        }`}
      >
        {longDateWithYear(renewal.dueOn)} · {periodLabel(renewal.periodMonths)} · warns{' '}
        {renewal.leadDays}d ahead · {renewal.effortMinutes}m
      </div>

      {renewal.notes ? (
        <div
          className={`mt-1.5 text-[13px] ${
            renewal.stage === 'overdue' ? 'text-surface/80' : 'text-ink-2'
          }`}
        >
          {renewal.notes}
        </div>
      ) : null}

      {renewing === renewal.id ? (
        <div className="mt-3 border-t border-rule-2 pt-3">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            NEW EXPIRY — FROM THE PAPERWORK, NOT FROM TODAY
          </div>
          <input
            type="date"
            value={renewDue}
            onChange={(e) => setRenewDue(e.target.value)}
            className="tnum mt-1.5 w-full border border-rule bg-surface px-2.5 py-2 font-mono text-sm outline-none focus:border-rule-strong sm:w-56"
          />
          <p className="mt-1.5 max-w-[520px] text-[11px] leading-snug text-ink-3">
            Pre-filled from the old expiry plus the cycle, because renewing early
            doesn’t buy you time — the new date runs from the old one. Change it if
            the document says otherwise.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => setRenewing(null)}
              className="border border-rule-strong bg-surface px-3.5 py-2 text-[13px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !renewDue}
              onClick={() =>
                dispatch(
                  () => completeRenewalAction(renewal.id, view.today, renewDue, null),
                  () => setRenewing(null)
                )
              }
              className="border border-ink bg-ink px-3.5 py-2 text-[13px] text-surface disabled:opacity-30"
            >
              Renewed
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => beginRenew(renewal)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] ${
              renewal.stage === 'overdue'
                ? 'border-surface bg-surface text-ink'
                : 'border-ink bg-ink text-surface'
            } disabled:opacity-40`}
          >
            Mark renewed
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => beginEdit(renewal)}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
              renewal.stage === 'overdue'
                ? 'border-surface/40 text-surface'
                : 'border-rule text-ink-3'
            } disabled:opacity-40`}
          >
            EDIT
          </button>
          {renewal.lastCompletedOn ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => dispatch(() => undoRenewalAction(renewal.id))}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
                renewal.stage === 'overdue'
                  ? 'border-surface/40 text-surface'
                  : 'border-rule text-ink-3'
              } disabled:opacity-40`}
            >
              UNDO LAST
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => dispatch(() => archiveRenewalAction(renewal.id))}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
              renewal.stage === 'overdue'
                ? 'border-surface/40 text-surface'
                : 'border-rule text-ink-3'
            } disabled:opacity-40`}
          >
            ARCHIVE
          </button>
        </div>
      )}

      {editing === renewal.id ? form : null}
    </div>
  )

  const next = view.renewals.find((r) => r.daysUntil >= 0) ?? view.renewals[0]

  return (
    <main className="mx-auto max-w-[560px] pt-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Rounds</div>
          <h1 className="font-display text-[30px] leading-[1.05] font-semibold">Renewals</h1>
        </div>
        {!adding && !editing ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setDraft(blankDraft)
            }}
            className="rounded-lg border border-rule px-3.5 py-2 text-[13px] font-medium hover:border-rule-strong"
          >
            Add a renewal
          </button>
        ) : null}
      </header>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Dated from outside, so renewing early doesn&rsquo;t move the date.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {adding && !editing ? form : null}

      {view.renewals.length === 0 && !adding ? (
        <div className="mt-6 rounded-2xl border border-dashed border-rule px-5 py-8 text-center">
          <p className="text-sm text-ink-3">Nothing tracked yet. The usual suspects:</p>
          <p className="mt-2 text-sm text-ink-2">{SUGGESTIONS.join(' · ')}</p>
        </div>
      ) : null}

      {next && !editing && renewing !== next.id ? (
        <section className="mt-5 rounded-2xl border border-rule bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Next{next.category ? ` · ${next.category}` : ''}</span>
            <span className="tnum font-mono text-[10.5px] text-ink-3">{longDateWithYear(next.dueOn)}</span>
          </div>
          <div className="mt-1 font-display text-[18px] font-semibold">{next.name}</div>
          <div className="tnum mt-1 font-display text-[44px] leading-none font-medium">
            {Math.abs(daysBetween(view.today, next.dueOn))}
            <span className="ml-1.5 text-[15px] text-ink-3">
              {next.daysUntil < 0 ? 'days expired' : 'days'}
            </span>
          </div>
          <div className="tnum mt-1.5 font-mono text-[10.5px] text-ink-3">
            {periodLabel(next.periodMonths)} · warns {next.leadDays}d ahead · {next.effortMinutes}m
          </div>
          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => beginRenew(next)}
              className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-surface disabled:opacity-40"
            >
              Mark renewed
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => beginEdit(next)}
              className="rounded-lg border border-rule px-3.5 py-2 text-[13px] font-medium disabled:opacity-40"
            >
              Edit
            </button>
          </div>
        </section>
      ) : null}

      {view.renewals.length > 0 ? (
        <section className="mt-6">
          <div className="border-b border-rule pb-2">
            <span className="label">The next twelve months</span>
          </div>
          <YearLine renewals={view.renewals} today={view.today} />
        </section>
      ) : null}

      {speaking.length > 0 ? (
        <section className="mt-7">
          <div className="label">Needs attention</div>
          <div className="mt-2.5 flex flex-col gap-2">{speaking.map(row)}</div>
        </section>
      ) : null}

      {quiet.length > 0 ? (
        <section className="mt-7">
          <div className="label">All tracked · {quiet.length} beyond their warning</div>
          <div className="mt-2.5 flex flex-col gap-2">{quiet.map(row)}</div>
        </section>
      ) : null}
    </main>
  )
}
