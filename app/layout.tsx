import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
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
  themeColor: '#f2f2ef',
  viewportFit: 'cover',
  // The capture grid is a fixed keypad; pinch-zooming it only ever misfires.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans`}>{children}</body>
    </html>
  )
}
