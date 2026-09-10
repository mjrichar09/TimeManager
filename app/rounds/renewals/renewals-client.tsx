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
  urgent: 'border-drain-ink bg-drain-fill',
  overdue: 'border-drain-ink bg-drain-ink text-surface',
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
    <div className="mt-3 border border-rule-strong bg-surface p-4">
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
    <div key={renewal.id} className={`border p-3.5 ${STAGE_STYLE[renewal.stage]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-medium tracking-tight">{renewal.name}</span>
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
        <span className="tnum ml-auto font-mono text-[19px] font-medium tracking-tight">
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
            className={`border px-3 py-1.5 text-[13px] ${
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
            className={`border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
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
              className={`border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
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
            className={`border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] ${
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

  return (
    <main className="mt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-semibold tracking-tight">Renewals</h1>
          <p className="mt-1 max-w-[560px] text-[13px] text-ink-3">
            Dated things you can’t do early and can’t afford to miss. Unlike a chore,
            the date is fixed from outside — so renewing early doesn’t move it.
          </p>
        </div>
        {!adding && !editing ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setDraft(blankDraft)
            }}
            className="border border-ink bg-ink px-3.5 py-2 text-[13px] text-surface"
          >
            Add a renewal
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {adding && !editing ? form : null}

      {view.renewals.length === 0 && !adding ? (
        <div className="mt-6 border border-dashed border-rule px-5 py-8 text-center">
          <p className="text-sm text-ink-3">Nothing tracked yet. The usual suspects:</p>
          <p className="mt-2 text-sm text-ink-2">{SUGGESTIONS.join(' · ')}</p>
        </div>
      ) : null}

      {speaking.length > 0 ? (
        <section className="mt-6">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
            NEEDS ATTENTION
          </div>
          <div className="mt-2.5 flex flex-col gap-2">{speaking.map(row)}</div>
        </section>
      ) : null}

      {quiet.length > 0 ? (
        <section className="mt-7">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4">
            NOT YET — {quiet.length} TRACKED, ALL BEYOND THEIR WARNING
          </div>
          <div className="mt-2.5 flex flex-col gap-2">{quiet.map(row)}</div>
        </section>
      ) : null}
    </main>
  )
}
