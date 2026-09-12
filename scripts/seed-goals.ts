import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * The five goals, ranked, from docs/goals.md (settled 2026-09-09).
 *
 * The A–E letters are the working record's names for them and stay in the
 * title on purpose: the rank is a declaration that can change, the letter is
 * how a goal is referred to in the doc and in conversation.
 *
 * No category mapping is seeded — step 7 was cut on 2026-09-10. Hours are not
 * progress for any of these, so the goals screen is a ranked list read beside
 * the week's hours, not a report of them.
 */
const GOALS = [
  { rank: 1, title: 'B — Disagreements end with a decision both of us understand' },
  { rank: 2, title: 'A — AllSquare earning $100/mo by January' },
  { rank: 3, title: 'C — Division of labour agreed, and bought back where it’s cheap' },
  { rank: 4, title: 'D — Still carrying L pain-free in 12 months' },
  { rank: 5, title: 'E — House reorganised, one named zone a month' },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  const existing = (await sql`
    select title from goals
    where user_id = ${user} and horizon = 'current' and status = 'active' and archived_at is null
  `) as Array<{ title: string }>

  // Titles are the only handle we have — the table has no natural key. Matching
  // on the leading letter keeps a re-run from duplicating a goal that has since
  // been reworded by hand.
  const taken = new Set(existing.map((g) => g.title.trim().slice(0, 1)))

  let inserted = 0
  for (const goal of GOALS) {
    if (taken.has(goal.title.slice(0, 1))) continue
    await sql`
      insert into goals (user_id, title, horizon, priority_rank, status)
      values (${user}, ${goal.title}, 'current', ${goal.rank}, 'active')
    `
    inserted++
  }

  console.log(
    inserted === 0
      ? `All ${GOALS.length} goals already present.`
      : `Seeded ${inserted} of ${GOALS.length} goals.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
