import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Exercises goal CRUD, the five-goal cap, ranking, and the inheritance rule:
 * a block takes its goal from its category when it opens, and keeps it
 * afterwards no matter what the mapping does later.
 *
 * Cleans up after itself. Run with: npx tsx scripts/test-goals.ts
 */

const sql = neon(process.env.DATABASE_URL!)
const uid = process.env.TALLY_USER_ID!

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures++
}

async function main() {
  const existingBlocks = (await sql`select count(*)::int as n from blocks where user_id = ${uid}`) as Array<{ n: number }>
  const existingGoals = (await sql`select count(*)::int as n from goals where user_id = ${uid}`) as Array<{ n: number }>
  if (existingBlocks[0].n > 0 || existingGoals[0].n > 0) {
    console.error(`Refusing to run: ${existingBlocks[0].n} block(s), ${existingGoals[0].n} goal(s) exist.`)
    process.exit(1)
  }

  const goals = await import('../lib/goals')
  const { switchTo } = await import('../lib/switch')
  const { recategorize } = await import('../lib/edits')

  console.log('\ncreating five goals')
  for (const title of ['Ship the practice', 'Three lifts a week', 'Be present for the kids', 'Finish the house', 'Write the book']) {
    await goals.createGoal(title)
  }
  let view = await goals.getGoalsView()
  check('five goals active', view.goals.length === 5, String(view.goals.length))
  check('ranks are 1..5 in order', view.goals.map((g) => g.rank).join(',') === '1,2,3,4,5', view.goals.map((g) => g.rank).join(','))
  check('at cap', view.atCap)

  console.log('\nthe cap is enforced')
  let refused = false
  try {
    await goals.createGoal('A sixth priority')
  } catch {
    refused = true
  }
  check('sixth goal refused', refused)
  view = await goals.getGoalsView()
  check('still five goals', view.goals.length === 5, String(view.goals.length))

  console.log('\nreordering')
  const last = view.goals[4]
  await goals.moveGoal(last.id, 'up')
  view = await goals.getGoalsView()
  check('moved goal is now rank 4', view.goals.find((g) => g.id === last.id)?.rank === 4)
  check('ranks still contiguous', view.goals.map((g) => g.rank).join(',') === '1,2,3,4,5', view.goals.map((g) => g.rank).join(','))

  console.log('\nmapping a category to a goal')
  const target = view.goals[0]
  await goals.setCategoryGoal('deep-work', target.id)
  view = await goals.getGoalsView()
  check('goal lists the category', view.goals.find((g) => g.id === target.id)?.categories.some((c) => c.slug === 'deep-work') === true)

  console.log('\na new block inherits the goal')
  await switchTo('deep-work', 'pwa')
  let rows = (await sql`select goal_id from blocks where user_id = ${uid} and ended_at is null`) as Array<{ goal_id: string | null }>
  check('open block carries the goal', rows[0]?.goal_id === target.id, String(rows[0]?.goal_id))

  console.log('\na block in an unmapped category carries no goal')
  await switchTo('meals', 'pwa')
  rows = (await sql`select goal_id from blocks where user_id = ${uid} and ended_at is null`) as Array<{ goal_id: string | null }>
  check('open block has no goal', rows[0]?.goal_id === null, String(rows[0]?.goal_id))

  console.log('\nrecategorising moves the goal with it')
  const openId = ((await sql`select id from blocks where user_id = ${uid} and ended_at is null`) as Array<{ id: string }>)[0].id
  await recategorize(openId, 'deep-work')
  rows = (await sql`select goal_id from blocks where id = ${openId}`) as Array<{ goal_id: string | null }>
  check('recategorised block picked up the goal', rows[0].goal_id === target.id)

  console.log('\nchanging the mapping does not rewrite logged blocks')
  const other = view.goals[1]
  await goals.setCategoryGoal('deep-work', other.id)
  rows = (await sql`select goal_id from blocks where id = ${openId}`) as Array<{ goal_id: string | null }>
  check('existing block kept its original goal', rows[0].goal_id === target.id, `now ${rows[0].goal_id}`)

  console.log('\narchiving a goal')
  await goals.archiveGoal(other.id)
  view = await goals.getGoalsView()
  check('four goals remain', view.goals.length === 4, String(view.goals.length))
  check('ranks renumbered 1..4', view.goals.map((g) => g.rank).join(',') === '1,2,3,4', view.goals.map((g) => g.rank).join(','))
  check('no longer at cap', view.atCap === false)
  const cat = view.categories.find((c) => c.slug === 'deep-work')
  check('category fell back to no goal', cat?.goalId === null, String(cat?.goalId))
  rows = (await sql`select goal_id from blocks where id = ${openId}`) as Array<{ goal_id: string | null }>
  check('history survives the archive', rows[0].goal_id === target.id)

  console.log('\ncleaning up')
  await sql`delete from blocks where user_id = ${uid}`
  await sql`delete from goals where user_id = ${uid}`
  await sql`update categories set default_goal_id = null where user_id = ${uid}`
  const left = (await sql`select count(*)::int as n from goals where user_id = ${uid}`) as Array<{ n: number }>
  check('database left clean', left[0].n === 0)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
