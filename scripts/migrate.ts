import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { loadLocalEnv } from './env'

loadLocalEnv()

// Node 22+ ships a global WebSocket; the Neon pool needs it for the pg protocol
// (the http driver can't run multi-statement migration files).
neonConfig.webSocketConstructor = WebSocket as unknown as typeof neonConfig.webSocketConstructor

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.')

  const pool = new Pool({ connectionString: url })

  try {
    await pool.query(`
      create table if not exists _migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const applied = new Set(
      (await pool.query('select name from _migrations')).rows.map((r) => r.name as string)
    )

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let ran = 0
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`)
        continue
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into _migrations (name) values ($1)', [file])
        await client.query('commit')
        console.log(`  apply ${file}`)
        ran++
      } catch (error) {
        await client.query('rollback')
        throw new Error(`${file} failed: ${(error as Error).message}`)
      } finally {
        client.release()
      }
    }

    console.log(ran === 0 ? 'Nothing to apply.' : `Applied ${ran} migration(s).`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
