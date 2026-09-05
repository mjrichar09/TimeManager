/**
 * Rounds' own manifest.
 *
 * `app/manifest.ts` is a root-only convention and belongs to Tally, so the
 * second app serves its own from a route handler. The `scope` is what makes the
 * browser treat this as a distinct installable app rather than another entry
 * point into Tally: two manifests, two scopes, two home-screen icons.
 */
export function GET() {
  return Response.json(
    {
      name: 'Rounds',
      short_name: 'Rounds',
      description: 'Periodic chores, planned rather than remembered.',
      id: '/rounds',
      start_url: '/rounds',
      scope: '/rounds',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f2f2ef',
      theme_color: '#f2f2ef',
      icons: [
        { src: '/icons/rounds-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/rounds-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/rounds-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'content-type': 'application/manifest+json' } }
  )
}
