'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Tally's top bar.
 *
 * Capture and reconcile used to be a one-way street: a single "End the day"
 * button pinned to the bottom of the capture grid, and nothing pointing back.
 * That is fine if the only reason to reconcile is that the day is over, but the
 * common case is fixing a block you mislabelled an hour ago and carrying on.
 * A pair of tabs at the top means either screen is one tap from the other,
 * whichever one the app opened on.
 *
 * `/tally/check` deliberately has no tab of its own and lights Reconcile
 * instead: it is the last step of closing a day, not a place you navigate to.
 */
const TABS = [
  { href: '/tally', label: 'Capture', owns: (path: string) => path === '/tally' },
  {
    href: '/tally/reconcile',
    label: 'Reconcile',
    owns: (path: string) =>
      path.startsWith('/tally/reconcile') || path.startsWith('/tally/check'),
  },
  {
    href: '/tally/calendar',
    label: 'Calendar',
    owns: (path: string) => path.startsWith('/tally/calendar'),
  },
]

export default function TallyNav() {
  const pathname = usePathname()

  return (
    <nav className="grid grid-cols-3 gap-[5px] border-b border-rule px-4 py-3">
      {TABS.map((tab) => {
        const active = tab.owns(pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`border px-2 py-2.5 text-center text-[13px] ${
              active
                ? 'border-ink bg-ink text-surface'
                : 'border-rule bg-surface text-ink-2'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
