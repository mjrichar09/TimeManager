import { neon } from '@neondatabase/serverless'

// Lazy — a top-level neon() would throw during `next build` before the database
// env var exists (first deploy, CI).
type Sql = ReturnType<typeof neon>
let _sql: Sql | null = null

export function getSql(): Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _sql = neon(url)
  }
  return _sql
}

// One user, one id. Kept as a column everywhere so the schema stays portable.
export function userId(): string {
  const id = process.env.TALLY_USER_ID
  if (!id) throw new Error('TALLY_USER_ID is not set')
  return id
}
