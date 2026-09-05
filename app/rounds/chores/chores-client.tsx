'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import type { Chore, ChoreInput, RoundsView } from '@/lib/rounds'
import { dayNumber } from '@/lib/rounds-plan'
import {
  archiveChoreAction,
  completeChoreAction,
  createChoreAction,
  updateChoreAction,
  type RoundsResult,
} from '../actions'
import { dueLabel, intervalLabel, minutesLabel, relativeDate } from '../format'

const BLANK: ChoreInput = {
  name: '',
  area: null,
  intervalDays: 14,
  effortMinutes: 15,
  preferWeekend: false,
  notes: null,
  lastDoneOn: null,
}

/** The form used for both adding and editing — the fields are the same either way. */
function ChoreForm({
  id,
  value,
  areas,
  submitLabel,
  showLastDone,
  disabled,
  onChange,
  onSubmit,
  onCancel,
}: {
  /** Unique per rendered form: an open add form and an open edit row coexist. */
  id: string
  value: ChoreInput
  areas: string[]
  submitLabel: string
  showLastDone: boolean
  disabled: boolean
  onChange: (next: ChoreInput) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  const field = 'w-full border border-rule bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-rule-strong'
  const label = 'font-mono text-[9px] tracking-[0.12em] text-ink-3'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="grid grid-cols-2 gap-3 md:grid-cols-6"
    >
      <div className="col-span-2">
        <label className={label} htmlFor={`${id}-name`}>
          NAME
        </label>
        <input
          id={`${id}-name`}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className={`mt-1 ${field}`}
        />
      </div>

      <div>
        <label className={label} htmlFor={`${id}-area`}>
          AREA
        </label>
        <input
          id={`${id}-area`}
          list={`${id}-areas`}
          value={value.area ?? ''}
          onChange={(e) => onChange({ ...value, area: e.target.value || null })}
          className={`mt-1 ${field}`}
        />
        <datalist id={`${id}-areas`}>
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>

      <div>
        <label className={label} htmlFor={`${id}-interval`}>
          EVERY (DAYS)
        </label>
        <input
          id={`${id}-interval`}
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          value={value.intervalDays}
          onChange={(e) => onChange({ ...value, intervalDays: Number(e.target.value) })}
          className={`tnum mt-1 ${field}`}
        />
      </div>

      <div>
        <label className={label} htmlFor={`${id}-effort`}>
          TAKES (MIN)
        </label>
        <input
          id={`${id}-effort`}
          type="number"
          inputMode="numeric"
          min={1}
          max={480}
          value={value.effortMinutes}
          onChange={(e) => onChange({ ...value, effortMinutes: Number(e.target.value) })}
          className={`tnum mt-1 ${field}`}
        />
      </div>

      {showLastDone ? (
        <div>
          <label className={label} htmlFor={`${id}-last`}>
            LAST DONE
          </label>
          <input
            id={`${id}-last`}
            type="date"
            value={value.lastDoneOn ?? ''}
            onChange={(e) => onChange({ ...value, lastDoneOn: e.target.value || null })}
            className={`mt-1 ${field}`}
          />
        </div>
      ) : null}

      <div className="col-span-2 flex items-end justify-between gap-3 md:col-span-6">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={value.preferWeekend}
            onChange={(e) => onChange({ ...value, preferWeekend: e.target.checked })}
          />
          Prefers the weekend
        </label>

        <div className="flex gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="border border-rule px-3 py-2 text-[13px] text-ink-2"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={disabled}
            className="border border-ink bg-ink px-4 py-2 text-[13px] text-surface disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}

export default function ChoresClient({ initial }: { initial: RoundsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ChoreInput>(BLANK)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<ChoreInput>(BLANK)
  const [pending, startTransition] = useTransition()

  const dispatch = useCallback((work: () => Promise<RoundsResult>, after?: () => void) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
      if (result.ok) after?.()
    })
  }, [])

  const areas = useMemo(
    () => [...new Set(view.chores.map((c) => c.area).filter((a): a is string => !!a))].sort(),
    [view.chores]
  )

  // Grouped by area, most pressing first inside each group. An unfiled chore
  // lands in "Other" rather than being hidden.
  const groups = useMemo(() => {
    const map = new Map<string, Chore[]>()
    for (const chore of view.chores) {
      const key = chore.area ?? 'Other'
      const list = map.get(key)
      if (list) list.push(chore)
      else map.set(key, [chore])
    }
    for (const list of map.values()) {
      list.sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [view.chores])

  const beginEdit = (chore: Chore) => {
    setEditing(chore.id)
    setEdit({
      name: chore.name,
      area: chore.area,
      intervalDays: chore.intervalDays,
      effortMinutes: chore.effortMinutes,
      preferWeekend: chore.preferWeekend,
      notes: chore.notes,
    })
  }

  return (
    <main className="pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-[27px] font-semibold tracking-tight">
            {view.chores.length} chores
          </h1>
          <p className="text-[13px] text-ink-3">
            An interval you keep skipping is too short. One that always arrives after you have
            already noticed the mess is too long.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setAddOpen((open) => !open)
            setDraft(BLANK)
          }}
          className="border border-ink bg-ink px-4 py-2 text-[13px] text-surface"
        >
          {addOpen ? 'Close' : 'Add a chore'}
        </button>
      </div>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      {addOpen ? (
        <section className="mt-5 border border-rule bg-surface p-5">
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">NEW CHORE</div>
          <div className="mt-3">
            <ChoreForm
              id="new-chore"
              value={draft}
              areas={areas}
              submitLabel="Add"
              showLastDone
              disabled={pending}
              onChange={setDraft}
              onSubmit={() =>
                dispatch(
                  () => createChoreAction(draft),
                  () => {
                    setDraft(BLANK)
                    setAddOpen(false)
                  }
                )
              }
              onCancel={() => setAddOpen(false)}
            />
          </div>
        </section>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {groups.map(([area, list]) => (
          <section key={area} className="border border-rule bg-surface p-5">
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
              {area.toUpperCase()}
            </div>

            <div className="mt-3 flex flex-col">
              {list.map((chore) =>
                editing === chore.id ? (
                  <div key={chore.id} className="border border-rule-strong p-3">
                    <ChoreForm
                      id={`edit-${chore.id}`}
                      value={edit}
                      areas={areas}
                      submitLabel="Save"
                      showLastDone={false}
                      disabled={pending}
                      onChange={setEdit}
                      onSubmit={() =>
                        dispatch(
                          () => updateChoreAction(chore.id, edit),
                          () => setEditing(null)
                        )
                      }
                      onCancel={() => setEditing(null)}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        dispatch(
                          () => archiveChoreAction(chore.id),
                          () => setEditing(null)
                        )
                      }
                      className="mt-3 font-mono text-[10px] tracking-[0.1em] text-ink-4 hover:text-drain-ink"
                    >
                      ARCHIVE THIS CHORE
                    </button>
                  </div>
                ) : (
                  <div
                    key={chore.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-2 py-2.5 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => beginEdit(chore)}
                      className="min-w-[150px] flex-1 text-left text-[15px] hover:underline"
                    >
                      {chore.name}
                    </button>

                    <span className="w-[110px] shrink-0 font-mono text-[11px] text-ink-3">
                      {intervalLabel(chore.intervalDays)}
                    </span>
                    <span className="tnum w-10 shrink-0 text-right font-mono text-[11px] text-ink-3">
                      {minutesLabel(chore.effortMinutes)}
                    </span>
                    <span className="tnum w-[92px] shrink-0 text-right font-mono text-[11px] text-ink-4">
                      {chore.lastDoneOn ? relativeDate(chore.lastDoneOn, view.today) : 'never'}
                    </span>
                    <span
                      className={`tnum w-[104px] shrink-0 px-1.5 py-0.5 text-right font-mono text-[10px] tracking-[0.08em] ${
                        chore.state === 'overdue'
                          ? 'bg-drain-fill text-drain-ink'
                          : chore.state === 'due'
                            ? 'bg-surface-2 text-ink-2'
                            : 'text-ink-4'
                      }`}
                    >
                      {dueLabel(chore.daysOverdue).toUpperCase()}
                    </span>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        dispatch(() => completeChoreAction(chore.id, view.today, view.weekStart))
                      }
                      className="shrink-0 border border-rule px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-2 hover:border-rule-strong disabled:opacity-40"
                    >
                      DID IT
                    </button>
                  </div>
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
