'use client'

// Account settings' tab strip and column — the shared `AccountSettingsFrame`
// (2026-09-28), which every app renders. `bare`: the sales shell's content
// area already pads its pages.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AccountSettingsFrame } from '@blackcode/platform-ui/account/account-settings'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  { seg: 'account', label: 'Account' },
  { seg: 'tokens', label: 'API tokens' },
  { seg: 'preferences', label: 'Preferences' },
]

export function SettingsFrame({ children, bare = true }: { children: React.ReactNode; bare?: boolean }) {
  const pathname = usePathname() ?? ''
  return (
    <AccountSettingsFrame
      link={Link}
      bare={bare}
      tabs={TABS.map((t) => {
        const href = `/dashboard/settings/${t.seg}`
        return { href, label: t.label, active: pathname === href, testId: `settings-tab-${t.seg}` }
      })}
    >
      {children}
    </AccountSettingsFrame>
  )
}
