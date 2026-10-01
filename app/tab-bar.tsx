'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type Tab = {
  href: string
  label: string
  owns: (path: string) => boolean
}

/**
 * The tab bar both apps share.
 *
 * On a phone it sits at the bottom, inside the thumb's reach and clear of the
 * home indicator. The screens it switches between are used one-handed, standing
 * up, mid-task. From `md` up it moves to the top as a plain row, because the
 * review screen is a desktop screen and a bar pinned to the bottom of a monitor
 * is a phone habit carried too far.
 *
 * The active tab is marked by a rule on its edge rather than a filled box.
 */
export default function TabBar({ tabs, name }: { tabs: Tab[]; name: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={name}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-ground/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:static md:border-t-0 md:border-b md:bg-ground md:pb-0 md:backdrop-blur-none"
    >
      <div
        className="mx-auto grid max-w-[1180px] md:flex md:items-center md:gap-7 md:px-10"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        <span className="label hidden md:block md:py-4">{name}</span>
        {tabs.map((tab) => {
          const active = tab.owns(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`relative px-1 pt-3 pb-3.5 text-center text-[12px] font-medium md:py-4 md:text-[13px] ${
                active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {active ? (
                <span className="absolute inset-x-[26%] -top-px h-[2px] bg-ink md:inset-x-0 md:top-auto md:-bottom-px" />
              ) : null}
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
