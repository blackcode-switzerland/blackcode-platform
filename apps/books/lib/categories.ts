// The starting analytique categories: the cost buckets a new book begins with.
//
// ===========================================================================
// THE SEED HID THIS ONE TOO, EXACTLY AS IT HID THE CHART
// ===========================================================================
// `lib/chart.ts` exists because `createEntity` produced books that could hold
// no posting, and its header names the reason it went unnoticed: "The seed hid
// it. It inserts the mockup's accounts into each of its three books directly,
// so every test and every screen worked."
//
// The analytique categories are the same omission one layer up. `seed.ts:807`
// installs these five into every seeded double-entry book, and `createEntity`
// installed none — so `bk books analytique` on a book a person actually created
// returned an EMPTY cost breakdown. Not an error and not a refusal: the monthly
// flows still computed, because those are derived from account classes, and the
// breakdown beside them was simply blank forever.
//
// Measured 2026-08-20 on a book created through the app.
//
// ===========================================================================
// WHY A TEMPLATE, AND NOT A MIGRATION LIKE THE COMPLIANCE RULES
// ===========================================================================
// 0017 could carry the nineteen compliance rules because they are GLOBAL: law
// text, workspace-less, one row set for the whole deployment.
//
// A category is not. `books.analytique_category` is keyed `(entity_id, key)`
// and cascades from a book — these rows BELONG to one book, which is the point:
// a bakery and a software company do not group their costs the same way, and
// `bk books category create` exists so each can say so. Shared rows in a table
// would make one book's edit everybody's, which is the same argument
// `lib/chart.ts` makes for the chart being a template rather than a table.
//
// So this is copied per book at creation, and afterwards those rows are that
// book's own. Editing this file changes what NEW books start with and touches
// no existing one. For the books that already exist at a cutover, the backfill
// is `docs/sql/books-categories-backfill.sql` — deliberately a separate
// artifact, because retro-fitting rows into live books is a decision somebody
// makes on purpose, not a side effect of deploying.
//
// ===========================================================================
// SIMPLIFIED BOOKS GET NONE, AND THAT IS NOT AN OVERSIGHT
// ===========================================================================
// An RI keeping recettes-dépenses carries its category ON THE ENTRY, as free
// text, and `getAnalytique` branches to `costBreakdownRi` for it. There is no
// account mapping to configure, which is exactly what `createCategory` refuses
// with `ri_no_categories`.
//
// The test is the REGIME, not the legal form. `seed.ts` writes
// `if (e.legal_form === 'RI') continue`, and that is subtly wrong for a case
// this app supports on purpose: an RI may elect double entry (art. 957 al. 2,
// `entity.regime_election`), and such a book derives its breakdown through the
// account-mapped path like any other. `createEntity`'s own header makes the
// same point about the chart — "an election should not also mean provisioning
// a chart by hand".
//
// ===========================================================================
// THE FIVE, AND WHY THESE FIVE
// ===========================================================================
// Every account named here is in `PME_CHART`, so the set is coherent for any
// book created with the template. `categories.test.ts` pins that, and pins the
// set against `fixtures/mockup.json` so a runtime-created book and a seeded one
// group their costs identically — the same reasoning `chart.test.ts` gives.
//
// `autres` is the catch-all and is what keeps the breakdown honest: without it
// a charge on 6800 or 8900 would sit in no bucket and quietly not be counted.
// The template is NOT read from the fixture: that file is development data and
// the runtime create path must not import it.

/** A category label. `{fr, en}` — both translated in full, unlike an account. */
export interface CategoryLabel {
  fr: string
  en: string
}

export interface CategoryTemplate {
  /** Stable machine key, lowercase — `createCategory`'s `bad_key` rule. */
  key: string
  label: CategoryLabel
  /** Ledger accounts this bucket collects. All must be `cr` accounts. */
  accounts: string[]
}

export const DEFAULT_CATEGORIES: readonly CategoryTemplate[] = [
  {
    key: 'personnel',
    label: { fr: 'Personnel', en: 'People' },
    accounts: ['5000', '5700'],
  },
  {
    key: 'bureau',
    label: { fr: 'Bureau & loyer', en: 'Office & rent' },
    accounts: ['6000'],
  },
  {
    key: 'it_ai',
    label: { fr: 'IT & outils (incl. IA)', en: 'IT & tooling (incl. AI)' },
    accounts: ['6570'],
  },
  {
    key: 'admin',
    label: { fr: 'Admin & fiduciaire', en: 'Admin & fiduciary' },
    accounts: ['6500'],
  },
  {
    // The catch-all. See the header: without it, a charge on an account no
    // other bucket names is silently absent from the breakdown.
    key: 'autres',
    label: { fr: 'Autres charges', en: 'Other charges' },
    accounts: ['4400', '6800', '6900', '8500', '8900'],
  },
] as const

/**
 * Does this book get the template?
 *
 * The REGIME decides, not the legal form — see the header. A simplified book
 * carries its category on the entry instead.
 */
export function takesDefaultCategories(bookkeepingRegime: string): boolean {
  return bookkeepingRegime !== 'simplified'
}
