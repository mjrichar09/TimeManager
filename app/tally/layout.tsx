import type { Metadata } from 'next'
import TallyNav from './tally-nav'

/**
 * Tally's own identity, moved down here out of the root layout.
 *
 * It used to sit at the root, which meant Rounds inherited Tally's name and
 * apple-touch icon and had to override each one. Two apps share this tree now,
 * so anything true of only one of them belongs in that one's layout.
 */
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

export default function TallyLayout({ children }: { children: React.ReactNode }) {
  // The column is what lets each screen keep its own footer pinned to the
  // bottom: the page takes the height, and on a phone the padding keeps that
  // footer clear of the tab bar fixed underneath it.
  return (
    <div className="pb-tabbar flex min-h-dvh flex-col md:pb-0">
      <TallyNav />
      {children}
    </div>
  )
}
