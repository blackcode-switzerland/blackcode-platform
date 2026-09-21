'use client'

// The frame every workspace page sits in: a fixed left sidebar (a drawer below
// `lg`), content on the right. Same skeleton as apps/sales' `SalesShell`; the
// skin is billing's (app/globals.css).
//
// ── THE SHELL HAS NO TITLE BAR; EACH PAGE HAS A `PageHeader` ────────────────
// A page's header carries things only the page knows — a breadcrumb back to
// the list, the invoice number, the lifecycle actions, the company switcher.
// So the shell draws no header of its own on desktop. Below `lg` it must still
// offer the drawer, and it does that through `PageHeader`'s hamburger; a page
// that renders no `PageHeader` gets the shell's fallback mobile bar instead,
// so no page can strand a phone user without navigation.
//
// ── THE COMPANY FILTER TRAVELS WITH THE NAV ─────────────────────────────────
// `?company=<slug>` is the company switcher's state (components/shell/
// company-switcher.tsx). The nav carries it to the other company-scoped
// screens, so choosing a company and then opening Invoices keeps the choice.
// Companies itself is not filtered by company, so its link drops it.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import {
  Building2,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Repeat,
  Settings,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { useMe } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { BrandMark, wordmark } from '@/components/brand'
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher'

interface NavEntry {
  /** Path under `/dashboard/{ws}`; '' is the overview. */
  seg: string
  label: string
  icon: LucideIcon
  /** `data-testid` — a Playwright walk depends on these. */
  testId: string
  /** Whether the page reads `?company=`. */
  companyScoped: boolean
}

const NAV_MAIN: NavEntry[] = [
  { seg: '', label: 'Overview', icon: LayoutDashboard, testId: 'nav-overview', companyScoped: true },
  { seg: '/invoices', label: 'Invoices', icon: FileText, testId: 'nav-invoices', companyScoped: true },
  { seg: '/recurrences', label: 'Recurring', icon: Repeat, testId: 'nav-recurrences', companyScoped: true },
  { seg: '/companies', label: 'Companies', icon: Building2, testId: 'nav-companies', companyScoped: false },
  { seg: '/history', label: 'Imported history', icon: History, testId: 'nav-history', companyScoped: true },
  { seg: '/settings', label: 'Settings', icon: Settings, testId: 'nav-settings', companyScoped: false },
]

// ---------------------------------------------------------------------------
// Shell context: lets a PageHeader open the drawer, and tells the shell a
// PageHeader exists (so it can drop its fallback mobile bar).
// ---------------------------------------------------------------------------

interface ShellContextValue {
  openMenu: () => void
  registerHeader: () => () => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

/** Null outside a shell (e.g. a page rendered without one) — callers must cope. */
export function useShell(): ShellContextValue | null {
  return useContext(ShellContext)
}

export interface BillingShellProps {
  /** The workspace slug from the URL. Null on account pages reached with no workspace. */
  ws: string | null
  /** Every membership, loaded server-side by the layout (one query decides the 404 and fills the switcher). */
  workspaces: SwitcherWorkspace[]
  /**
   * The product name, from `APP_NAME` on the SERVER and passed down: its env
   * var is not exposed to the browser, so reading `APP_NAME` here would render
   * the default on a rebranded deployment.
   */
  appName: string
  children: React.ReactNode
}

export function BillingShell({ ws, workspaces, appName, children }: BillingShellProps) {
  const pathname = usePathname() ?? ''
  const [mobileOpen, setMobileOpen] = useState(false)
  const [headers, setHeaders] = useState(0)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const openMenu = useCallback(() => setMobileOpen(true), [])
  const registerHeader = useCallback(() => {
    setHeaders((n) => n + 1)
    return () => setHeaders((n) => n - 1)
  }, [])

  const sidebar = <Sidebar ws={ws} workspaces={workspaces} appName={appName} pathname={pathname} />

  return (
    <ShellContext.Provider value={{ openMenu, registerHeader }}>
      <div className="min-h-screen bg-background">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border lg:block">
          {sidebar}
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="Close menu"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-64 max-w-[85vw] border-r border-sidebar-border shadow-xl">
              {sidebar}
            </aside>
          </div>
        )}

        <div className="lg:pl-60">
          {headers === 0 && (
            <div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:hidden">
              <MenuButton onClick={openMenu} />
              <span className="truncate text-sm font-medium">{appName}</span>
            </div>
          )}
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  )
}

/** The hamburger. Exported for PageHeader; hidden from `lg` up. */
export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
      aria-label="Open menu"
      data-testid="menu-open"
    >
      <Menu size={18} />
    </button>
  )
}

function Sidebar({
  ws,
  workspaces,
  appName,
  pathname,
}: {
  ws: string | null
  workspaces: SwitcherWorkspace[]
  appName: string
  pathname: string
}) {
  const search = useSearchParams()
  const company = search?.get('company') ?? null
  const base = ws ? `/dashboard/${encodeURIComponent(ws)}` : null

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href={base ?? '/dashboard'}
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4"
      >
        <BrandMark />
        <span className="truncate text-[15px] font-semibold tracking-tight">{wordmark(appName)}</span>
      </Link>

      <WorkspaceSwitcher workspaces={workspaces} current={ws} />

      <nav data-testid="nav" className="flex-1 overflow-y-auto px-2.5 py-3">
        {base && (
          <div className="space-y-0.5">
            {NAV_MAIN.map((e) => (
              <NavLink
                key={e.seg}
                href={base + e.seg + (e.companyScoped && company ? `?company=${encodeURIComponent(company)}` : '')}
                active={isActive(pathname, base + e.seg, e.seg === '')}
                icon={e.icon}
                label={e.label}
                testId={e.testId}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-2.5">
        <AccountMenu pathname={pathname} />
      </div>
    </div>
  )
}

/**
 * Exact for the overview (every page is under it), boundary-aware prefix for
 * the rest: `/invoices` must not light up on a future `/invoices-archive`.
 */
function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href || pathname === href + '/'
  return pathname === href || pathname.startsWith(href + '/')
}

function NavLink({
  href,
  active,
  icon: Icon,
  label,
  testId,
}: {
  href: string
  active: boolean
  icon: LucideIcon
  label: string
  testId?: string
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
      )}
    >
      <Icon size={16} className={active ? 'text-sidebar-primary' : ''} />
      {label}
    </Link>
  )
}

/**
 * Who is signed in, their account settings, the theme and sign-out. The live
 * `/api/me` row wins over the session's copy, which is minted at sign-in and
 * never refreshed.
 */
function AccountMenu({ pathname }: { pathname: string }) {
  const { data: session } = useSession()
  const me = useMe()
  const user = {
    name: me.data?.name ?? session?.user?.name ?? null,
    email: me.data?.email ?? session?.user?.email ?? null,
    image: me.data?.avatar_url ?? session?.user?.image ?? null,
  }
  const accountActive = isActive(pathname, '/dashboard/settings', false)

  return (
    <div data-testid="account-menu">
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
        <MemberAvatar name={user.name} email={user.email} avatarUrl={user.image} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium" data-testid="account-name">
            {user.name ?? 'Signed in'}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground" data-testid="account-email">
            {user.email}
          </span>
        </span>
        <ThemeToggle />
      </div>
      <Link
        href="/dashboard/settings"
        data-testid="nav-account"
        aria-current={accountActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
          accountActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
        )}
      >
        <UserRound size={15} />
        Account settings
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/login' })}
        data-testid="sign-out"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <LogOut size={15} />
        Sign out
      </button>
    </div>
  )
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // The resolved theme is unknown until mount; a same-size blank avoids a
  // hydration mismatch and a layout shift.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      aria-label="Toggle theme"
      data-testid="theme-toggle"
    >
      {mounted ? resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} /> : <span className="block size-[15px]" />}
    </button>
  )
}
