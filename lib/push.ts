import webpush, { type PushSubscription } from 'web-push'
import { getSql, userId } from './db'
import { dueAlerts, type RenewalAlert } from './renewals'
import { getChores, getPlan, getSettings, todayIn } from './rounds'

/**
 * Web push for Rounds.
 *
 * One subscription row per installed browser. Sends are best-effort and never
 * throw at the caller: a phone that has revoked permission must not take down
 * the cron job for the phone that hasn't.
 */

export type StoredSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

let configured = false

function configure(): void {
  if (configured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys are not set — see docs/rounds.md')
  }
  // The contact is what a push service uses to reach you if your sends start
  // misbehaving. A mailto: with a real address is the whole requirement.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:nobody@example.com',
    publicKey,
    privateKey
  )
  configured = true
}

export async function saveSubscription(sub: StoredSubscription, label: string | null) {
  const sql = getSql()
  await sql`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, label)
    values (${userId()}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${label})
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      expired_at = null
  `
}

export async function removeSubscription(endpoint: string) {
  const sql = getSql()
  await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${userId()}`
}

export type Notification = {
  title: string
  body: string
  /** Where a tap lands. */
  url: string
  /** Collapses with any earlier notification carrying the same tag. */
  tag: string
}

/**
 * Send to every live device. Returns how many landed; endpoints the push service
 * has retired are marked expired rather than deleted, so a phone that has gone
 * quiet shows a reason on the settings screen instead of just vanishing.
 */
export async function sendToAll(notification: Notification): Promise<{ sent: number; failed: number }> {
  configure()
  const sql = getSql()
  const rows = (await sql`
    select id, endpoint, p256dh, auth from push_subscriptions
    where user_id = ${userId()} and expired_at is null
  `) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const subscription: PushSubscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    try {
      await webpush.sendNotification(subscription, JSON.stringify(notification))
      await sql`update push_subscriptions set last_sent_at = now() where id = ${row.id}`
      sent++
    } catch (error) {
      failed++
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await sql`update push_subscriptions set expired_at = now() where id = ${row.id}`
      } else {
        console.error('push failed', row.endpoint, status, (error as Error).message)
      }
    }
  }

  return { sent, failed }
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * The morning notification, built from the plan rather than from the due dates.
 *
 * The whole premise of the app is that a planned chore gets done without
 * deciding anything, so the notification's job is to read out a list, not to
 * present a problem. It only falls back to talking about what is overdue when
 * there is no plan to read out — and then it asks for a plan, which is the one
 * useful action at that point.
 */
export async function composeDailyDigest(): Promise<Notification | null> {
  const settings = await getSettings()
  const today = todayIn(settings.timezone)
  const [plan, chores] = await Promise.all([getPlan(today, today), getChores(today)])

  const todo = plan.filter((p) => p.status === 'planned')

  if (todo.length > 0) {
    const minutes = todo.reduce((n, p) => n + p.effortMinutes, 0)
    const names = todo.map((p) => p.name)
    const body =
      names.length <= 3
        ? `${names.join(', ')} — ${minutesLabel(minutes)}`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more — ${minutesLabel(minutes)}`
    return {
      title: todo.length === 1 ? 'One thing today' : `${todo.length} things today`,
      body,
      url: '/rounds',
      tag: `rounds-today-${today}`,
    }
  }

  const overdue = chores.filter((c) => c.state === 'overdue')
  const dueToday = chores.filter((c) => c.state === 'due')

  if (overdue.length === 0 && dueToday.length === 0) return null

  const count = overdue.length + dueToday.length
  const worst = [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue)[0]

  return {
    title: 'Nothing planned today',
    body:
      overdue.length > 0
        ? `${count} chore${count === 1 ? '' : 's'} waiting — ${worst.name} is ${worst.daysOverdue} day${worst.daysOverdue === 1 ? '' : 's'} late. Plan the week?`
        : `${count} chore${count === 1 ? '' : 's'} come due today. Plan the week?`,
    url: '/rounds/plan',
    tag: `rounds-unplanned-${today}`,
  }
}

/**
 * The renewal warnings worth sending this morning.
 *
 * Deliberately a SEPARATE notification from the daily digest rather than an
 * extra line on it. "Passport expires in 90 days" and "bins, 10 min" want
 * different reactions, and the digest's job is to be a list you work through
 * without deciding anything — which is exactly what a renewal is not.
 *
 * Returns the notification and the ids it covers, so the caller can record that
 * they were announced only once the push has actually landed.
 */
export async function composeRenewalAlert(): Promise<{
  notification: Notification
  alerts: RenewalAlert[]
} | null> {
  const settings = await getSettings()
  const today = todayIn(settings.timezone)
  const alerts = await dueAlerts(today)
  if (alerts.length === 0) return null

  // Worst first: expired before merely soon, and nearest before furthest.
  const sorted = [...alerts].sort((a, b) => a.daysUntil - b.daysUntil)
  const worst = sorted[0]

  const when = (days: number) => {
    if (days < 0) return `expired ${-days} day${days === -1 ? '' : 's'} ago`
    if (days === 0) return 'expires today'
    if (days === 1) return 'expires tomorrow'
    if (days < 60) return `expires in ${days} days`
    return `expires in ${Math.round(days / 30.44)} months`
  }

  const title =
    sorted.length === 1
      ? worst.daysUntil < 0
        ? `${worst.name} has expired`
        : `${worst.name} — ${when(worst.daysUntil)}`
      : `${sorted.length} renewals need attention`

  const body =
    sorted.length === 1
      ? worst.daysUntil < 0
        ? 'Renew it, then set the new date.'
        : "You can't do this one early, but you can do it now."
      : sorted.map((a) => `${a.name} ${when(a.daysUntil)}`).join(' · ')

  return {
    notification: {
      title,
      body,
      url: '/rounds/renewals',
      // Its own tag, so a renewal warning never collapses the morning list or
      // gets collapsed by it.
      tag: `rounds-renewals-${today}`,
    },
    alerts: sorted,
  }
}
