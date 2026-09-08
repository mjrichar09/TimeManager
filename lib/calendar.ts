import { getSql, userId } from './db'

/**
 * How far a day got.
 *
 *   'open'     — no daily_check row at all. The day was never closed out.
 *   'complete' — the row exists, so reconcile marked the day complete, but the
 *                two questions are still unanswered.
 *   'checked'  — reconciled *and* checked. Nothing left to do to it.
 *
 * The three states come straight from the daily_check row and nothing else:
 * "complete" is what `completeDay` writes and "checked" is what `saveCheck`
 * fills in, so the calendar can only ever show what those two screens did.
 */
export type DayState = 'open' | 'complete' | 'checked'

/** Days that got past 'open', keyed by YYYY-MM-DD. Everything else is open. */
export type DayStates = Record<string, 'complete' | 'checked'>

/**
 * Every day this user has closed, ever.
 *
 * Unbounded on purpose. A month-at-a-time query would need the server to know
 * which month the browser is showing, and the server can't know that: Tally
 * derives days from the browser's local midnight (see `localWindow` in
 * reconcile), so any month the server picked would be wrong for someone in a
 * different zone near a boundary. Fetching the lot instead lets the calendar
 * page through months with no further round trips, and the cost is trivial —
 * one narrow row per day the app has been used, a decade under 4,000 of them.
 */
export async function getDayStates(): Promise<DayStates> {
  const sql = getSql()
  const rows = (await sql`
    select date::text as date, energy, moved_priority
    from daily_check
    where user_id = ${userId()}
    order by date
  `) as Array<{ date: string; energy: number | null; moved_priority: boolean | null }>

  const states: DayStates = {}
  for (const row of rows) {
    // Both answers, or it is still only complete. `saveCheck` writes them
    // together and the check screen won't submit until both are set, so a row
    // with one of them is old or hand-edited data — treat it as unfinished.
    states[row.date] =
      row.energy !== null && row.moved_priority !== null ? 'checked' : 'complete'
  }
  return states
}
