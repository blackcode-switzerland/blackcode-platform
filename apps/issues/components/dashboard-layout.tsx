'use client'

import { useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutGrid,
  List,
  Target,
  BarChart3,
  LayoutDashboard,
  Clock,
  Inbox,
  Settings2,
  Tag,
  Trash2,
  Menu,
  X,
  ShieldCheck,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { WorkspaceSwitcher } from './workspace-switcher'
import { InboxBadge } from './inbox-badge'
import { GlobalSearch, useModKey } from './search/global-search'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { SidebarAccount, SidebarNavItem, SidebarSectionLabel } from '@blackcode/platform-ui/ui/sidebar'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const NAV_PRIMARY = [
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox, trailing: true, match: (p: string) => p === '/dashboard/inbox' },
]

// Workspace-scoped nav. `seg` is the path under /dashboard/{ws}; the href and
// active-match are built per-render from the current workspace slug. `countKey`
// maps to the sidebar count badges.
type CountKey = 'projects' | 'tasks' | 'issues' | 'labels'
const NAV_WORKSPACE: { seg: string; label: string; icon: LucideIcon; countKey?: CountKey }[] = [
  { seg: '', label: 'Projects', icon: LayoutGrid, countKey: 'projects' },
  { seg: '/tasks', label: 'Tasks', icon: Target, countKey: 'tasks' },
  { seg: '/issues', label: 'Issues', icon: List, countKey: 'issues' },
  { seg: '/labels', label: 'Labels', icon: Tag, countKey: 'labels' },
  { seg: '/activity', label: 'Activity', icon: Clock },
  { seg: '/overview', label: 'Overview', icon: LayoutDashboard },
  { seg: '/analytics', label: 'Analytics', icon: BarChart3 },
  { seg: '/trash', label: 'Trash', icon: Trash2 },
  // Name, logo, members, invitations, storage and deletion — the settings page
  // every blackcode app shares (2026-09-28). It replaced a Members entry here;
  // `/members` redirects to it.
  { seg: '/settings', label: 'Workspace settings', icon: Settings2 },
]


export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const [mobileOpen, setMobileOpen] = useState(false)
  // Workspace search. State lives here because three things open it — the
  // floating button, the sidebar row and the mobile header — plus ⌘K.
  const [searchOpen, setSearchOpen] = useState(false)
  const mod = useModKey()
  const { data: ws } = useActiveWorkspace()

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Pull the live profile so the avatar/name reflect edits immediately (the
  // session JWT is only refreshed on re-login). Shares the ['me'] cache with
  // the profile settings page, so an upload there updates the sidebar too.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me')
      if (!res.ok) return null
      return res.json() as Promise<{
        name: string | null
        email: string
        avatar_url: string | null
        is_super_admin: boolean
      }>
    },
  })

  const { data: counts } = useQuery({
    queryKey: ['sidebar-counts', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const slug = ws!.slug
      const [p, m, i, l] = await Promise.all([
        fetch(`/api/workspaces/${slug}/projects`).then((r) => r.json()).then((j) => (j.data ?? j).length as number),
        fetch(`/api/workspaces/${slug}/tasks`).then((r) => r.json()).then((j) => (j.total ?? j.data?.length ?? 0) as number),
        fetch(`/api/workspaces/${slug}/issues`).then((r) => r.json()).then((j) => (j.total ?? j.data?.length ?? 0) as number),
        fetch(`/api/workspaces/${slug}/labels`).then((r) => r.json()).then((j) => (j.data ?? j).length as number),
      ])
      return { projects: p, tasks: m, issues: i, labels: l }
    },
  })

  const displayName = me?.name ?? user?.name ?? ''
  const displayEmail = me?.email ?? user?.email ?? ''
  const avatarUrl = me?.avatar_url ?? user?.image ?? null

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <Link
        href="/?from=app"
        className="flex items-center gap-2 border-b border-sidebar-border px-3.5 py-3 transition-colors hover:bg-sidebar-accent/60"
      >
        {/* THE MARK IS THE `b/`, SO THE WORDMARK BESIDE IT MUST NOT REPEAT IT.
            This read `blackcode` until 2026-08-11, next to a logo that already
            draws `b/` — and `apps/sales` drew a text `b/` badge next to the word
            `sales`. Two apps, two treatments, and the issues one did not name
            the app at all. Mark + app word, identical in both apps: the eye
            reads `b/issues` and `b/sales`, which is what `APP_NAME` says and
            what the emails now say. Changing one of these without the other is
            worse than what was here. */}
        <Image src="/logo.png" alt="b/" width={22} height={22} className="rounded-[14%]" />
        <span className="text-[15px] font-semibold tracking-tight">issues</span>
      </Link>

      {/* Workspace switcher / top */}
      <div className="flex items-center gap-1 px-3 py-3">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent lg:hidden"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5">
          {ws?.slug && (
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                setSearchOpen(true)
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <Search size={17} />
              <span className="flex-1 truncate text-left">Search</span>
              <kbd className="rounded border border-sidebar-border px-1 font-sans text-[10px] text-muted-foreground/70">{mod}K</kbd>
            </button>
          )}
          {NAV_PRIMARY.map((item) => (
            <SidebarNavItem key={item.href} href={item.href} label={item.label} icon={item.icon} active={item.match(pathname ?? '')} trailing={item.trailing ? <InboxBadge /> : undefined} link={Link} />
          ))}
        </div>

        <SidebarSectionLabel>This workspace</SidebarSectionLabel>
        <div className="space-y-0.5">
          {ws?.slug
            ? NAV_WORKSPACE.map((item) => {
                const base = `/dashboard/${ws.slug}`
                const href = `${base}${item.seg}`
                const p = pathname ?? ''
                const active = item.seg === ''
                  ? p === base
                  : p === href || p.startsWith(`${href}/`)
                const count = item.countKey ? counts?.[item.countKey] : undefined
                return <SidebarNavItem key={item.seg} href={href} label={item.label} icon={item.icon} active={active} count={count} link={Link} />
              })
            : null}
        </div>

        {me?.is_super_admin && (
          <div className="mt-3 space-y-0.5">
            <Link
              href="/dashboard/super-admin"
              className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                (pathname ?? '').startsWith('/dashboard/super-admin')
                  ? 'bg-primary/10 text-primary'
                  : 'text-primary/70 hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <ShieldCheck size={17} />
              <span className="flex-1 truncate">Super Admin</span>
            </Link>
          </div>
        )}
      </nav>

      <SidebarAccount
        name={displayName || null}
        email={displayEmail || null}
        avatarUrl={avatarUrl}
        settingsHref="/dashboard/settings"
        onSignOut={() => signOut()}
        link={Link}
      />
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-60 border-r border-sidebar-border bg-sidebar lg:block">
        {sidebar}
      </aside>

      {/* Mobile top bar (static so page-level sticky headers can take top-0) */}
      <header className="dashboard-mobile-header flex h-12 items-center gap-2 border-b border-border bg-background px-3 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        {/* rounded-[14%], like every other render of this mark in both apps. The
            radius on the blackcode logo is a constant 6px at every size it is
            drawn at, not a proportion — this was `rounded` (4px) and the row
            above it is `rounded-[14%]`. */}
        <Image src="/logo.png" alt="b/" width={18} height={18} className="rounded-[14%]" />
        <span className="text-sm font-semibold">issues</span>
        {ws?.slug && (
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Search workspace"
          >
            <Search size={18} />
          </button>
        )}
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute left-0 top-0 h-full w-64 border-r border-sidebar-border bg-sidebar shadow-xl"
            >
              {sidebar}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} workspaceSlug={ws?.slug} />

      {/* Main content — CSS-based page fade (avoids React 18 concurrent-mode flash) */}
      <main key={pathname} className="page-fade-in lg:ml-60">
        {/* Temporary: the CLI-only migration notice, owners only. Delete this
            line and the component when the 30-day window closes. */}
        {children}
      </main>
    </div>
  )
}
