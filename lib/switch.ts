import { getSql, userId } from './db'

export type SwitchSource = 'pwa' | 'shortcut' | 'reconcile'

export type OpenBlock = {
  slug: string
  name: string
  startedAt: string
}

export type SwitchResult = {
  ok: true
  /** True when the requested category was already open and nothing was written. */
  unchanged: boolean
  closed: { name: string; minutes: number } | null
  now: OpenBlock
}

export class UnknownCategoryError extends Error {
  constructor(slug: string) {
    super(`No category with slug "${slug}"`)
    this.name = 'UnknownCategoryError'
  }
}

/**
 * One tap = one switch. Closes whatever is open and opens the requested category.
 *
 * Idempotent by design (build-plan §4): if the requested category is already the
 * open one, nothing is written and the existing block is returned. A double-tap
 * on the Shortcut therefore can't fragment the log into two adjacent blocks.
 */
export async function switchTo(slug: string, source: SwitchSource): Promise<SwitchResult> {
  const sql = getSql()
  const uid = userId()

  // One read: the target category, plus whatever is currently open.
  const rows = (await sql`
    select
      c.id            as category_id,
      c.slug          as slug,
      c.name          as name,
      c.default_goal_id,
      o.category_id   as open_category_id,
      o.started_at    as open_started_at,
      oc.slug         as open_slug,
      oc.name         as open_name,
      extract(epoch from (now() - o.started_at)) / 60.0 as open_minutes
    from categories c
    left join blocks o
      on o.user_id = ${uid} and o.ended_at is null
    left join categories oc on oc.id = o.category_id
    where c.user_id = ${uid} and c.slug = ${slug} and c.archived_at is null
  `) as Array<Record<string, unknown>>

  if (rows.length === 0) throw new UnknownCategoryError(slug)
  const row = rows[0]

  const categoryId = row.category_id as string
  const openCategoryId = row.open_category_id as string | null

  // Already open — do nothing, report what's running.
  if (openCategoryId === categoryId) {
    return {
      ok: true,
      unchanged: true,
      closed: null,
      now: {
        slug: row.open_slug as string,
        name: row.open_name as string,
        startedAt: new Date(row.open_started_at as string).toISOString(),
      },
    }
  }

  // Close the old and open the new in one transaction, so now() is identical for
  // both and the day has no seam between them. The partial unique index
  // (one_open_block) is the backstop if anything ever races.
  const [, openedRows] = await sql.transaction([
    sql`
      update blocks set ended_at = now()
      where user_id = ${uid} and ended_at is null
    `,
    sql`
      insert into blocks (user_id, category_id, goal_id, started_at, source)
      values (${uid}, ${categoryId}, ${row.default_goal_id}, now(), ${source})
      returning started_at
    `,
  ])

  const startedAt = (openedRows as Array<{ started_at: string }>)[0].started_at

  return {
    ok: true,
    unchanged: false,
    closed: openCategoryId
      ? {
          name: row.open_name as string,
          minutes: Math.max(0, Math.round(Number(row.open_minutes))),
        }
      : null,
    now: {
      slug: row.slug as string,
      name: row.name as string,
      startedAt: new Date(startedAt).toISOString(),
    },
  }
}

/** What's running right now, if anything. */
export async function currentOpenBlock(): Promise<OpenBlock | null> {
  const sql = getSql()
  const rows = (await sql`
    select c.slug, c.name, b.started_at
    from blocks b
    join categories c on c.id = b.category_id
    where b.user_id = ${userId()} and b.ended_at is null
    limit 1
  `) as Array<{ slug: string; name: string; started_at: string }>

  if (rows.length === 0) return null
  return {
    slug: rows[0].slug,
    name: rows[0].name,
    startedAt: new Date(rows[0].started_at).toISOString(),
  }
}
