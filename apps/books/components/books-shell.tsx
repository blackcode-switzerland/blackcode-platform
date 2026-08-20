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

import * as React from 'react'
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
import { useScope, WorkspaceSlugProvider } from '@/lib/scope'
import { useMe } from '@/lib/hooks'

/**
 * A heading a CLIENT page sets for itself.
 *
 * ── THE COMMENT ON `title` BELOW SAID "THIS ONE DOES NOT, YET" ─────────────
 * It does now. The shell titles itself from `lib/nav.ts`, which is right for
 * nine screens and wrong for one: since phase 4A the ledger shows a grand livre
 * or a recettes-dépenses journal depending on the book, and "General ledger"
 * over the RI book names a document that book does not keep.
 *
 * The ledger tried to fix this by passing a title to `<ScreenFrame>`, which uses
 * it only to label loading and error states — so the ternary was written, was
 * correct, and rendered nowhere. Found by the phase-4A review, which read the
 * H1 rather than the code that meant to set it.
 *
 * A context rather than a prop because the layout that mounts the shell is a
 * server component and the fact it needs is resolved in the client. `apps/sales`
 * reached the same place by the same road.
 */
const PageTitle = React.createContext<((t: string | null) => void) | null>(null)

/** Set this screen's heading. Pass null to fall back to the nav label. */
export function usePageTitle(title: string | null) {
  const set = React.useContext(PageTitle)
  React.useEffect(() => {
    set?.(title)
    return () => set?.(null)
  }, [set, title])
}

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

/**
 * The shell, and the one place the workspace slug enters the client.
 *
 * It only provides the context and renders the body. `useScope` — which the body
 * and every page below it call — needs the slug now that phase 1 made the books
 * and the fiscal years workspace-scoped rows, and this component is the only
 * thing that has it: `/dashboard/settings` mounts the same shell with a real
 * slug resolved on the server, so the pathname is not a source for it.
 */
export function BooksShell({
  ws,
  title,
  children,
}: {
  ws: string
  title?: string
  children: React.ReactNode
}) {
  const [pageTitle, setPageTitle] = React.useState<string | null>(null)
  return (
    <WorkspaceSlugProvider value={ws}>
      <PageTitle.Provider value={setPageTitle}>
        <ShellBody ws={ws} title={title ?? pageTitle ?? undefined}>
          {children}
        </ShellBody>
      </PageTitle.Provider>
    </WorkspaceSlugProvider>
  )
}

function ShellBody({
  ws,
  /**
   * The header title, for a subtree the nav table cannot name.
   *
   * `/dashboard/settings/*` is the case: it is a SIBLING of `[ws]`, so no nav
   * entry matches its pathname and the header would otherwise read "b/books" on
   * every settings page. A prop rather than a context, because the page above is
   * a server component and cannot call a hook.
   *
   * **"This one does not, yet" — it does since 2026-08-19.** A client page can
   * now set its own heading with `usePageTitle`, and this prop still wins when
   * both are present, because a server layout naming its subtree is the more
   * specific claim. See the context above.
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
          {/* `min-w-0` on both halves, so the flex row can actually shrink.
              Without it the header was 402px wide in a 390px viewport and the
              whole PAGE scrolled sideways — measured at 390×844 on 2026-08-18.
              A page that scrolls horizontally on a phone is the platform's one
              hard layout rule (docs/frontend.md), and the title, not the
              controls, is what gives way: the book and the year are the two
              facts that say which document is on screen. */}
          <h1 className="min-w-0 truncate text-sm font-medium text-foreground">
            {title ?? current?.label ?? 'b/books'}
          </h1>
          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
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
    <label className="relative flex min-w-0 shrink items-center">
      <span className="sr-only">Book</span>
      <Dot color={record?.accent} className="pointer-events-none absolute left-2.5" />
      <select
        value={entity ?? ''}
        onChange={(e) => setEntity(e.target.value)}
        className="max-w-[6.5rem] appearance-none truncate sm:max-w-[12rem] rounded-md border border-border bg-card py-1 pl-6 pr-7 text-[13px] text-foreground outline-none hover:bg-accent focus:border-ring"
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
 * Which fiscal year — and whether that year is still open.
 *
 * One option today and built anyway — see the header of this file. It is not
 * hidden when there is one year: unlike the book, the year is a fact the reader
 * needs on the screen (a balance sheet without its year is not a balance sheet),
 * so the single-value case renders it as a label rather than as nothing.
 *
 * ===========================================================================
 * WHERE THE CLOSED-YEAR FACT IS SAID, AND WHERE IT DELIBERATELY IS NOT
 * ===========================================================================
 * `bk books exercice close` landed 2026-08-20 and **there is no reopen, by
 * design**. A closed exercice is filed: nothing may be posted into it, and every
 * figure a screen draws from it is final rather than in progress. Until now
 * `lib/scope.ts` reduced the year list to `number[]` and the distinction was
 * rendered as nothing anywhere in the product.
 *
 * **IT IS SAID HERE**, in both branches — the `<select>` and the single-year
 * label — because this control is the thing on screen that NAMES the year, it is
 * in the header of every book-scoped page, and a reader who can change the year
 * is exactly the reader who needs to know which one they moved to. Saying it in
 * one place that is always present beats saying it in eight that are not.
 *
 * **IT IS ALSO SAID ON THE THREE STATUTORY DOCUMENTS** — bilan, compte de
 * résultat, patrimoine — through `<StatementHeading>`. Those pages are the ones
 * a person prints, screenshots and sends to a fiduciary, and a statement of a
 * filed year is a different document from a draft of the same numbers. The
 * heading already carries "which document is this"; the status is part of that
 * answer and not decoration on top of it.
 *
 * **IT IS DELIBERATELY NOT SAID** on the ledger, the worklist, recognition,
 * documents, sources, analyses or management. Those are working screens, the
 * header above them already carries the year and its status on every one, and a
 * second badge per screen would be seven more wordings of one legal fact — with
 * the one that goes stale being ours. That is the same reasoning
 * `<SimplifiedBookNotice>` uses for printing the SERVER's sentence rather than a
 * second copy of it.
 *
 * **The one thing that would change this decision** is a write affordance on a
 * working screen. There is none today — every write into a book is CLI-only
 * (phase-6 README §6) — but the moment a "post this entry" button exists on the
 * ledger, that button must consult `scope.exerciceStatus` and say why it is not
 * available, because a refusal the reader cannot predict is worse than a badge.
 *
 * ── `'closed'` IS TESTED FOR, NEVER `!== 'open'` ───────────────────────────
 * `exerciceStatus` is `null` in three situations and none of them means open —
 * the years have not arrived, the book has none, or two books disagree. See
 * `lib/scope.ts`. A `!== 'open'` test would mark an unknown year as filed.
 */
function ExerciceSwitcher({ scope }: { scope: ReturnType<typeof useScope> }) {
  const { exerciceOptions, exercice, exerciceStatus, setExercice } = scope

  if (exercice === null) return null

  if (exerciceOptions.length <= 1) {
    return (
      <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] tabular-nums text-muted-foreground">
        {exercice}
        {exerciceStatus === 'closed' && <ClosedYearChip />}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 shrink items-center gap-1.5">
      <label className="relative flex min-w-0 shrink items-center">
        <span className="sr-only">Fiscal year</span>
        <select
          value={exercice}
          onChange={(e) => setExercice(Number(e.target.value))}
          className="appearance-none rounded-md border border-border bg-card py-1 pl-2.5 pr-7 text-[13px] tabular-nums text-foreground outline-none hover:bg-accent focus:border-ring"
        >
          {/* An `<option>` cannot hold the chip, so a closed year says so in
              WORDS inside the list. The chip beside the control then repeats it
              for the selected year — the list is only visible while it is open,
              and the fact has to survive it closing. */}
          {exerciceOptions.map((o) => (
            <option key={o.year} value={o.year}>
              {o.status === 'closed' ? `${o.year} — closed` : o.year}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-2 text-muted-foreground" />
      </label>
      {exerciceStatus === 'closed' && <ClosedYearChip />}
    </span>
  )
}

/**
 * "CLOSED" beside a year.
 *
 * Muted rather than red or amber. A closed exercice is the NORMAL end state of a
 * fiscal year — it is what filing looks like — and dressing it as a warning is
 * how a reader learns to ignore the badges that are one. Same argument as
 * `<Money>`'s note on negatives.
 *
 * The `title` carries the consequence, because the word alone does not say that
 * it cannot be undone.
 */
function ClosedYearChip() {
  return (
    <span
      className="rounded border border-border px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground"
      title="This fiscal year has been closed. Nothing can be posted into it, and there is no reopen."
    >
      closed
    </span>
  )
}

/**
 * The book's accent dot.
 *
 * `color` is `string | null | undefined` because `entity.accent` is NULLABLE on
 * the wire — only the seeded books carry one, and `bk books entity create` sets
 * none. A book with no accent gets the muted foreground, which reads as "no
 * colour chosen" rather than as a rendering failure.
 */
function Dot({ color, className = '' }: { color?: string | null; className?: string }) {
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
