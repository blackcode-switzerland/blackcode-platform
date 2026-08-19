// The nine sidebar items, their order, and which of them are scoped to a book.
//
// ===========================================================================
// THE ORDER IS THE MOCKUP'S AND IT WAS REVIEWED. DO NOT RE-SORT IT.
// ===========================================================================
// Taken verbatim from the mockup's own `SIDEBAR` config
// (`b-mockups/bbooks/assets/bbooks-data.js`, ~line 1218). It is not
// alphabetical, it is not the backend's phase order, and both of those are
// things somebody will be tempted to make it. Two of its choices carry comments
// in the mockup itself and are repeated here so they survive:
//
//   - **Supporting documents sits THIRD, above the general ledger.** It is as
//     first-class as Recognition, because every entry legally needs its
//     document (art. 958f CO) and burying the inbox below the ledger says the
//     opposite.
//   - **Taxes is deliberately NOT in the nav.** The screen exists and is reached
//     from a cross-link on the overview. Tax TRACKING over time is a different
//     product (b/tax); this is a statutory snapshot.
//   - **There is no "personal view" item.** It was merged into the overview,
//     which carries both the book index and the cross-book rollup.
//
// ── THE URL SEGMENTS ARE ENGLISH (D-A) ─────────────────────────────────────
// The mockup's files are `app-bilan.html`, `app-compte-resultat.html`,
// `app-analytique.html`. Those are French because the mockup was French
// throughout; the interface here is English, so the segments are too. The one
// place French survives is the statutory line labels inside the balance sheet
// and income statement — see `lib/label.ts`.
//
// ── `scoped` IS WHAT THE BOOK SWITCHER READS ───────────────────────────────
// An entity-scoped page's numbers change when you switch book; an unscoped one's
// do not. The switcher is hidden on unscoped pages rather than shown and
// ignored, because a control that appears to do nothing is worse than an absent
// one — the reader assumes they used it wrong.

/** The lucide icon names the shell must supply a component for. */
export type NavIconName =
  | 'layout-dashboard'
  | 'scan-search'
  | 'paperclip'
  | 'book-open'
  | 'landmark'
  | 'scale'
  | 'trending-up'
  | 'calculator'
  | 'messages-square'

export interface NavItem {
  /** The path under `/dashboard/{ws}`. `''` is the overview. */
  seg: string
  label: string
  icon: NavIconName
  /** Does switching book change what this page shows? */
  scoped: boolean
}

export const NAV: readonly NavItem[] = [
  { seg: '', label: 'Overview', icon: 'layout-dashboard', scoped: false },
  { seg: '/recognition', label: 'Recognition', icon: 'scan-search', scoped: true },
  // `scoped: false` since 2026-08-18, when the pièces inbox was built here.
  // `books.piece_inbox.entity_id` is NULLABLE — a scanned receipt does not
  // always say whose it is — so the screen serves the WHOLE inbox and carries
  // the book as a column. A switcher over a list it does not filter is the
  // control this file's header warns about: the reader assumes they used it
  // wrong. The register on `/sources` has the same shape and keeps `true` only
  // because the chart of accounts above it really is per book.
  { seg: '/documents', label: 'Supporting documents', icon: 'paperclip', scoped: false },
  { seg: '/ledger', label: 'General ledger', icon: 'book-open', scoped: true },
  // `scoped: true` since 2026-08-18, when the CHART half of this screen was
  // built. It was `false` on the reasoning that a source is a channel money
  // arrives through and one channel feeds several books — true of sources, and
  // not true of the chart of accounts, which is copied per book at creation.
  // The flag is what hides the book switcher, so leaving it would have shipped a
  // page whose content changes per book with no control to change it. Phase 3
  // puts the sources on the same screen and makes this a real question again.
  { seg: '/sources', label: 'Accounts & sources', icon: 'landmark', scoped: true },
  { seg: '/balance-sheet', label: 'Balance sheet', icon: 'scale', scoped: true },
  { seg: '/income-statement', label: 'Income statement', icon: 'trending-up', scoped: true },
  { seg: '/management', label: 'Management view', icon: 'calculator', scoped: true },
  { seg: '/analyses', label: 'Analyses', icon: 'messages-square', scoped: true },
]

/**
 * Reachable, but not in the nav. Listed so that the shell can still title the
 * page correctly and the active state does not simply go blank when a reader
 * follows the overview's cross-link.
 */
export const OFF_NAV: readonly NavItem[] = [
  { seg: '/taxes', label: 'Taxes', icon: 'calculator', scoped: true },
  /**
   * Patrimoine — art. 957 al. 2's other half, and a screen the mockup never had.
   *
   * OFF-NAV rather than a tenth item, on the same reasoning that keeps Taxes
   * out: it applies to SIMPLIFIED books only, and a permanent sidebar item that
   * is meaningless for most of a person's books is a control that teaches the
   * reader to ignore the sidebar. It is reached from the two places it is
   * actually the answer — the balance sheet's refusal for a simplified book, and
   * that book's card on the overview.
   *
   * `scoped: true`: it is entirely a property of one book.
   */
  { seg: '/patrimoine', label: 'Patrimoine', icon: 'scale', scoped: true },
  /**
   * The compliance register — nineteen statutory rules and their sign-off.
   *
   * OFF-NAV for Taxes' reason and one of its own. It is not part of a person's
   * working loop: a fiduciary signs a rule off once and does not come back
   * daily, and a permanent item would teach the reader to skip past the sidebar.
   *
   * **`scoped: false`, and it is the only item in this file where that is true
   * of the DATA rather than of the screen.** `GET /api/compliance-rules` is not
   * under `/api/workspaces/{ws}/` at all: the same law binds every book, so
   * there is no book to filter by and the switcher is hidden rather than shown
   * and ignored — this file's own rule about a control that appears to do
   * nothing.
   */
  { seg: '/compliance', label: 'Compliance rules', icon: 'scale', scoped: false },
]

export const ALL_NAV: readonly NavItem[] = [...NAV, ...OFF_NAV]

/**
 * Is this pathname on this nav entry?
 *
 * The overview (`seg: ''`) is an EXACT match and everything else is a
 * boundary-aware prefix. A plain `startsWith` would light the overview up on
 * every page under it, and a non-boundary prefix would light `/ledger` on a
 * future `/ledger-archive`. Both are how `apps/sales` got this wrong once.
 */
export function isActive(pathname: string, base: string, seg: string): boolean {
  const href = base + seg
  if (seg === '') return pathname === base || pathname === base + '/'
  return pathname === href || pathname.startsWith(href + '/')
}

/**
 * A link that KEEPS the current book and year.
 *
 * The scope lives in the query string (`lib/scope.ts`), so a plain `<Link>`
 * between two pages drops it and silently sends the reader back to the default
 * book. Every internal link in the dashboard goes through here.
 *
 * `extra` is for a page's own filters — the income statement drilling into the
 * ledger passes `{ account: '6570' }`.
 */
export function scopedHref(
  base: string,
  seg: string,
  scope: { entity: string | null; exercice: number | null },
  extra?: Record<string, string | number | null | undefined>
): string {
  const params = new URLSearchParams()
  if (scope.entity) params.set('entity', scope.entity)
  if (scope.exercice != null) params.set('exercice', String(scope.exercice))
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== null && v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${base}${seg}?${qs}` : `${base}${seg}`
}
