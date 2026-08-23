import { getSql, userId } from '@/lib/db'
import { currentOpenBlock } from '@/lib/switch'
import CaptureGrid, { type Tile } from './capture-grid'

export const dynamic = 'force-dynamic'

async function loadTiles(): Promise<Tile[]> {
  const sql = getSql()
  const rows = (await sql`
    select id, slug, name, is_quick
    from categories
    where user_id = ${userId()} and archived_at is null
    order by is_quick desc, sort_order asc
  `) as Array<{ id: string; slug: string; name: string; is_quick: boolean }>

  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, isQuick: r.is_quick }))
}

export default async function CapturePage() {
  const [tiles, open] = await Promise.all([loadTiles(), currentOpenBlock()])
  return <CaptureGrid tiles={tiles} initialOpen={open} />
}
