import { getSql, userId } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Category = {
  id: string
  slug: string
  name: string
  is_quick: boolean
}

async function loadCategories(): Promise<Category[]> {
  const sql = getSql()
  return (await sql`
    select id, slug, name, is_quick
    from categories
    where user_id = ${userId()} and archived_at is null
    order by is_quick desc, sort_order asc
  `) as Category[]
}

export default async function CapturePage() {
  const categories = await loadCategories()

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-rule px-4 pt-6 pb-4">
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">NOTHING OPEN</div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tracking-tight">Tally</div>
          <div className="tnum font-mono text-2xl font-medium tracking-tight text-ink-4">—</div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-[7px] px-4 pt-4">
        {categories.map((category) => (
          <div
            key={category.id}
            className={`flex h-28 flex-col justify-between border border-rule p-3 ${
              category.is_quick ? 'bg-surface text-ink' : 'bg-surface-2 text-ink-2'
            }`}
          >
            <span className="font-mono text-[9px] tracking-[0.12em] text-ink-4">
              {category.is_quick ? 'QUICK' : ''}
            </span>
            <span className="text-[15px] leading-tight font-medium">{category.name}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-rule p-4">
        <p className="text-center font-mono text-[10px] tracking-[0.12em] text-ink-4">
          TAPPING ARRIVES IN M1
        </p>
      </div>
    </main>
  )
}
