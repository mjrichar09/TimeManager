import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Starter chores for Rounds.
 *
 * The intervals are a first guess, and the app is built on the assumption that
 * they are wrong. Change them from the chores screen once you have seen a chore
 * come round twice — an interval you keep skipping is too short, and one that
 * always arrives after you have already noticed the mess is too long.
 *
 * `effort` is the number the planner budgets against, so it wants to be the
 * honest door-to-door figure including fetching the bucket, not the best case.
 */
const CHORES = [
  // Kitchen
  { slug: 'deep-clean-sink',    name: 'Deep clean sink',        area: 'Kitchen',  interval: 14,  effort: 20, weekend: false },
  { slug: 'clean-drying-racks', name: 'Clean drying racks',     area: 'Kitchen',  interval: 21,  effort: 15, weekend: false },
  { slug: 'clean-oven',         name: 'Clean oven',             area: 'Kitchen',  interval: 90,  effort: 60, weekend: true  },
  { slug: 'defrost-fridge',     name: 'Clear out fridge',       area: 'Kitchen',  interval: 14,  effort: 20, weekend: false },
  { slug: 'descale-kettle',     name: 'Descale kettle',         area: 'Kitchen',  interval: 60,  effort: 10, weekend: false },

  // Bathrooms
  { slug: 'clean-bathrooms',    name: 'Clean bathrooms',        area: 'Bathroom', interval: 7,   effort: 45, weekend: true  },
  { slug: 'descale-showerhead', name: 'Descale shower head',    area: 'Bathroom', interval: 90,  effort: 20, weekend: false },
  { slug: 'wash-bath-mats',     name: 'Wash bath mats',         area: 'Bathroom', interval: 21,  effort: 10, weekend: false },

  // Outside
  { slug: 'mow-lawn',           name: 'Mow lawn',               area: 'Outside',  interval: 10,  effort: 45, weekend: true  },
  { slug: 'cut-hedges',         name: 'Cut hedges',             area: 'Outside',  interval: 60,  effort: 90, weekend: true  },
  { slug: 'clear-gutters',      name: 'Clear gutters',          area: 'Outside',  interval: 182, effort: 60, weekend: true  },
  { slug: 'wash-car',           name: 'Wash car',               area: 'Outside',  interval: 30,  effort: 40, weekend: true  },
  { slug: 'bins-out',           name: 'Bins out',               area: 'Outside',  interval: 7,   effort: 5,  weekend: false },

  // House
  { slug: 'change-bedding',     name: 'Change bedding',         area: 'House',    interval: 14,  effort: 25, weekend: false },
  { slug: 'hoover-through',     name: 'Hoover through',         area: 'House',    interval: 7,   effort: 30, weekend: false },
  { slug: 'dust-surfaces',      name: 'Dust surfaces',          area: 'House',    interval: 14,  effort: 25, weekend: false },
  { slug: 'clean-windows',      name: 'Clean windows',          area: 'House',    interval: 120, effort: 60, weekend: true  },
  { slug: 'wash-towels',        name: 'Wash towels',            area: 'House',    interval: 10,  effort: 10, weekend: false },

  // Upkeep — the ones nobody remembers until they matter
  { slug: 'test-smoke-alarms',  name: 'Test smoke alarms',      area: 'Upkeep',   interval: 30,  effort: 10, weekend: false },
  { slug: 'boiler-pressure',    name: 'Check boiler pressure',  area: 'Upkeep',   interval: 60,  effort: 5,  weekend: false },
  { slug: 'clean-washer-seal',  name: 'Clean washer seal',      area: 'Upkeep',   interval: 30,  effort: 15, weekend: false },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')
  const user = process.env.TALLY_USER_ID
  if (!user) throw new Error('TALLY_USER_ID is not set.')

  const sql = neon(url)

  // Stagger the first due dates rather than making all twenty-one land on day
  // one. A wall of overdue chores on first open is indistinguishable from having
  // no plan at all, which is the thing this app exists to fix.
  let inserted = 0
  for (const [index, c] of CHORES.entries()) {
    const offset = index % 14
    const rows = await sql`
      insert into chores
        (user_id, slug, name, area, interval_days, effort_minutes, prefer_weekend, first_due_on, sort_order)
      values
        (${user}, ${c.slug}, ${c.name}, ${c.area}, ${c.interval}, ${c.effort}, ${c.weekend},
         current_date + ${offset}::int, ${index})
      on conflict (user_id, slug) do nothing
      returning id
    `
    if (rows.length > 0) inserted++
  }

  await sql`
    insert into chore_settings (user_id) values (${user})
    on conflict (user_id) do nothing
  `

  console.log(
    inserted === 0
      ? `All ${CHORES.length} chores already present.`
      : `Inserted ${inserted} of ${CHORES.length} chores.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
