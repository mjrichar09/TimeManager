import { getSql, userId } from '@/lib/db'
import { composeDailyDigest, sendToAll } from '@/lib/push'
import { getSettings, todayIn } from '@/lib/rounds'

/**
 * The morning notification.
 *
 * Vercel crons fire on a fixed UTC schedule, and the hour you want to be told is
 * a local one that moves twice a year. So the schedule is deliberately coarse —
 * run often, decide here — and `last_digest_on` makes the decision idempotent:
 * whatever the cron does, exactly one digest goes out per local day.
 *
 * This route authenticates itself with CRON_SECRET and is excluded from the
 * session proxy, because a cron job has no cookie.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'cron_secret_not_set' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sql = getSql()
  const settings = await getSettings()
  const today = todayIn(settings.timezone)
  const localHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  )

  const rows = (await sql`
    select last_digest_on::text as last_digest_on from chore_settings where user_id = ${userId()}
  `) as Array<{ last_digest_on: string | null }>

  if (rows[0]?.last_digest_on === today) {
    return Response.json({ skipped: 'already_sent_today', today })
  }
  if (localHour < settings.notifyHour) {
    return Response.json({ skipped: 'too_early', localHour, notifyHour: settings.notifyHour })
  }

  const digest = await composeDailyDigest()
  if (!digest) {
    // Nothing due, nothing planned. Claim the day anyway so a later run doesn't
    // send a notification the moment one chore tips over into due.
    await sql`
      insert into chore_settings (user_id, last_digest_on) values (${userId()}, ${today}::date)
      on conflict (user_id) do update set last_digest_on = excluded.last_digest_on
    `
    return Response.json({ sent: 0, reason: 'nothing_to_say', today })
  }

  const { sent, failed } = await sendToAll(digest)

  // Only claim the day if something actually landed — a send that failed on
  // every device should be retried by the next run, not written off.
  if (sent > 0) {
    await sql`
      insert into chore_settings (user_id, last_digest_on) values (${userId()}, ${today}::date)
      on conflict (user_id) do update set last_digest_on = excluded.last_digest_on
    `
  }

  return Response.json({ sent, failed, today, title: digest.title, body: digest.body })
}
