'use client'

// The tab strip across the top of every account-settings page. Modelled on
// apps/sales' `SettingsNav` — three tabs, not four: this app has no `ui_mode`
// (a display preference per workspace), so there is no Preferences tab to carry
// over. If one is ever added it belongs here, unstyled decisions aside.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  { seg: 'account', label: 'Account' },
  { seg: 'tokens', label: 'API tokens' },
]

export function SettingsNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav data-testid="settings-nav" className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const href = `/dashboard/settings/${t.seg}`
        const active = pathname === href
        return (
          <Link
            key={t.seg}
            href={href}
            data-testid={`settings-tab-${t.seg}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
