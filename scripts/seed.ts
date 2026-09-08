import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

// Starter categories from build-plan §3.
//
// The energy and value ratings here are a STARTING POINT, not a measurement.
// Set them properly in week 1 and then resist re-tuning them — you are measuring
// the world, not the instrument (build-plan §8).
//
// energy:     -1 drain, 0 neutral, +1 charge
// value_tier:  0 none, 1 low, 2 med, 3 high
// buyback:     est. $/hr to outsource; null = can't be bought
const CATEGORIES = [
  { slug: 'deep-work',         name: 'Deep work',        energy: 1,  value: 3, buyback: null, quick: true },
  { slug: 'meetings',          name: 'Meetings',         energy: -1, value: 2, buyback: null, quick: true },
  { slug: 'email-admin',       name: 'Email / admin',    energy: -1, value: 1, buyback: 28,   quick: true },
  { slug: 'kids-active',       name: 'Kids — active',    energy: 1,  value: 3, buyback: null, quick: true },
  { slug: 'household-chores',  name: 'Household chores', energy: -1, value: 0, buyback: 32,   quick: true },
  { slug: 'media-scroll',      name: 'Media / scroll',   energy: -1, value: 0, buyback: null, quick: true },
  { slug: 'commute',           name: 'Commute',          energy: -1, value: 0, buyback: null, quick: true },
  { slug: 'kids-logistics',    name: 'Kids — logistics', energy: -1, value: 1, buyback: 25,   quick: false },
  { slug: 'exercise',          name: 'Exercise',         energy: 1,  value: 2, buyback: null, quick: false },
  { slug: 'meals',             name: 'Meals',            energy: 0,  value: 1, buyback: null, quick: true },
  { slug: 'errands',           name: 'Errands',          energy: -1, value: 0, buyback: 24,   quick: false },
  { slug: 'personal-projects', name: 'Personal projects', energy: 1, value: 2, buyback: null, quick: false },
  { slug: 'social-family',     name: 'Social / family',  energy: 1,  value: 2, buyback: null, quick: false },
  // energy 0 = not yet rated. The outsourcing queue only picks up energy < 0, so
  // an unrated category makes no recommendation rather than a confident wrong one.
  { slug: 'cooking',           name: 'Cooking',          energy: 0,  value: 2, buyback: 25,   quick: true },
  { slug: 'yard-garden',       name: 'Yard / garden',    energy: 0,  value: 1, buyback: 40,   quick: false },
  { slug: 'sleep',             name: 'Sleep',            energy: 0,  value: 3, buyback: null, quick: true },
  // Fun with nothing to show for it afterwards — as opposed to Personal projects,
  // which accumulates, and Media / scroll, which happens to you.
  { slug: 'personal-fun',      name: 'Personal fun',     energy: 0,  value: 2, buyback: null, quick: true },
  // Showering, teeth, getting dressed. Short, frequent, and otherwise the
  // morning and evening gaps you can't reconstruct on the reconcile strip.
  { slug: 'personal-care',     name: 'Personal care',    energy: 0,  value: 1, buyback: null, quick: true },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  let inserted = 0
  for (const [index, c] of CATEGORIES.entries()) {
    const rows = await sql`
      insert into categories (user_id, slug, name, energy, value_tier, buyback_cost, is_quick, sort_order)
      values (${user}, ${c.slug}, ${c.name}, ${c.energy}, ${c.value}, ${c.buyback}, ${c.quick}, ${index})
      on conflict (user_id, slug) do nothing
      returning id
    `
    if (rows.length > 0) inserted++
  }

  console.log(
    inserted === 0
      ? `All ${CATEGORIES.length} categories already present.`
      : `Seeded ${inserted} of ${CATEGORIES.length} categories.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
