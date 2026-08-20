'use client'

// The frame every dashboard page sits in: fixed left sidebar, content right.
//
// ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
// **No workspace switcher and no create-workspace flow** (D-3). Sales keeps
// workspaces in the data model — every route is `/api/workspaces/{ws}/…`, every
// URN embeds the slug — and takes them out of the UI. A human working here sees
// a single-tenant product; the platform sees no change at all. `app/dashboard/
// page.tsx` resolves the one workspace and redirects.
//
// **No AI, no chat box, no approve button** (§1.2 rule 1). The mockup shipped an
// approval UI twice by accident and removed it twice; the shell is where such a
// thing would naturally be bolted on, so it is worth saying here.
//
// ── DENSITY IS A COMPONENT CONVENTION, AND THIS IS WHERE IT IS SET ──────────
// D-4 gives sales `h-12` header and `py-3` rows against issues' `h-11` and tight
// ones. Tokens cannot express that — `--radius` and the palette are in
// globals.css, but spacing is chosen per component — so the header height below
// and the row padding in every listing are the carriers.

import { createContext, useContext, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  Building2,
  CalendarClock,
  FileText,
  FolderOpen,
  History,
  LogOut,
  MessagesSquare,
  Moon,
  Package,
  Target,
  Menu,
  Search,
  Settings as SettingsIcon,
  Sun,
  Sparkles,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { useMe } from '@/lib/hooks'
import { CommandPalette } from './command-palette'

/** `seg` is the path under `/dashboard/{ws}`; '' is Today. */
interface NavEntry {
  seg: string
  label: string
  icon: LucideIcon
}

const NAV_MAIN: NavEntry[] = [
  { seg: '', label: 'Today', icon: Sparkles },
  { seg: '/metrics', label: 'Metrics', icon: BarChart3 },
  { seg: '/prospects', label: 'Prospects', icon: Building2 },
  { seg: '/meetings', label: 'Meetings', icon: CalendarClock },
  { seg: '/communications', label: 'Communications', icon: MessagesSquare },
  // Activity landed with the route it needs. It was deliberately absent until
  // then — a nav item pointing at a page with no data source is a 404 wearing a
  // working app's clothes, installed in the chrome every page inherits — and
  // `app/api/workspaces/[ws]/activity/route.ts` is what changed. The rule that
  // kept it out is the rule that puts it in.
  { seg: '/activity', label: 'Activity', icon: History },
]

const NAV_CATALOG: NavEntry[] = [
  { seg: '/products', label: 'Products', icon: Package },
  // A strategy is not a thing we sell, so it is not strictly catalog — but it
  // is what you read BEFORE choosing which product to pitch, and it sits beside
  // the products it names rather than among the daily pipeline pages.
  { seg: '/strategies', label: 'Strategies', icon: Target },
  { seg: '/templates', label: 'Templates', icon: FileText },
  { seg: '/documents', label: 'Documents', icon: FolderOpen },
]

// Neither of these is a catalog and neither is somewhere anybody navigates
// daily, which is why they sit below the rule rather than in NAV_MAIN. Both ARE
// linked, because a page reachable only by typing its URL is a page nobody uses
// — the mirror of the nav-item-with-no-route problem above.
//
// Members arrived here on 2026-08-11 from `/dashboard/settings/members`, where
// it was filed beside four ACCOUNT pages while being the only workspace-scoped
// one of the five. Above Trash: it is the one of the two people actually open.
const NAV_UTILITY: NavEntry[] = [
  { seg: '/members', label: 'Members', icon: Users },
  { seg: '/trash', label: 'Trash', icon: Trash2 },
]

/**
 * The header title.
 *
 * Derived from the nav table for the pages that are IN it, and overridable for
 * the ones that are not — a prospect detail page's title is a company name and
 * no static table can hold it. Defaulting to the nav label rather than requiring
 * every page to set one means a new page gets a correct header for free and a
 * forgotten `usePageTitle` shows the section name, not an empty bar.
 */
const PageTitleContext = createContext<(title: string | null) => void>(() => {})

export function usePageTitle(title: string | null) {
  const set = useContext(PageTitleContext)
  useEffect(() => {
    set(title)
    return () => set(null)
  }, [set, title])
}

/**
 * `usePageTitle` as a component, for a subtree whose pages are SERVER
 * components and therefore cannot call a hook. `/dashboard/settings/*` is the
 * case: its layout is a server component that mounts the shell, and without
 * this the header would fall back to the nav lookup, find no entry for a path
 * outside `/dashboard/{ws}`, and read `b/sales` on every settings page.
 *
 * Renders nothing. Safe outside a shell too — `PageTitleContext`'s default is a
 * no-op, which is exactly the case where settings renders with no workspace.
 */
export function PageTitle({ title }: { title: string }) {
  usePageTitle(title)
  return null
}

export function SalesShell({
  ws,
  workspaces = [],
  children,
}: {
  ws: string
  workspaces?: SwitcherWorkspace[]
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const base = `/dashboard/${ws}`
  const [mobileOpen, setMobileOpen] = useState(false)
  const [override, setOverride] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // ⌘K / Ctrl-K. Bound at the window so it works from anywhere on the page, and
  // `preventDefault` because ⌘K is Safari's address-bar search — without it the
  // palette opens behind the browser stealing focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navTitle =
    [...NAV_MAIN, ...NAV_CATALOG, ...NAV_UTILITY].find((e) => isActive(pathname, base, e.seg))
      ?.label ?? 'b/sales'

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href={base}
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4"
      >
        {/* The real mark, not a text `b/` badge — see the matching note in
            apps/issues' `dashboard-layout.tsx`. The badge was drawn in
            `--sidebar-primary`, which is this app's emerald; the file
            (`public/logo.png`, arrived 2026-08-11) is the blackcode mark both
            apps carry, and the app word beside it is where the difference
            belongs. The palette stays sales' everywhere else — D-4 is about the
            product's colour, not about its logo. */}
        <Image src="/logo.png" alt="b/" width={22} height={22} className="rounded-[14%]" />
        <span className="text-[15px] font-semibold tracking-tight">sales</span>
      </Link>

      {/* Renders nothing for a single workspace — see workspace-switcher.tsx.
          Above the nav rather than in the footer because it scopes everything
          below it: every NavLink is `/dashboard/{ws}/…`. */}
      <WorkspaceSwitcher workspaces={workspaces} current={ws} />

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          {NAV_MAIN.map((e) => (
            <NavLink key={e.seg} entry={e} base={base} pathname={pathname} />
          ))}
        </div>

        <p className="px-2.5 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Catalog
        </p>
        <div className="space-y-0.5">
          {NAV_CATALOG.map((e) => (
            <NavLink key={e.seg} entry={e} base={base} pathname={pathname} />
          ))}
        </div>

        <div className="mt-5 space-y-0.5 border-t border-sidebar-border pt-3">
          {NAV_UTILITY.map((e) => (
            <NavLink key={e.seg} entry={e} base={base} pathname={pathname} />
          ))}
        </div>
      </nav>

      <AccountFooter />
    </div>
  )

  return (
    <PageTitleContext.Provider value={setOverride}>
      <div className="min-h-screen bg-background">
        {/* Desktop rail */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-sidebar-border lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="Close menu"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-60 border-r border-sidebar-border">
              {sidebar}
            </aside>
          </div>
        )}

        <div className="lg:pl-56">
          {/* h-12, the sales density (D-4). Sticky, so the section name stays
              visible down a long ledger. */}
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
            <button
              onClick={() => setMobileOpen(true)}
              className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={17} />
            </button>
            <h1 className="truncate text-sm font-medium text-foreground">{override ?? navTitle}</h1>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Search size={14} />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden rounded border border-border px-1 font-sans text-[10px] sm:inline">
                  ⌘K
                </kbd>
              </button>
              <ThemeToggle />
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>

        <CommandPalette ws={ws} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </PageTitleContext.Provider>
  )
}

/**
 * Active-state matching.
 *
 * Today (`seg: ''`) is an EXACT match and everything else is a prefix, because a
 * plain `startsWith` would light Today up on every page under it. The prefix has
 * to be boundary-aware too: `/prospects` must not match `/prospects-archive`,
 * and a listing gaining a sibling route is exactly how that becomes true later.
 */
function isActive(pathname: string, base: string, seg: string): boolean {
  const href = base + seg
  if (seg === '') return pathname === base || pathname === base + '/'
  return pathname === href || pathname.startsWith(href + '/')
}

function NavLink({ entry, base, pathname }: { entry: NavEntry; base: string; pathname: string }) {
  const active = isActive(pathname, base, entry.seg)
  const Icon = entry.icon
  return (
    <Link
      href={base + entry.seg}
      aria-current={active ? 'page' : undefined}
      className={
        // py-2 rather than issues' py-1.5 — roomier is the point (D-4).
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ' +
        (active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground')
      }
    >
      <Icon size={16} className={active ? 'text-sidebar-primary' : ''} />
      {entry.label}
    </Link>
  )
}

// The Settings link went in with the pages, which is the rule that kept it out.
// It points at `/dashboard/settings/*` — outside the workspace segment, because
// three of its four pages are about the blackcode ACCOUNT rather than about this
// workspace, and the fourth (preferences) says which workspace it is setting.
//
// It was three of FIVE until 2026-08-11, when members moved into the sidebar
// above: the odd one out was the workspace-scoped page, and it left.
function AccountFooter() {
  const { data: session } = useSession()
  const me = useMe()
  // The live row wins; the session is the fallback for the moment before it
  // arrives. The session's copy is minted at sign-in and never refreshed (see
  // `useMe`), so drawing from it alone showed a photo — or an initial — that
  // could be weeks old, including one set in another blackcode app.
  const user = {
    name: me.data?.name ?? session?.user?.name,
    email: me.data?.email ?? session?.user?.email,
    image: me.data?.avatar_url ?? session?.user?.image,
  }
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2.5">
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
        {/* The signed-in person's PHOTO, since 2026-08-11. This was one grey
            initial and no image — the account carries `avatar_url` (it is on the
            session as `image`), and the sidebar simply never read it, so a
            person who had uploaded a photo in either app saw a letter here.
            `MemberAvatar` falls back to two initials on a colour derived from
            the label, so the no-photo case is still distinguishable between two
            teammates whose names start with the same letter. */}
        <MemberAvatar
          name={user?.name}
          email={user?.email}
          avatarUrl={user?.image}
          size={28}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user?.name ?? 'Signed in'}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{user?.email}</span>
        </span>
      </div>
      <Link
        href="/dashboard/settings/profile"
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <SettingsIcon size={15} />
        Settings
      </Link>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <LogOut size={15} />
        Sign out
      </button>
    </div>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // `next-themes` cannot know the resolved theme until it has read the DOM, so
  // rendering the icon before mount produces a server/client mismatch and a
  // hydration warning. Rendering a same-sized blank keeps the header from
  // shifting when it arrives.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted ? (
        resolvedTheme === 'dark' ? (
          <Sun size={16} />
        ) : (
          <Moon size={16} />
        )
      ) : (
        <span className="block h-4 w-4" />
      )}
    </button>
  )
}
