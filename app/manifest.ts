import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tally',
    short_name: 'Tally',
    description: 'Time audit and goal alignment.',
    start_url: '/',
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
