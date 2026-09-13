import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * The five goals, ranked, with their lead measures and milestones — all of it
 * transcribed from docs/goals.md, which stays the working record.
 *
 * The A–E letters are the record's names for them and stay in the title on
 * purpose: the rank is a declaration that can change, the letter is how a goal
 * is referred to in the doc and in conversation.
 *
 * Nothing here is invented. Where the doc has no lead measure (C), no
 * two-minute version (B, E) or no date (B's first conversation, D's referrals),
 * the field is left empty rather than filled with a plausible guess — a blank
 * on the screen is a question to answer, and a guess is one you never get asked.
 */
type Seed = {
  letter: string
  title: string
  rank: number
  leadMeasure?: string
  targetCount?: number
  targetPeriod?: 'week' | 'month'
  sessionMinutes?: number
  twoMinute?: string
  obstacle?: string
  milestones: Array<{ title: string; dueOn?: string }>
}

const GOALS: Seed[] = [
  {
    letter: 'B',
    title: 'B — Disagreements end with a decision both of us understand',
    rank: 1,
    leadMeasure:
      'Sunday 8pm, kids down, 30 minutes at the kitchen table, phones in the other room. One agenda: what needs deciding this week. Decisions written down.',
    targetCount: 1,
    targetPeriod: 'week',
    sessionMinutes: 30,
    obstacle:
      'Escalation happens in the moment, so the fix is a scheduled calm slot, not better in-the-moment behaviour. If it escalates, then: “can we put that on Sunday?” — a phrase that has to be agreed first.',
    milestones: [
      // No dates: the first conversation can't be scheduled unilaterally, which
      // is the whole difficulty with this goal and shouldn't be papered over
      // with a date nobody agreed to.
      { title: 'Ask for the Sunday slot — the first conversation' },
      { title: 'Agree the in-the-moment phrase' },
      { title: 'Four Sundays run in a row' },
    ],
  },
  {
    letter: 'A',
    title: 'A — AllSquare earning $100/mo by January',
    rank: 2,
    leadMeasure:
      '3 beta prospects contacted per week. Tuesday and Thursday, 30 minutes, first thing. At least one per week from a channel that could scale.',
    targetCount: 3,
    targetPeriod: 'week',
    sessionMinutes: 30,
    twoMinute: 'One message.',
    obstacle:
      'If the only prospects are friends, then the beta tests the product and not the channel — contact one realtor or broker before the week counts.',
    // Counting backwards from January per the doc — recruit 3–4 weeks, beta 4–6,
    // act and ship 4–6, first customers 4–8 — laid out from 2026-09-13 at the
    // optimistic end, because the slack in the pessimistic end is already gone.
    milestones: [
      { title: 'Prospect list drafted — realtors and brokers, not friends', dueOn: '2026-09-27' },
      { title: '3 realtors or brokers contacted', dueOn: '2026-10-04' },
      { title: 'Beta running', dueOn: '2026-11-01' },
      { title: 'Beta feedback acted on, paid release shipped', dueOn: '2026-11-29' },
      { title: 'First paying subscribers', dueOn: '2026-12-27' },
      { title: '$100/mo — about 11 subscribers at $9', dueOn: '2027-01-31' },
    ],
  },
  {
    letter: 'C',
    title: 'C — Division of labour agreed, and bought back where it’s cheap',
    rank: 3,
    // The doc: "pending. Likely an output of B's weekly meeting." Left blank.
    milestones: [
      { title: 'DRIP data lands — end of baseline week 4', dueOn: '2026-09-20' },
      { title: 'Eliminate pass — ask “should this exist?” before “who does it?”', dueOn: '2026-09-27' },
      { title: 'Buy-back conversation held', dueOn: '2026-09-27' },
      { title: 'Division of labour written down' },
    ],
  },
  {
    letter: 'D',
    title: 'D — Still carrying L pain-free in 12 months',
    rank: 4,
    leadMeasure:
      '3×/week, 15 minutes, before anyone’s up: hip mobility and posterior chain. A prescription from the doctor wins outright — don’t run both routines, or which one worked is unknowable.',
    targetCount: 3,
    targetPeriod: 'week',
    sessionMinutes: 15,
    twoMinute: 'Five minutes of hip work.',
    obstacle:
      'Never miss twice is a motivation rule. If a session is missed because of pain, then rest and note it — that is a symptom, not a lapse, and pushing through a flare is the wrong response.',
    milestones: [
      { title: 'GP seen — ask directly whether progressive loading is indicated' },
      { title: 'Imaging or physio referral, if indicated' },
      // The doc's sharpest point about D: one reading, a year out, is not a
      // feedback loop. This is the intermediate one.
      { title: 'Repeatable carry test recorded as a baseline', dueOn: '2026-09-27' },
      { title: 'Intermediate measure agreed — pain frequency or the carry test' },
    ],
  },
  {
    letter: 'E',
    title: 'E — House reorganised, one named zone a month',
    rank: 5,
    leadMeasure: 'Saturday 9–11, one zone.',
    targetCount: 1,
    targetPeriod: 'month',
    sessionMinutes: 120,
    milestones: [
      // "Zones to be named" — naming them is the first milestone, and the doc is
      // explicit that E won't happen unless it is time-boxed.
      { title: 'Name the zones, up front', dueOn: '2026-09-30' },
      { title: 'First zone done', dueOn: '2026-10-31' },
    ],
  },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  const existing = (await sql`
    select id, title, lead_measure, target_count, session_minutes
    from goals
    where user_id = ${user} and horizon = 'current' and status = 'active' and archived_at is null
  `) as Array<{
    id: string
    title: string
    lead_measure: string | null
    target_count: number | null
    session_minutes: number | null
  }>

  // Titles are the only handle we have — the table has no natural key. Matching
  // on the leading letter keeps a re-run from duplicating a goal that has since
  // been reworded by hand.
  const byLetter = new Map(existing.map((g) => [g.title.trim().slice(0, 1), g]))

  let inserted = 0
  let planned = 0
  let milestoned = 0

  for (const goal of GOALS) {
    let row = byLetter.get(goal.letter)

    if (!row) {
      const created = (await sql`
        insert into goals (user_id, title, horizon, priority_rank, status)
        values (${user}, ${goal.title}, 'current', ${goal.rank}, 'active')
        returning id, title, lead_measure, target_count, session_minutes
      `) as typeof existing
      row = created[0]
      inserted++
    }

    // Only fill a plan that is entirely empty. Anything edited on the screen
    // wins over the transcription — the app is where this lives now.
    const untouched =
      row.lead_measure === null && row.target_count === null && row.session_minutes === null
    if (untouched && (goal.leadMeasure || goal.targetCount)) {
      await sql`
        update goals set
          lead_measure    = ${goal.leadMeasure ?? null},
          target_count    = ${goal.targetCount ?? null},
          target_period   = ${goal.targetPeriod ?? 'week'},
          session_minutes = ${goal.sessionMinutes ?? null},
          two_minute      = ${goal.twoMinute ?? null},
          obstacle        = ${goal.obstacle ?? null}
        where id = ${row.id} and user_id = ${user}
      `
      planned++
    }

    const already = (await sql`
      select count(*)::int as n from goal_milestones
      where user_id = ${user} and goal_id = ${row.id}
    `) as Array<{ n: number }>

    // All or nothing per goal: a goal with milestones has been worked on, and
    // topping it up from the transcript would resurrect ones deleted on purpose.
    if (already[0].n === 0) {
      for (const [index, milestone] of goal.milestones.entries()) {
        await sql`
          insert into goal_milestones (user_id, goal_id, title, due_on, sort_order)
          values (${user}, ${row.id}, ${milestone.title}, ${milestone.dueOn ?? null}, ${index})
        `
        milestoned++
      }
    }
  }

  console.log(
    `Goals: ${inserted === 0 ? 'all present' : `${inserted} inserted`}. ` +
      `Lead measures written: ${planned}. Milestones added: ${milestoned}.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
