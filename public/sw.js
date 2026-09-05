/**
 * Rounds' service worker.
 *
 * Push only. There is deliberately no `fetch` handler: a worker that doesn't
 * intercept navigation can't serve anyone a stale page, and offline support is
 * not something a chore list needs. It registers at scope '/' because the file
 * has to be served from the root for the browser to allow that, which means it
 * also controls Tally's pages — harmless, since it does nothing but listen for
 * pushes.
 */

self.addEventListener('install', () => {
  // Take over straight away rather than waiting for every Rounds tab to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Rounds', body: event.data.text(), url: '/rounds' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Rounds', {
      body: payload.body || '',
      icon: '/icons/rounds-192.png',
      badge: '/icons/rounds-192.png',
      // Same tag replaces rather than stacks, so a phone left off all day shows
      // one morning list and not five.
      tag: payload.tag || 'rounds',
      renotify: false,
      data: { url: payload.url || '/rounds' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/rounds'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse an open Rounds window if there is one — a tap should land you in
      // the app you already had, not a second copy of it.
      for (const client of windows) {
        if (client.url.includes('/rounds') && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
