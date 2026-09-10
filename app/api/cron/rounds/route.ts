import { getSql, userId } from '@/lib/db'
import { composeDailyDigest, composeRenewalAlert, sendToAll } from '@/lib/push'
import { markAlerted } from '@/lib/renewals'
import { getSettings, todayIn } from '@/lib/rounds'

/**
 * The morning notification.
 *
 * Vercel crons fire on a fixed UTC schedule, and the hour you want to be told is
 * a local one that moves twice a year. So the schedule is deliberately coarse —
 * run often, decide here — and `last_digest_on` makes the decision idempotent:
 * whatever the cron does, exactly one digest goes out per local day.
 *
 * Two independent sends, in priority order:
 *
 *   1. Renewal warnings, guarded per renewal by its own alert bookkeeping.
 *   2. The chore digest, guarded by `last_digest_on`.
 *
 * They are independent on purpose. A day whose chore digest has already gone out
 * must still be able to tell you your passport expired — which is why the
 * already-sent check now guards only its own send instead of returning early
 * for the whole route.
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

  // Applies to both sends: nothing goes out before the hour you asked for.
  if (localHour < settings.notifyHour) {
    return Response.json({ skipped: 'too_early', localHour, notifyHour: settings.notifyHour })
  }

  // --- 1. Renewals ---------------------------------------------------------
  let renewalsSent = 0
  let renewalsAnnounced = 0
  const renewal = await composeRenewalAlert()
  if (renewal) {
    const { sent } = await sendToAll(renewal.notification)
    renewalsSent = sent
    // Only claim them once something landed. A failed send must be retried,
    // not written off — the whole point of a lead time is that it has slack,
    // and silently burning a stage would spend it.
    if (sent > 0) {
      await markAlerted(renewal.alerts, today)
      renewalsAnnounced = renewal.alerts.length
    }
  }

  // --- 2. The chore digest -------------------------------------------------
  const rows = (await sql`
    select last_digest_on::text as last_digest_on from chore_settings where user_id = ${userId()}
  `) as Array<{ last_digest_on: string | null }>

  if (rows[0]?.last_digest_on === today) {
    return Response.json({
      skipped: 'already_sent_today',
      today,
      renewals: { sent: renewalsSent, announced: renewalsAnnounced },
    })
  }

  const digest = await composeDailyDigest()
  if (!digest) {
    // Nothing due, nothing planned. Claim the day anyway so a later run doesn't
    // send a notification the moment one chore tips over into due.
    await sql`
      insert into chore_settings (user_id, last_digest_on) values (${userId()}, ${today}::date)
      on conflict (user_id) do update set last_digest_on = excluded.last_digest_on
    `
    return Response.json({
      sent: 0,
      reason: 'nothing_to_say',
      today,
      renewals: { sent: renewalsSent, announced: renewalsAnnounced },
    })
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

  return Response.json({
    sent,
    failed,
    today,
    title: digest.title,
    body: digest.body,
    renewals: { sent: renewalsSent, announced: renewalsAnnounced },
  })
}
