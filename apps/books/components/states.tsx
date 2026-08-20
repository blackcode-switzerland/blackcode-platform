'use client'

// One skeleton, one error, one empty — defined here and reused by all thirteen
// screens (`booksFrontend/01-foundation.md` §5).
//
// ===========================================================================
// WHY THESE ARE ONE COMPONENT EACH AND NOT A PATTERN EVERY PAGE REPEATS
// ===========================================================================
// Thirteen screens, each rendering its own "loading…", is thirteen chances for
// one of them to render nothing instead — and a screen that shows an empty table
// while a request is in flight is a screen that says "this book has no
// entries". In a bookkeeping app that is not a cosmetic difference: "no data
// yet" and "no data" are the same pixels and opposite facts.
//
// So the rule is: a component that reads never renders a bare empty. It renders
// `<Loading>`, `<ErrorState>` or `<EmptyState>`, and each of those says which of
// the three it is.
//
// ── AN ERROR SHOWS THE SERVER'S OWN `suggestion` ───────────────────────────
// Every route in this repo serves `{ error, code, suggestion? }`, and the
// suggestion is the difference between a reader stopping and a reader
// recovering. `lib/client.ts` already carries it through on `ApiRequestError`;
// swallowing it here would undo that on the one surface where it is read.

import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react'
import { ApiRequestError } from '@/lib/client'
import { useT } from '@/lib/i18n'

/**
 * The loading pattern: shaped grey bars, not a spinner.
 *
 * A skeleton the size of the thing that is coming keeps the page from jumping
 * when it arrives, and — the reason it matters here — it is visibly NOT a table
 * with no rows in it.
 */
export function Loading({ rows = 6, label }: { rows?: number; label?: string }) {
  const t = useT()
  // A default that is a WORD rather than a prop default, because the default has
  // to be translated and a parameter default is evaluated before any hook can
  // run. Callers that pass a label pass an already-translated one.
  const text = label ?? t('state.loading')
  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-label={text}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded-md bg-muted"
          // A slight taper down the list reads as "more below" rather than as a
          // solid grey block, which at six rows looks like a rendering failure.
          style={{ opacity: 1 - i * 0.1 }}
        />
      ))}
      <span className="sr-only">{text}…</span>
    </div>
  )
}

/**
 * The error pattern.
 *
 * `error` is whatever a query threw. `ApiRequestError` is unwrapped for its
 * message, code and suggestion; anything else falls back to its `message`,
 * because a network failure is not an `ApiRequestError` and rendering "unknown
 * error" for the commonest failure of all would be its own bug.
 */
export function ErrorState({ error, title }: { error: unknown; title?: string }) {
  const t = useT()
  const api = error instanceof ApiRequestError ? error : null
  const message =
    api?.message ?? (error instanceof Error ? error.message : t('state.errorFallback'))
  const heading = title ?? t('state.errorTitle')

  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>
          {api?.suggestion && (
            <p className="mt-1.5 text-sm text-foreground">{api.suggestion}</p>
          )}
          {/* The machine code STAYS here, and only here. F5 of the review asked
              whether it belongs in human copy; the answer differs by box. In the
              two calm notices — a simplified book, a book with no exercice —
              nothing failed, so a code reads as though something did, and they
              dropped it. This box means something genuinely broke, and the code
              is what makes it reportable. */}
          {api?.code && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">{api.code}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The empty pattern — for a list that legitimately has nothing in it.
 *
 * **Not for a statement.** The balance sheet and the income statement of a book
 * with no entries are not empty screens: the legal line list is fixed and every
 * line renders at zero. That is `<StatementTable>`'s job and it has no empty
 * state at all, deliberately.
 */
export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
}: {
  title: string
  children?: React.ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Icon size={20} className="mx-auto text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{children}</div>
      )}
    </div>
  )
}

/**
 * The banner that says the numbers on this page are not real yet.
 *
 * `GET /api/meta` carries `entities.source: "fixture" | "database"` precisely so
 * that a screen shipping against seeded data cannot pretend otherwise, and this
 * is the surface that keeps that promise. It renders nothing once the field
 * flips — so it disappears on the backend's phase 1 with no frontend change,
 * which is the only version of this banner that will not be left behind.
 */
export function FixtureNotice({ source }: { source: 'fixture' | 'database' | null }) {
  const t = useT()
  if (source !== 'fixture') return null
  return (
    <p className="mb-4 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{t('state.seededLead')}</span>{' '}
      {t('state.seededBody')}
    </p>
  )
}

/**
 * A page that exists so its nav item is not a 404, and says so.
 *
 * ── WHY THIS IS NOT A PLACEHOLDER LEFT LYING AROUND ────────────────────────
 * The alternative was to ship the sidebar with nine items and only some of them
 * routed. `apps/sales` has the rule already: a nav item pointing at a page with
 * no data source is a 404 wearing a working app's clothes, installed in the
 * chrome every page inherits.
 *
 * The other alternative — a nav that grows an item per screen — hides the shape
 * of the product from the person using it, and the shape is nine items in a
 * reviewed order (`lib/nav.ts`).
 *
 * So: every item routes, and the ones that are not built yet say exactly what
 * they are waiting for. It is a deliberately conspicuous screen. A page still
 * rendering this once its route exists is a page somebody forgot.
 *
 * ── IT NAMES THE ROUTE IT IS WAITING FOR, NOT A SPRINT ────────────────────
 * The copy said "the screen itself is sprint 2" until 2026-08-18, by which point
 * phase 1 had built five of the screens that sentence covered and the five left
 * were waiting on completely different things — recognition's routes exist but
 * on an unmerged branch, and the other four have no route at all. A page that
 * blames a sprint number tells the reader nothing they can act on, and it goes
 * stale silently. `blocker` is the sentence that says what is actually missing.
 */
export function NotBuiltYet({
  screen,
  mockup,
  blocker,
}: {
  screen: string
  mockup: string
  /** What this screen is waiting for, in one sentence. Required — see above. */
  blocker: string
}) {
  const t = useT()
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{t('state.notBuilt', { screen })}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{blocker}</p>
      {/* The filename is interpolated into ONE sentence rather than assembled
          from two fragments around a `<span>`. French puts "dans le mockup"
          where English puts "in the mockup" and the noun phrase moves with it —
          word order is most of what translating a sentence is, so the whole
          sentence has to be one entry. The monospace styling is lost by doing
          it this way, and that is the trade. */}
      <p className="mx-auto mt-2 max-w-lg font-mono text-[12.5px] text-muted-foreground">
        {t('state.notBuiltLayout', { mockup })}
      </p>
      {/* **No `bk` command is named here, and that is checked rather than
          assumed.** The obvious sentence to write was "until then, read it from
          the terminal with `bk books …`" — and it would be false: as of
          2026-08-17 `bk books` has exactly one entity verb, `note`, which is a
          phase-0 placeholder that gets deleted when the ledger lands
          (`cli/internal/commands/books/books.go`). There is no ledger, no
          balance sheet and no recognition queue behind that binary either.
          A page that offers a recovery which does not exist is worse than one
          that offers none. */}
    </div>
  )
}
