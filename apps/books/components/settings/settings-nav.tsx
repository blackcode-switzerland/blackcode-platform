'use client'

// The settings tabs.
//
// Four, and the same four b/issues and b/sales carry, in the same order and
// under the same labels. That is the point rather than an accident: the account
// is one `platform.users` row across every blackcode app, so a person who has
// found their tokens in one app has found them everywhere, and an app that
// renamed a tab would be describing a different account.
//
// The one label that is this app's own is **Preferences**, which holds the theme
// and nothing else. b/sales' version holds `ui_mode`, a per-workspace setting
// this app does not have; the tab is kept because the shape is worth keeping and
// the page says exactly what is in it rather than borrowing sales' sentence.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'

// Keys, not words — same arrangement as `lib/nav.ts`, and typed the same way so
// a tab naming a key that does not exist is a compile error rather than a tab
// labelled `settings.tab.whatever`.
const TABS: ReadonlyArray<{ seg: string; labelKey: BooksKey }> = [
  { seg: 'profile', labelKey: 'settings.tab.profile' },
  { seg: 'account', labelKey: 'settings.tab.account' },
  { seg: 'tokens', labelKey: 'settings.tab.tokens' },
  { seg: 'preferences', labelKey: 'settings.tab.preferences' },
]

export function SettingsNav() {
  const pathname = usePathname() ?? ''
  const t = useT()
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const href = `/dashboard/settings/${tab.seg}`
        const active = pathname === href
        return (
          <Link
            key={tab.seg}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
              (active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t(tab.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
