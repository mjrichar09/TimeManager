import { neon } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

// Read-only sanity check that the database matches build-plan §3.
async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by 1
  `
  const views = await sql`
    select table_name from information_schema.views
    where table_schema = 'public' order by 1
  `
  const indexes = await sql`
    select indexname from pg_indexes where tablename = 'blocks' order by 1
  `
  const cats = await sql`
    select count(*)::int as total, count(*) filter (where is_quick)::int as quick
    from categories
  `

  console.log('tables:        ', tables.map((r) => r.table_name).join(', '))
  console.log('views:         ', views.map((r) => r.table_name).join(', '))
  console.log('blocks indexes:', indexes.map((r) => r.indexname).join(', '))
  console.log('categories:    ', `${cats[0].total} total, ${cats[0].quick} quick`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
