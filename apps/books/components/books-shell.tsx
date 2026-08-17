'use client'

// The frame every dashboard page sits in: fixed left sidebar, content right.
//
// ===========================================================================
// WHAT IS NOT HERE, AND WHY — decision D-C
// ===========================================================================
// **No workspace switcher, no members page, no invite flow, and the word
// "workspace" appears nowhere on screen.** It is platform tenancy and it names
// nothing in this product. The mockup has no team, no members, no assignee and
// not one human-identity field across its 27 data structures: there is one user,
// many books, and a fiduciary who receives an export rather than a login.
// `[ws]` stays in the URL because the platform route factories require it, and
// it is never explained to the reader. `apps/sales` settled the same point one
// app earlier — its team page says "your team".
//
// **No search.** Nothing in the mockup has one, and a ⌘K palette over data
// nobody has yet is chrome pretending to be a product.
//
// **No chat box, no in-page AI, no what-if buttons.** Agents live outside this
// app and drive it through `bk books`. This is a standing rule of the whole b/
// constellation, not a books preference, and the shell is exactly where such a
// thing gets bolted on — so it is worth saying here.
//
// ===========================================================================
// THE TOP BAR CARRIES A DIMENSION NO OTHER APP ON THIS PLATFORM HAS
// ===========================================================================
// Two of them, in fact: which BOOK and which FISCAL YEAR. Both are filters, not
// navigation — they change the numbers on the screen you are already on, and
// they live in the query string so the address is shareable and Back undoes a
// switch (`lib/scope.ts`).
//
// The book switcher is hidden on the pages `lib/nav.ts` marks unscoped. A
// control that appears to do nothing is worse than an absent one: the reader
// concludes they used it wrong rather than that it did not apply.
//
// The year switcher has ONE option today, and it is built anyway. The API
// already serves an `exercices` list and multi-year is a known coming slice;
// retrofitting a year dimension into nine screens later is the expensive
// version. It renders as a plain label rather than a dead dropdown when there is
// nothing to choose — same rule as the book switcher.
//
// ── DENSITY IS SET HERE ────────────────────────────────────────────────────
// `h-11` header, `py-1.5` rows, `--radius: 0.5rem`. Tighter than sales (h-12,
// py-3, 0.75rem) because every screen in this product is a table of money and
// roominess costs rows on the screen. Tokens cannot express density — the header
// height below and the row padding in `<DataTable>` are the carriers.

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import {
  BookOpen,
  Calculator,
  ChevronDown,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  Paperclip,
  ScanSearch,
  Scale,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { ALL_NAV, NAV, isActive, scopedHref, type NavIconName, type NavItem } from '@/lib/nav'
import { useScope } from '@/lib/scope'
import { useMe } from '@/lib/hooks'

/**
 * The icon per nav entry.
 *
 * `Record<NavIconName, LucideIcon>` is doing real work: `NavIconName` is the
 * union of every icon `lib/nav.ts` names, so adding a nav item with a new icon
 * and forgetting to import it here is a TYPE ERROR rather than a blank square.
 * The alternative — an icon component stored in the nav table — would drag
 * `lucide-react` into every module that wants to know the nav order.
 */
const ICONS: Record<NavIconName, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'scan-search': ScanSearch,
  paperclip: Paperclip,
  'book-open': BookOpen,
  landmark: Landmark,
  scale: Scale,
  'trending-up': TrendingUp,
  calculator: Calculator,
  'messages-square': MessagesSquare,
}

export function BooksShell({
  ws,
  /**
   * The header title, for a subtree the nav table cannot name.
   *
   * `/dashboard/settings/*` is the case: it is a SIBLING of `[ws]`, so no nav
   * entry matches its pathname and the header would otherwise read "b/books" on
   * every settings page. A prop rather than a context, because the page above is
   * a server component and cannot call a hook — `apps/sales` needed a whole
   * `<PageTitle>` component for the same reason, and only because its shell also
   * has to be titled from inside CLIENT pages. This one does not, yet.
   */
  title,
  children,
}: {
  ws: string
  title?: string
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const base = `/dashboard/${ws}`
  const [mobileOpen, setMobileOpen] = useState(false)
  const scope = useScope()
  const drawerRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  /** Closing returns focus to the button that opened it, not to nowhere. */
  const closeDrawer = useCallback(() => {
    setMobileOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Escape, and focus into the drawer on open. See the comment on the overlay.
  useEffect(() => {
    if (!mobileOpen) return
    drawerRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, closeDrawer])

  const current = ALL_NAV.find((e) => isActive(pathname, base, e.seg))

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href={scopedHref(base, '', scope)}
        className="flex h-11 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4"
      >
        {/* The blackcode mark every app carries — `public/logo.png`, the same
            file, not a text badge drawn in this app's amber. The palette is
            where b/books differs; the logo is the family. */}
        <Image src="/logo.png" alt="b/" width={20} height={20} className="rounded-[14%]" />
        <span className="text-[15px] font-semibold tracking-tight">books</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {NAV.map((entry) => (
            <NavLink key={entry.seg} entry={entry} base={base} pathname={pathname} scope={scope} />
          ))}
        </div>
      </nav>

      <AccountFooter />
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-sidebar-border lg:block">
        {sidebar}
      </aside>

      {/* ── MOBILE DRAWER ───────────────────────────────────────────────────
          Escape closes it, and opening it moves focus inside.

          Both were missing and both were found by opening the drawer for the
          first time (F7 of the 2026-08-17 review). The focus half is the one
          worth understanding: this overlay is rendered BEFORE the header in the
          DOM, so its nine links sit before the button that opens it in tab
          order. A keyboard user who opened the drawer and pressed Tab moved
          *away* from it, into the page behind — the menu was open, focused
          nowhere, and unreachable in the direction anybody tabs. Moving focus
          in on open, and back to the trigger on close, is what makes it
          operable at all. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={closeDrawer}
          />
          <aside
            ref={drawerRef}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-60 border-r border-sidebar-border outline-none"
          >
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 flex h-11 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
          <button
            ref={triggerRef}
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu size={17} />
          </button>
          <h1 className="truncate text-sm font-medium text-foreground">
            {title ?? current?.label ?? 'b/books'}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {/* Only on pages whose numbers actually change with the book. A
                titled subtree (settings) is not one of them: it is the account,
                not a book, so the switcher would be a control with no effect. */}
            {title === undefined && (
              <>
                {current?.scoped !== false && <EntitySwitcher scope={scope} />}
                <ExerciceSwitcher scope={scope} />
              </>
            )}
            <ThemeToggle />
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}

function NavLink({
  entry,
  base,
  pathname,
  scope,
}: {
  entry: NavItem
  base: string
  pathname: string
  scope: ReturnType<typeof useScope>
}) {
  const active = isActive(pathname, base, entry.seg)
  const Icon = ICONS[entry.icon]
  return (
    <Link
      // `scopedHref`, not `base + seg`. A bare href drops `?entity=` and sends
      // the reader to the default book — real numbers, wrong company, no
      // indication anything happened. Every internal link goes through it.
      href={scopedHref(base, entry.seg, scope)}
      aria-current={active ? 'page' : undefined}
      className={
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ' +
        (active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground')
      }
    >
      <Icon size={15} className={active ? 'text-sidebar-primary' : ''} />
      {entry.label}
    </Link>
  )
}

/**
 * Which book you are looking at.
 *
 * ── IT DEGRADES RATHER THAN HIDING BEHIND A FLAG (D-D) ─────────────────────
 * Zero books: nothing at all — the page under it is the zero-books screen and a
 * switcher over an empty list is a control with no meaning. One book: a plain
 * label with its accent, because a dropdown with one option is a control that
 * appears broken. Many: the select. Nothing here counts to three, and nothing
 * names a slug.
 *
 * The accent dot is the BOOK's colour (`entity.accent`, served per book), never
 * `--primary`. Amber means "you are in b/books"; the dot means "these numbers
 * belong to this book". Confusing the two is the mistake D-B exists to prevent,
 * and it is easiest to make here, because one seeded book's accent happens to be
 * the app's amber.
 */
function EntitySwitcher({ scope }: { scope: ReturnType<typeof useScope> }) {
  const { entities, entity, record, setEntity } = scope

  if (entities.length === 0) return null

  if (entities.length === 1) {
    return (
      <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-foreground">
        <Dot color={entities[0].accent} />
        {entities[0].name}
      </span>
    )
  }

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Book</span>
      <Dot color={record?.accent} className="pointer-events-none absolute left-2.5" />
      <select
        value={entity ?? ''}
        onChange={(e) => setEntity(e.target.value)}
        className="appearance-none rounded-md border border-border bg-card py-1 pl-6 pr-7 text-[13px] text-foreground outline-none hover:bg-accent focus:border-ring"
      >
        {/* An unknown slug from the URL is kept as an option so the control
            shows what was asked for rather than silently snapping to another
            book. The page beside it says there is no such book. */}
        {record === null && entity && <option value={entity}>{entity} — no such book</option>}
        {entities.map((e) => (
          <option key={e.slug} value={e.slug}>
            {e.name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-muted-foreground" />
    </label>
  )
}

/**
 * Which fiscal year.
 *
 * One option today and built anyway — see the header of this file. It is not
 * hidden when there is one year: unlike the book, the year is a fact the reader
 * needs on the screen (a balance sheet without its year is not a balance sheet),
 * so the single-value case renders it as a label rather than as nothing.
 */
function ExerciceSwitcher({ scope }: { scope: ReturnType<typeof useScope> }) {
  const { exercices, exercice, setExercice } = scope

  if (exercice === null) return null

  if (exercices.length <= 1) {
    return (
      <span className="rounded-md px-2 py-1 text-[13px] tabular-nums text-muted-foreground">
        {exercice}
      </span>
    )
  }

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Fiscal year</span>
      <select
        value={exercice}
        onChange={(e) => setExercice(Number(e.target.value))}
        className="appearance-none rounded-md border border-border bg-card py-1 pl-2.5 pr-7 text-[13px] tabular-nums text-foreground outline-none hover:bg-accent focus:border-ring"
      >
        {exercices.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-muted-foreground" />
    </label>
  )
}

function Dot({ color, className = '' }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={'inline-block size-2 shrink-0 rounded-full ' + className}
      style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}
    />
  )
}

function AccountFooter() {
  const { data: session } = useSession()
  const me = useMe()
  // The live row wins; the session is the fallback for the moment before it
  // arrives. The session's copy is minted at sign-in and never refreshed, so
  // drawing from it alone shows a photo — or an initial — that can be weeks old,
  // including one set in another blackcode app. See `useMe`.
  const user = {
    name: me.data?.name ?? session?.user?.name,
    email: me.data?.email ?? session?.user?.email,
    image: me.data?.avatar_url ?? session?.user?.image,
  }
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
        <MemberAvatar name={user.name} email={user.email} avatarUrl={user.image} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user.name ?? 'Signed in'}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
        </span>
      </div>
      <Link
        href="/dashboard/settings"
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <SettingsIcon size={14} />
        Settings
      </Link>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <LogOut size={14} />
        Sign out
      </button>
    </div>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // `next-themes` cannot know the resolved theme until it has read the DOM, so
  // rendering the icon before mount produces a server/client mismatch and a
  // hydration warning. A same-sized blank keeps the header from shifting.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted ? (
        resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />
      ) : (
        <span className="block h-[15px] w-[15px]" />
      )}
    </button>
  )
}
