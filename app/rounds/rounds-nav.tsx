'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/rounds', label: 'Today' },
  { href: '/rounds/plan', label: 'Plan' },
  { href: '/rounds/chores', label: 'Chores' },
  { href: '/rounds/renewals', label: 'Renewals' },
  { href: '/rounds/settings', label: 'Settings' },
]

export default function RoundsNav() {
  const pathname = usePathname()

  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
      <div className="font-mono text-[10px] tracking-[0.14em] text-ink-3">ROUNDS</div>
      <nav className="flex gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'border border-ink bg-ink px-3 py-1.5 text-[13px] text-surface'
                  : 'border border-rule px-3 py-1.5 text-[13px] text-ink-2 hover:border-rule-strong'
              }
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
