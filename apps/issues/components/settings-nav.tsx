'use client'

// Account settings' tab strip and column — the shared `AccountSettingsFrame`
// (2026-09-28), which all four apps render, so the four apps' account settings
// look alike. Preferences (the theme) joined the other three tabs the same day;
// the other apps already had it.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AccountSettingsFrame } from '@blackcode/platform-ui/account/account-settings'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  { seg: 'account', label: 'Account' },
  { seg: 'tokens', label: 'API tokens' },
  { seg: 'preferences', label: 'Preferences' },
]

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  return (
    <AccountSettingsFrame
      link={Link}
      tabs={TABS.map((t) => {
        const href = `/dashboard/settings/${t.seg}`
        return {
          href,
          label: t.label,
          active: pathname === href || pathname.startsWith(href + '/'),
          testId: `settings-tab-${t.seg}`,
        }
      })}
    >
      {children}
    </AccountSettingsFrame>
  )
}
