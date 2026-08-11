'use client'

import { useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings,
  LogOut,
  Moon,
  Sun,
  LayoutGrid,
  List,
  Target,
  BarChart3,
  Clock,
  Inbox,
  Users,
  Tag,
  Trash2,
  Menu,
  X,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { WorkspaceSwitcher } from './workspace-switcher'
import { InboxBadge } from './inbox-badge'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const NAV_PRIMARY = [
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox, trailing: true, match: (p: string) => p === '/dashboard/inbox' },
]

// Workspace-scoped nav. `seg` is the path under /dashboard/{ws}; the href and
// active-match are built per-render from the current workspace slug. `countKey`
// maps to the sidebar count badges.
type CountKey = 'projects' | 'tasks' | 'issues' | 'labels' | 'members'
const NAV_WORKSPACE: { seg: string; label: string; icon: LucideIcon; countKey?: CountKey }[] = [
  { seg: '', label: 'Projects', icon: LayoutGrid, countKey: 'projects' },
  { seg: '/tasks', label: 'Tasks', icon: Target, countKey: 'tasks' },
  { seg: '/issues', label: 'Issues', icon: List, countKey: 'issues' },
  { seg: '/labels', label: 'Labels', icon: Tag, countKey: 'labels' },
  { seg: '/members', label: 'Members', icon: Users, countKey: 'members' },
  { seg: '/activity', label: 'Activity', icon: Clock },
  { seg: '/analytics', label: 'Analytics', icon: BarChart3 },
  { seg: '/trash', label: 'Trash', icon: Trash2 },
]


export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const [mobileOpen, setMobileOpen] = useState(false)
  const { confirm } = useConfirm()
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
      const [p, m, i, l, mem] = await Promise.all([
        fetch(`/api/workspaces/${slug}/projects`).then((r) => r.json()).then((j) => (j.data ?? j).length as number),
        fetch(`/api/workspaces/${slug}/tasks`).then((r) => r.json()).then((j) => (j.total ?? j.data?.length ?? 0) as number),
        fetch(`/api/workspaces/${slug}/issues`).then((r) => r.json()).then((j) => (j.total ?? j.data?.length ?? 0) as number),
        fetch(`/api/workspaces/${slug}/labels`).then((r) => r.json()).then((j) => (j.data ?? j).length as number),
        fetch(`/api/workspaces/${slug}/members`).then((r) => r.json()).then((j) => (j.data ?? j).length as number),
      ])
      return { projects: p, tasks: m, issues: i, labels: l, members: mem }
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
          {NAV_PRIMARY.map((item) => (
            <NavItem key={item.href} item={item} active={item.match(pathname ?? '')} />
          ))}
        </div>

        <SectionLabel>This workspace</SectionLabel>
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
                return <NavItem key={item.seg} item={{ href, label: item.label, icon: item.icon }} active={active} count={count} />
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

      {/* User */}
      <div className="border-t border-sidebar-border p-2.5">
        <div className="mb-1 flex items-center gap-2.5 px-1.5 py-1">
          <MemberAvatar
            name={displayName || null}
            email={displayEmail || null}
            avatarUrl={avatarUrl}
            size={30}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">{displayEmail}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1">
          <IconButton title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <Link
            href="/dashboard/settings"
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title="Settings"
          >
            <Settings size={16} />
          </Link>
          <button
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Sign out?',
                  description: 'You will be redirected to the login page.',
                  confirmLabel: 'Sign out',
                }))
              )
                return
              signOut()
            }}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
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

      {/* Main content — CSS-based page fade (avoids React 18 concurrent-mode flash) */}
      <main key={pathname} className="page-fade-in lg:ml-60">
        {/* Temporary: the CLI-only migration notice, owners only. Delete this
            line and the component when the 30-day window closes. */}
        {children}
      </main>
    </div>
  )
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`px-2.5 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground/70 ${className ?? ''}`}>
      {children}
    </p>
  )
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function NavItem({
  item,
  active,
  count,
}: {
  item: { href: string; label: string; icon: LucideIcon; trailing?: boolean }
  active: boolean
  count?: number
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
      }`}
    >
      <Icon size={17} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.trailing ? <InboxBadge /> : null}
      {count != null && !item.trailing ? (
        <span className="text-xs tabular-nums text-muted-foreground/60">{count}</span>
      ) : null}
    </Link>
  )
}
