import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

/**
 * Deletes every block. For clearing test data before real logging starts —
 * there is no undo, so it refuses unless you pass --force.
 */
async function main() {
  if (!process.argv.includes('--force')) {
    console.error('Refusing to delete blocks without --force.')
    process.exit(1)
  }

  const sql = neon(process.env.DATABASE_URL!)
  const before = await sql`select count(*)::int as n from blocks where user_id = ${process.env.TALLY_USER_ID}`
  await sql`delete from blocks where user_id = ${process.env.TALLY_USER_ID}`
  console.log(`Deleted ${before[0].n} block(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
