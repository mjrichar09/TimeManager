'use client'

import TabBar, { type Tab } from '../tab-bar'

/**
 * Tally's tabs.
 *
 * Capture and reconcile used to be a one-way street: a single "End the day"
 * button pinned to the bottom of the capture grid, and nothing pointing back.
 * That is fine if the only reason to reconcile is that the day is over, but the
 * common case is fixing a block you mislabelled an hour ago and carrying on, so
 * either screen is one tap from the other, whichever one the app opened on.
 *
 * `/tally/check` deliberately has no tab of its own and lights Reconcile
 * instead: it is the last step of closing a day, not a place you navigate to.
 *
 * Goals is the odd one out — a desktop-shaped screen on a phone-shaped bar. It
 * earns the slot anyway: the ranked list and the lead measures live there.
 */
const TABS: Tab[] = [
  { href: '/tally', label: 'Capture', owns: (path) => path === '/tally' },
  {
    href: '/tally/reconcile',
    label: 'Reconcile',
    owns: (path) => path.startsWith('/tally/reconcile') || path.startsWith('/tally/check'),
  },
  { href: '/tally/calendar', label: 'Calendar', owns: (path) => path.startsWith('/tally/calendar') },
  { href: '/tally/goals', label: 'Goals', owns: (path) => path.startsWith('/tally/goals') },
  { href: '/tally/reports', label: 'Review', owns: (path) => path.startsWith('/tally/reports') },
]

export default function TallyNav() {
  return <TabBar tabs={TABS} name="Tally" />
}
