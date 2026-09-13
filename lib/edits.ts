import { getSql, userId } from './db'

/**
 * Edits to already-logged time (build-plan §5, reconcile).
 *
 * Every one of these rewrites history, so they all hold the same two invariants:
 * blocks never overlap, and a block never inverts (ended_at > started_at, which
 * the schema also enforces). Where a boundary is shared with a neighbour, both
 * sides move together in one transaction so the chain stays seamless — a gap in
 * the strip should only ever mean genuinely untracked time.
 */

export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditError'
  }
}

const MIN_BLOCK_MINUTES = 1

async function categoryBySlug(slug: string) {
  const sql = getSql()
  const rows = (await sql`
    select id, default_goal_id from categories
    where user_id = ${userId()} and slug = ${slug} and archived_at is null
  `) as Array<{ id: string; default_goal_id: string | null }>
  if (rows.length === 0) throw new EditError(`Unknown category "${slug}"`)
  return rows[0]
}

/**
 * Recategorise a block. The goal follows the new category's default, because a
 * block's goal was only ever inherited from its category in the first place.
 */
export async function recategorize(blockId: string, slug: string): Promise<void> {
  const sql = getSql()
  const category = await categoryBySlug(slug)
  const rows = (await sql`
    update blocks
    set category_id = ${category.id}, goal_id = ${category.default_goal_id}
    where id = ${blockId} and user_id = ${userId()}
    returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new EditError('Block not found')
}

/**
 * Move one edge of a block by a number of minutes.
 *
 * The edge and its neighbour move together: growing this block shrinks the one
 * it runs into, shrinking it lets a touching neighbour grow back. Two things
 * never happen — a block never overlaps its neighbour, and a neighbour is never
 * consumed entirely. Where there is a genuine gap on that side, the edge moves
 * into the gap first and the neighbour only starts moving once the edge reaches
 * it.
 *
 * The neighbour is found by ORDER, not by adjacency: the nearest block on that
 * side by `started_at`, whatever its end does. The earlier version looked for
 * "the block that ends before this one starts", which is the same thing only as
 * long as nothing overlaps — and the moment one overlap exists anywhere in the
 * log, the real neighbour stops matching that predicate, becomes invisible, and
 * the edge slides straight through it. That is how one overlap became many.
 * Finding the neighbour by order means an edit walks into an existing overlap
 * and tidies it up instead of deepening it.
 */
export async function moveEdge(
  blockId: string,
  edge: 'start' | 'end',
  deltaMinutes: number
): Promise<void> {
  const sql = getSql()
  const uid = userId()

  const rows = (await sql`
    select id, started_at, ended_at from blocks
    where id = ${blockId} and user_id = ${uid}
  `) as Array<{ id: string; started_at: string; ended_at: string | null }>
  if (rows.length === 0) throw new EditError('Block not found')

  const block = rows[0]
  const start = new Date(block.started_at).getTime()
  const end = block.ended_at ? new Date(block.ended_at).getTime() : null
  const delta = deltaMinutes * 60_000
  const min = MIN_BLOCK_MINUTES * 60_000

  if (edge === 'end' && end === null) {
    throw new EditError('The running block ends at now — switch or split it instead')
  }

  if (edge === 'start') {
    const target = start + delta
    if (target > (end ?? Date.now()) - min) {
      throw new EditError('That would leave nothing of this block')
    }

    const prevRows = (await sql`
      select id, started_at, ended_at from blocks
      where user_id = ${uid} and id <> ${blockId}
        and started_at < ${block.started_at}::timestamptz
      order by started_at desc limit 1
    `) as Array<{ id: string; started_at: string; ended_at: string | null }>

    const prev = prevRows[0]
    if (prev) {
      const prevStart = new Date(prev.started_at).getTime()
      const prevEnd = prev.ended_at ? new Date(prev.ended_at).getTime() : null

      // The block before this one has no end yet. Closing it here would be a
      // bigger edit than the button promises, so only the direction that
      // untangles them is allowed.
      if (prevEnd === null) {
        if (target < start) {
          throw new EditError('The block before this one is still running — stop it first')
        }
      } else if (target < prevEnd || prevEnd >= start) {
        // Either the edge has reached into the neighbour, or the two were
        // already touching (or overlapping) and it should follow this edge.
        if (target < prevStart + min) {
          throw new EditError('That would leave nothing of the block before it')
        }
        if (prevEnd > (end ?? Date.now())) {
          // It doesn't just touch this block, it swallows it. Trimming its end
          // to this edge would silently discard everything past this block.
          throw new EditError('The block before this one runs right past it — fix that overlap first')
        }

        const iso = new Date(target).toISOString()
        await sql.transaction([
          sql`update blocks set ended_at = ${iso}::timestamptz where id = ${prev.id} and user_id = ${uid}`,
          sql`update blocks set started_at = ${iso}::timestamptz where id = ${blockId} and user_id = ${uid}`,
        ])
        return
      }
    }

    await sql`
      update blocks set started_at = ${new Date(target).toISOString()}::timestamptz
      where id = ${blockId} and user_id = ${uid}
    `
    return
  }

  // edge === 'end'
  const target = (end as number) + delta
  if (target < start + min) throw new EditError('That would leave nothing of this block')

  const nextRows = (await sql`
    select id, started_at, ended_at from blocks
    where user_id = ${uid} and id <> ${blockId}
      and started_at > ${block.started_at}::timestamptz
    order by started_at asc limit 1
  `) as Array<{ id: string; started_at: string; ended_at: string | null }>

  const next = nextRows[0]
  if (next) {
    const nextStart = new Date(next.started_at).getTime()
    // An open neighbour runs to now, and pushing its start later is the normal
    // way a reconciled block takes time back off the one that's running.
    const nextEnd = next.ended_at ? new Date(next.ended_at).getTime() : Date.now()

    if (target > nextStart || nextStart <= (end as number)) {
      if (nextEnd <= (end as number)) {
        // It sits inside this block rather than after it. Moving its start to
        // this edge would invert it, and there is no nudge that untangles them.
        throw new EditError('The next block sits inside this one — fix that overlap first')
      }
      if (target > nextEnd - min) {
        throw new EditError('That would leave nothing of the block after it')
      }

      const iso = new Date(target).toISOString()
      await sql.transaction([
        sql`update blocks set ended_at = ${iso}::timestamptz where id = ${blockId} and user_id = ${uid}`,
        sql`update blocks set started_at = ${iso}::timestamptz where id = ${next.id} and user_id = ${uid}`,
      ])
      return
    }
  } else if (target > Date.now()) {
    throw new EditError('That would end in the future')
  }

  await sql`
    update blocks set ended_at = ${new Date(target).toISOString()}::timestamptz
    where id = ${blockId} and user_id = ${uid}
  `
}

/** Fill an unlogged stretch with a category. */
export async function fillGap(fromISO: string, toISO: string, slug: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  const category = await categoryBySlug(slug)

  if (new Date(toISO).getTime() <= new Date(fromISO).getTime()) {
    throw new EditError('That stretch has no length')
  }

  const clash = (await sql`
    select 1 from blocks
    where user_id = ${uid}
      and started_at < ${toISO}::timestamptz
      and coalesce(ended_at, now()) > ${fromISO}::timestamptz
    limit 1
  `) as Array<unknown>
  if (clash.length > 0) throw new EditError('Something is already logged there')

  await sql`
    insert into blocks (user_id, category_id, goal_id, started_at, ended_at, source)
    values (${uid}, ${category.id}, ${category.default_goal_id},
            ${fromISO}::timestamptz, ${toISO}::timestamptz, 'reconcile')
  `
}

/**
 * Split the running block: close it at `atISO`, and open a new one there.
 * This is what the 90-minute prompt does when you admit you changed tasks and
 * forgot to say so.
 */
export async function splitOpenBlock(atISO: string, slug: string): Promise<void> {
  const sql = getSql()
  const uid = userId()
  const category = await categoryBySlug(slug)

  const rows = (await sql`
    select id, started_at from blocks
    where user_id = ${uid} and ended_at is null
  `) as Array<{ id: string; started_at: string }>
  if (rows.length === 0) throw new EditError('Nothing is running')

  const at = new Date(atISO).getTime()
  const start = new Date(rows[0].started_at).getTime()
  if (at <= start) throw new EditError('The split has to be after the block started')
  if (at >= Date.now()) throw new EditError('The split has to be before now')

  await sql.transaction([
    sql`update blocks set ended_at = ${atISO}::timestamptz where id = ${rows[0].id} and user_id = ${uid}`,
    sql`
      insert into blocks (user_id, category_id, goal_id, started_at, source)
      values (${uid}, ${category.id}, ${category.default_goal_id}, ${atISO}::timestamptz, 'reconcile')
    `,
  ])
}

/**
 * Cut a block in two at `atISO`. Both halves keep the original category, so the
 * second is then recategorised the normal way.
 *
 * This is what makes a gap fillable with more than one thing: fill it, split it,
 * relabel the piece. Splitting the running block leaves the second half open.
 */
export async function splitBlock(blockId: string, atISO: string): Promise<void> {
  const sql = getSql()
  const uid = userId()

  const rows = (await sql`
    select id, category_id, goal_id, started_at, ended_at from blocks
    where id = ${blockId} and user_id = ${uid}
  `) as Array<{
    id: string
    category_id: string
    goal_id: string | null
    started_at: string
    ended_at: string | null
  }>
  if (rows.length === 0) throw new EditError('Block not found')

  const block = rows[0]
  const at = new Date(atISO).getTime()
  const start = new Date(block.started_at).getTime()
  const end = block.ended_at ? new Date(block.ended_at).getTime() : Date.now()

  if (at <= start) throw new EditError('The split has to be after the block starts')
  if (at >= end) throw new EditError('The split has to be before the block ends')

  // Close the original first, then open the second half — in that order the
  // one_open_block index never sees two open blocks, even mid-transaction.
  await sql.transaction([
    sql`update blocks set ended_at = ${atISO}::timestamptz where id = ${blockId} and user_id = ${uid}`,
    block.ended_at
      ? sql`
          insert into blocks (user_id, category_id, goal_id, started_at, ended_at, source)
          values (${uid}, ${block.category_id}, ${block.goal_id},
                  ${atISO}::timestamptz, ${block.ended_at}::timestamptz, 'reconcile')
        `
      : sql`
          insert into blocks (user_id, category_id, goal_id, started_at, source)
          values (${uid}, ${block.category_id}, ${block.goal_id}, ${atISO}::timestamptz, 'reconcile')
        `,
  ])
}

/** Delete a block, leaving a gap where it was. */
export async function deleteBlock(blockId: string): Promise<void> {
  const sql = getSql()
  const rows = (await sql`
    delete from blocks where id = ${blockId} and user_id = ${userId()} returning id
  `) as Array<{ id: string }>
  if (rows.length === 0) throw new EditError('Block not found')
}

/** Close the day. The daily_check row existing is what "complete" means. */
export async function completeDay(date: string): Promise<void> {
  const sql = getSql()
  await sql`
    insert into daily_check (user_id, date) values (${userId()}, ${date}::date)
    on conflict (user_id, date) do nothing
  `
}

export async function saveCheck(
  date: string,
  energy: number | null,
  movedPriority: boolean | null,
  note: string | null
): Promise<void> {
  if (energy !== null && (energy < 1 || energy > 10)) {
    throw new EditError('Energy runs 1 to 10')
  }
  const sql = getSql()
  await sql`
    insert into daily_check (user_id, date, energy, moved_priority, note)
    values (${userId()}, ${date}::date, ${energy}, ${movedPriority}, ${note})
    on conflict (user_id, date) do update
      set energy = excluded.energy,
          moved_priority = excluded.moved_priority,
          note = excluded.note
  `
}
