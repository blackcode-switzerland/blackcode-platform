'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  // ── `members` WAS THE SECOND TAB UNTIL 2026-08-11 ─────────────────────────
  // It is a workspace list, and the four tabs that remain are all about the
  // ACCOUNT — one `platform.users` row, the same in every blackcode app. It is
  // a sidebar item at `/dashboard/{ws}/members` now, where the workspace is in
  // the URL rather than guessed. The old path still resolves; it redirects.
  //
  // The visibility note that was here travelled with it and now lives on the
  // page: the entry is shown to everybody, and the page — not the nav — hides
  // the invite form from non-owners. A nav item that appears for some people
  // and not others is how "why can Ana see this and I can't" becomes
  // unanswerable.
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
