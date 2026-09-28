'use client'

// The settings tabs and their column — the shared `AccountSettingsFrame`
// (2026-09-28), which all four apps render, so an account that is one
// `platform.users` row everywhere also LOOKS like one settings page everywhere.
//
// Four tabs, the same four the other apps carry, in the same order and under
// the same labels — here in EN or FR from the dictionary. The one whose content
// is this app's own is **Preferences**: the theme, which every app has, and the
// language, which only b/books offers so far.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AccountSettingsFrame } from '@blackcode/platform-ui/account/account-settings'
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'

// Keys, not words — typed so a tab naming a key that does not exist is a
// compile error rather than a tab labelled `settings.tab.whatever`.
const TABS: ReadonlyArray<{ seg: string; labelKey: BooksKey }> = [
  { seg: 'profile', labelKey: 'settings.tab.profile' },
  { seg: 'account', labelKey: 'settings.tab.account' },
  { seg: 'tokens', labelKey: 'settings.tab.tokens' },
  { seg: 'preferences', labelKey: 'settings.tab.preferences' },
]

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const t = useT()
  return (
    <AccountSettingsFrame
      link={Link}
      tabs={TABS.map((tab) => {
        const href = `/dashboard/settings/${tab.seg}`
        return { href, label: t(tab.labelKey), active: pathname === href, testId: `settings-tab-${tab.seg}` }
      })}
    >
      {children}
    </AccountSettingsFrame>
  )
}
