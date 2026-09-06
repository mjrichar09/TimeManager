import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`
    select timezone, notify_hour, day_minutes, last_digest_on::text as last_digest_on
    from chore_settings
  `
  console.log(rows)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
