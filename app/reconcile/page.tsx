import { getSql, userId } from '@/lib/db'
import ReconcileClient, { type Category } from './reconcile-client'

export const dynamic = 'force-dynamic'

async function loadCategories(): Promise<Category[]> {
  const sql = getSql()
  const rows = (await sql`
    select slug, name from categories
    where user_id = ${userId()} and archived_at is null
    order by is_quick desc, sort_order asc
  `) as Array<{ slug: string; name: string }>
  return rows
}

export default async function ReconcilePage() {
  return <ReconcileClient categories={await loadCategories()} />
}
