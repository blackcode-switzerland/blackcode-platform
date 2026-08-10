'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  // VISIBLE BY DEFAULT, not behind a flag or a role check. An owner needs it to
  // invite; a member needs it to see who else is here and that they are in the
  // right place. The page itself hides the invite form from non-owners, which is
  // where that decision belongs — a tab that appears for some people and not
  // others is how "why can Ana see this and I can't" becomes unanswerable.
  { seg: 'members', label: 'Members' },
  { seg: 'account', label: 'Account' },
  { seg: 'tokens', label: 'API tokens' },
  { seg: 'preferences', label: 'Preferences' },
]

export function SettingsNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const href = `/dashboard/settings/${t.seg}`
        const active = pathname === href
        return (
          <Link
            key={t.seg}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
              (active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
