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

export const metadata: Metadata = {
  title: 'Tally',
  description: 'Time audit and goal alignment.',
  // iOS ignores the manifest's display mode; this is what makes an
  // added-to-home-screen launch open without Safari chrome.
  appleWebApp: {
    capable: true,
    title: 'Tally',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/icon-180.png',
  },
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
