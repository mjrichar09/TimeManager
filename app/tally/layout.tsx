import type { Metadata } from 'next'

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
  return children
}
