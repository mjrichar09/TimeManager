'use client'

import TabBar, { type Tab } from '../tab-bar'

const TABS: Tab[] = [
  { href: '/rounds', label: 'Today', owns: (path) => path === '/rounds' },
  { href: '/rounds/plan', label: 'Plan', owns: (path) => path.startsWith('/rounds/plan') },
  { href: '/rounds/chores', label: 'Chores', owns: (path) => path.startsWith('/rounds/chores') },
  { href: '/rounds/renewals', label: 'Renewals', owns: (path) => path.startsWith('/rounds/renewals') },
  { href: '/rounds/settings', label: 'Settings', owns: (path) => path.startsWith('/rounds/settings') },
]

export default function RoundsNav() {
  return <TabBar tabs={TABS} name="Rounds" />
}
