'use client'

// The pieces of the signed-in sidebar every blackcode app draws — brand row,
// nav item, section label, account footer — at apps/issues' sizes (2026-09-28).
//
// Until then each app had its own: `text-sm` rows with 17px icons in issues,
// `text-[13px]` rows with 15–16px icons and `py-2` in the others, three
// different footers (an icon row, two text links, a column of buttons) and two
// sidebar widths. One set, drawn once, is how four apps stop drifting.
//
// This package has no router: an app passes its own `Link` (next/link) as
// `link`, and its own sign-out. Everything app-specific — the nav table, the
// counts, which footer extra — stays in the app's shell.

import { useEffect, useState } from 'react'
import { LogOut, Moon, Settings, Sun, type LucideIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useConfirm } from './confirm-dialog'
import { MemberAvatar } from './member-avatar'
import { cn } from '../utils'

/**
 * The app's link component (next/link). `ElementType` rather than a narrower
 * props shape: next/link's `href` also accepts a URL object, and a narrower
 * type makes it unassignable while adding no safety here — every call below
 * passes a string.
 */
export type SidebarLink = React.ElementType

/** Every app's sidebar is this wide; the content column offsets by `lg:ml-60` / `lg:pl-60`. */
export const SIDEBAR_WIDTH_CLASS = 'w-60'

/** The top row: the app's mark and word, linking home. */
export function SidebarBrand({
  href,
  link: Link,
  children,
}: {
  href: string
  link: SidebarLink
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3.5 py-3 transition-colors hover:bg-sidebar-accent/60"
    >
      {children}
    </Link>
  )
}

export function SidebarNavItem({
  href,
  label,
  icon: Icon,
  active,
  count,
  trailing,
  testId,
  link: Link,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  testId?: string
  count?: number
  /** Replaces the count — e.g. an unread badge. */
  trailing?: React.ReactNode
  link: SidebarLink
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={17} />
      <span className="flex-1 truncate">{label}</span>
      {trailing ?? (count != null ? <span className="text-xs tabular-nums text-muted-foreground/60">{count}</span> : null)}
    </Link>
  )
}

export function SidebarSectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('px-2.5 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground/70', className)}>
      {children}
    </p>
  )
}

const iconButton =
  'cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground'

/**
 * The signed-in person, then a row of icon buttons: theme, account settings,
 * sign out (confirmed). `extra` goes first in the row — books' language switch.
 */
export function SidebarAccount({
  name,
  email,
  avatarUrl,
  settingsHref,
  onSignOut,
  extra,
  link: Link,
  labels = {},
}: {
  name: string | null | undefined
  email: string | null | undefined
  avatarUrl?: string | null
  settingsHref: string
  onSignOut: () => void
  extra?: React.ReactNode
  link: SidebarLink
  labels?: Partial<{
    theme: string
    settings: string
    signOut: string
    signOutTitle: string
    signOutDescription: string
    cancel: string
  }>
}) {
  const L = {
    theme: 'Toggle theme',
    settings: 'Account settings',
    signOut: 'Sign out',
    signOutTitle: 'Sign out?',
    signOutDescription: 'You will be redirected to the login page.',
    cancel: 'Cancel',
    ...labels,
  }
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { confirm } = useConfirm()

  return (
    <div className="shrink-0 border-t border-sidebar-border p-2.5" data-testid="sidebar-account">
      <div className="mb-1 flex items-center gap-2.5 px-1.5 py-1">
        <MemberAvatar name={name ?? null} email={email ?? null} avatarUrl={avatarUrl ?? null} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight" data-testid="account-name">
            {name || email}
          </p>
          {name && (
            <p className="truncate text-xs leading-tight text-muted-foreground" data-testid="account-email">
              {email}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {extra}
        <button
          type="button"
          title={L.theme}
          aria-label={L.theme}
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className={iconButton}
        >
          {mounted ? resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} /> : <span className="block size-4" />}
        </button>
        <Link href={settingsHref} title={L.settings} aria-label={L.settings} data-testid="nav-account" className={iconButton}>
          <Settings size={16} />
        </Link>
        <button
          type="button"
          title={L.signOut}
          aria-label={L.signOut}
          data-testid="sign-out"
          onClick={async () => {
            if (
              await confirm({
                title: L.signOutTitle,
                description: L.signOutDescription,
                confirmLabel: L.signOut,
                cancelLabel: L.cancel,
              })
            )
              onSignOut()
          }}
          className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  )
}
