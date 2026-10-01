import { getSql, userId } from '@/lib/db'
import { currentOpenBlock } from '@/lib/switch'
import CaptureGrid, { type Tile } from './capture-grid'

export const dynamic = 'force-dynamic'

async function loadTiles(): Promise<Tile[]> {
  const sql = getSql()
  const uid = userId()
  // Last use rides along so each key can say when you last pressed it. The keys
  // keep their fixed order regardless: a keypad that reshuffles after every tap
  // is one you can never press without looking.
  const rows = (await sql`
    select
      c.id, c.slug, c.name, c.is_quick, c.energy,
      (
        select max(coalesce(b.ended_at, now()))
        from blocks b
        where b.user_id = ${uid} and b.category_id = c.id
      ) as last_used
    from categories c
    where c.user_id = ${uid} and c.archived_at is null
    order by c.is_quick desc, c.sort_order asc
  `) as Array<{
    id: string
    slug: string
    name: string
    is_quick: boolean
    energy: number
    last_used: string | null
  }>

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    isQuick: r.is_quick,
    energy: Number(r.energy),
    lastUsed: r.last_used ? new Date(r.last_used).toISOString() : null,
  }))
}

export default async function CapturePage() {
  const [tiles, open] = await Promise.all([loadTiles(), currentOpenBlock()])
  return <CaptureGrid tiles={tiles} initialOpen={open} />
}
