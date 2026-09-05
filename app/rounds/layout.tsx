import type { Metadata } from 'next'
import RoundsNav from './rounds-nav'

/**
 * Rounds is a second app sharing Tally's repo, deployment, database and session
 * cookie. What makes it a separate *app* rather than a tab is this layout: its
 * own manifest, its own icon and its own scope, so `/rounds` installs to the
 * home screen as a second thing you can open.
 */
export const metadata: Metadata = {
  title: 'Rounds',
  description: 'Periodic chores, planned rather than remembered.',
  manifest: '/rounds/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Rounds',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/rounds-180.png',
  },
}

export default function RoundsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-[1180px] px-5 pb-16 pt-6 md:px-10">
      <RoundsNav />
      {children}
    </div>
  )
}
