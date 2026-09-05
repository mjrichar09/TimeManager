import type { MetadataRoute } from 'next'

/**
 * Tally's manifest. Still served from the origin root so the URL stays stable
 * for anything already pointing at it, but the app it describes now lives under
 * /tally.
 *
 * The scope is the whole point of that move. Two installable apps can share an
 * origin only when neither scope contains the other's start_url — an app scoped
 * to '/' swallows every sibling, and the browser then treats a home-screen
 * install from /rounds as an update to this app rather than a second one. So
 * Tally claims '/tally', Rounds claims '/rounds', and they sit side by side.
 *
 * `id` is stated rather than left to default. An omitted id resolves to the
 * start_url, which means the identity would silently change every time the
 * start_url did — and a changed identity is a different app to the browser, so
 * the icon on the home screen stops updating and has to be re-added.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/tally',
    name: 'Tally',
    short_name: 'Tally',
    description: 'Time audit and goal alignment.',
    start_url: '/tally',
    scope: '/tally',
    // Standalone so the home-screen launch has no browser chrome — the capture
    // grid should feel like a keypad, not a web page.
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f2f2ef',
    theme_color: '#f2f2ef',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
