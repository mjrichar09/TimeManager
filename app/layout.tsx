import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from 'next/font/google'
import './globals.css'

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

// The instrument face: clocks, totals and screen titles. Same family as the
// body, narrower, so a running "1:52:07" fits a dial without shrinking.
const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: '--font-plex-condensed',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
})

// Deliberately thin. This layout is shared by Tally, Rounds and the login page,
// so it carries only what all three need — fonts, the ground colour, the
// viewport. Each app names itself in its own layout.
export const metadata: Metadata = {
  title: 'Tally & Rounds',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2ef' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
  viewportFit: 'cover',
  // The capture grid is a fixed keypad; pinch-zooming it only ever misfires.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable} font-sans`}>{children}</body>
    </html>
  )
}
