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
  const blocks = await sql`
    select
      c.name,
      to_char(b.started_at, 'HH24:MI:SS')       as started,
      coalesce(to_char(b.ended_at, 'HH24:MI:SS'), 'open') as ended,
      b.source
    from blocks b join categories c on c.id = b.category_id
    order by b.started_at
  `
  const open = await sql`select count(*)::int as n from blocks where ended_at is null`
  const seams = await sql`
    select count(*)::int as n from (
      select b.ended_at, lead(b.started_at) over (order by b.started_at) as next_start
      from blocks b where b.user_id = ${process.env.TALLY_USER_ID}
    ) t
    where t.ended_at is not null and t.next_start is not null and t.ended_at <> t.next_start
  `

  console.log('tables:        ', tables.map((r) => r.table_name).join(', '))
  console.log('views:         ', views.map((r) => r.table_name).join(', '))
  console.log('blocks indexes:', indexes.map((r) => r.indexname).join(', '))
  console.log('categories:    ', `${cats[0].total} total, ${cats[0].quick} quick`)
  console.log('open blocks:   ', open[0].n, '(must be 0 or 1)')
  console.log('seams:         ', seams[0].n, '(gaps between consecutive blocks; must be 0)')
  console.log('blocks:')
  for (const b of blocks) {
    console.log(`   ${String(b.started)} → ${String(b.ended).padEnd(8)} ${String(b.name).padEnd(18)} ${b.source}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
