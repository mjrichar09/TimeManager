'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import type { RoundsView, Settings } from '@/lib/rounds'
import {
  saveSettingsAction,
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
  type RoundsResult,
} from '../actions'
import { minutesLabel } from '../format'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Enough zones to pick from if the browser can't enumerate them itself. Every
 * engine Rounds runs on supports Intl.supportedValuesOf, so this is a floor,
 * not the real list — see `zones` below.
 */
const FALLBACK_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'UTC',
]

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalised)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export default function SettingsClient({
  initial,
  vapidPublicKey,
}: {
  initial: RoundsView
  vapidPublicKey: string | null
}) {
  const [view, setView] = useState(initial)
  const [settings, setSettings] = useState<Settings>(initial.settings)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // null until the browser has been asked, so the "no push here" message never
  // flashes on a device that does support it.
  const [pushSupported, setPushSupported] = useState<boolean | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [pushNote, setPushNote] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  const dispatch = useCallback((work: () => Promise<RoundsResult>) => {
    startTransition(async () => {
      const result = await work()
      if (result.view) setView(result.view)
      setError(result.ok ? null : result.error)
      setSaved(result.ok)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window
      if (cancelled) return
      setPushSupported(supported)
      if (!supported) return

      try {
        // Scope '/' rather than '/rounds': a worker may only claim a scope its
        // own URL covers, and /sw.js sits at the root.
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        const existing = await registration.pushManager.getSubscription()
        if (!cancelled) setSubscription(existing)
      } catch (e) {
        if (!cancelled) setPushNote(`Service worker: ${(e as Error).message}`)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [])

  async function subscribe() {
    if (!vapidPublicKey) {
      setPushNote('No VAPID public key on the server — see docs/rounds.md')
      return
    }
    setPushBusy(true)
    setPushNote(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      setSubscription(sub)
      // Round-trip through JSON so the keys come out as the base64 strings the
      // server stores; the live object's getters don't survive serialisation.
      const plain = JSON.parse(JSON.stringify(sub)) as {
        endpoint: string
        keys: { p256dh: string; auth: string }
      }
      const label = navigator.userAgent.includes('Android') ? 'Android' : null
      dispatch(() => subscribePushAction(plain, label))
      setPushNote('Subscribed. Send a test to be sure.')
    } catch (e) {
      setPushNote(`Could not subscribe: ${(e as Error).message}`)
    } finally {
      setPushBusy(false)
    }
  }

  async function unsubscribe() {
    if (!subscription) return
    setPushBusy(true)
    const endpoint = subscription.endpoint
    try {
      await subscription.unsubscribe()
      setSubscription(null)
      dispatch(() => unsubscribePushAction(endpoint))
      setPushNote('This device will stop getting the morning list.')
    } finally {
      setPushBusy(false)
    }
  }

  function sendTest() {
    setPushBusy(true)
    startTransition(async () => {
      const result = await testPushAction()
      setPushNote(result.message)
      setPushBusy(false)
    })
  }

  const total = settings.dayMinutes.reduce((n, m) => n + m, 0)

  /**
   * The whole IANA list, straight from the browser, so the zone can never be a
   * typo — a misspelled zone made every date in the app quietly wrong, since
   * "today" is computed from it. The saved value is folded in regardless, so a
   * zone this browser doesn't know still shows as selected rather than
   * silently becoming whatever sorts first.
   */
  const zones = useMemo(() => {
    let all: string[]
    try {
      all = Intl.supportedValuesOf('timeZone')
    } catch {
      all = FALLBACK_ZONES
    }
    return all.includes(settings.timezone) ? all : [settings.timezone, ...all]
  }, [settings.timezone])

  return (
    <main className="pt-6">
      <h1 className="text-[27px] font-semibold tracking-tight">Settings</h1>

      {error ? (
        <div className="mt-4 bg-drain-ink px-3 py-2 font-mono text-[11px] text-surface">{error}</div>
      ) : null}

      <section className="mt-6 border border-rule bg-surface p-5">
        <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">
          DAY CAPACITY · MINUTES
        </div>
        <p className="mt-2 max-w-[62ch] text-[13px] text-ink-3">
          How much chore time each day can absorb before it stops being realistic. This is the one
          number the suggester plans against, so it is worth being pessimistic: a Tuesday that
          claims an hour and gets twenty minutes produces a plan you abandon by Wednesday.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {DAYS.map((day, index) => (
            <div key={day}>
              <label
                className="font-mono text-[9px] tracking-[0.12em] text-ink-3"
                htmlFor={`capacity-${index}`}
              >
                {day.slice(0, 3).toUpperCase()}
              </label>
              <input
                id={`capacity-${index}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={720}
                step={5}
                value={settings.dayMinutes[index]}
                onChange={(event) => {
                  const next = [...settings.dayMinutes]
                  next[index] = Number(event.target.value)
                  setSettings({ ...settings, dayMinutes: next })
                  setSaved(false)
                }}
                className="tnum mt-1 w-full border border-rule bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-rule-strong"
              />
            </div>
          ))}
        </div>

        <p className="tnum mt-3 font-mono text-[11px] text-ink-4">
          {minutesLabel(total)} a week
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label
              className="font-mono text-[9px] tracking-[0.12em] text-ink-3"
              htmlFor="notify-hour"
            >
              NOTIFY AT
            </label>
            <select
              id="notify-hour"
              value={settings.notifyHour}
              onChange={(event) => {
                setSettings({ ...settings, notifyHour: Number(event.target.value) })
                setSaved(false)
              }}
              className="tnum mt-1 w-full border border-rule bg-surface px-2 py-1.5 text-[13px]"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="font-mono text-[9px] tracking-[0.12em] text-ink-3" htmlFor="timezone">
              TIMEZONE
            </label>
            <select
              id="timezone"
              value={settings.timezone}
              onChange={(event) => {
                setSettings({ ...settings, timezone: event.target.value })
                setSaved(false)
              }}
              className="mt-1 w-full border border-rule bg-surface px-2 py-1.5 text-[13px]"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => dispatch(() => saveSettingsAction(settings))}
          className="mt-5 border border-ink bg-ink px-4 py-2.5 text-[13px] text-surface disabled:opacity-40"
        >
          {saved ? 'Saved' : 'Save settings'}
        </button>
      </section>

      <section className="mt-5 border border-rule bg-surface p-5">
        <div className="font-mono text-[9px] tracking-[0.12em] text-ink-3">MORNING NOTIFICATION</div>
        <p className="mt-2 max-w-[62ch] text-[13px] text-ink-3">
          One push a day listing what you planned for today. If nothing is planned and something is
          overdue, it says so and offers the planner instead. Subscribe on each device you want it
          on — install Rounds to the home screen first, or the browser will forget.
        </p>

        <p className="tnum mt-3 font-mono text-[11px] text-ink-4">
          {view.pushDevices} device{view.pushDevices === 1 ? '' : 's'} subscribed
        </p>

        {pushSupported === null ? null : !pushSupported ? (
          <p className="mt-3 text-[13px] text-drain-ink">
            This browser has no push support. Chrome on Android, or an installed home-screen app on
            iOS 16.4+.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {subscription ? (
              <button
                type="button"
                disabled={pushBusy || pending}
                onClick={unsubscribe}
                className="border border-rule px-4 py-2.5 text-[13px] text-ink-2 hover:border-rule-strong disabled:opacity-40"
              >
                Unsubscribe this device
              </button>
            ) : (
              <button
                type="button"
                disabled={pushBusy || pending}
                onClick={subscribe}
                className="border border-ink bg-ink px-4 py-2.5 text-[13px] text-surface disabled:opacity-40"
              >
                Subscribe this device
              </button>
            )}

            <button
              type="button"
              disabled={pushBusy || pending || view.pushDevices === 0}
              onClick={sendTest}
              className="border border-rule px-4 py-2.5 text-[13px] text-ink-2 hover:border-rule-strong disabled:opacity-40"
            >
              Send today&rsquo;s notification now
            </button>
          </div>
        )}

        {pushNote ? (
          <p className="mt-3 font-mono text-[11px] text-ink-2">{pushNote}</p>
        ) : null}
      </section>
    </main>
  )
}
