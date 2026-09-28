'use client'

// Account settings' tab strip and column — the shared `AccountSettingsFrame`
// (2026-09-28), which every app renders, so the four apps' settings look alike.
// The tabs keep the `settings-tab-*` testids a Playwright walk uses.

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
        return { href, label: t.label, active: pathname === href, testId: `settings-tab-${t.seg}` }
      })}
    >
      {children}
    </AccountSettingsFrame>
  )
}
