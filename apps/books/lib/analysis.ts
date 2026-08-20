// The analyses journal's guards. **Pure functions, because a guard that lives
// in JSX is a guard only a browser can check.**
//
// ===========================================================================
// WHY THIS FILE EXISTS AT ALL
// ===========================================================================
// Phase 4B shipped `AnalytiqueCategory.accounts: string[] | null` with the null
// check written inline in the render. Loosening the type and dropping the check
// was TWO edits that left `npm run typecheck` and all 372 tests green while
// white-screening a book. The fix was to make it a pure function with a test
// (`accountsLabel`), and the phase-5 brief names the two fields here that have
// the same shape: `based_on` and `figures` are nullable `jsonb`.
//
// `lib/db/schema.ts` declares every jsonb column WITHOUT `.$type<>()`, so both
// arrive as `unknown` and `lib/wire-parity.test.ts` structurally cannot hold a
// shape assertion over them (#55). That makes this file — not the type, not the
// suite — the only thing standing between a malformed record and a screen that
// renders `undefined`.
//
// ===========================================================================
// AND NOTHING HERE PARSES A FILED VALUE
// ===========================================================================
// `GET …/analyses/{n}`'s own header: *"the `based_on` snapshot exactly as it was
// filed. NEVER recomputed — a stored answer that silently reflows is a different
// answer."* A `value` is text an agent wrote — `"≈ CHF 97'100"`,
// `"15% → 4'500 × 1.15 = 5'175"`, `"13.7 → 6.9 mois"` — and this module reads
// it, checks it is a non-empty string, and hands it on untouched. It never
// reaches `amount()`, never reaches `<Money>`, and is never re-grouped or
// re-rounded. **Reformatting a filed figure is editing the record.**

import type { AnalysisFigure, Label } from './types'

/** A `{fr, en}` pair with at least one side that says something. */
function isLabel(v: unknown): v is Label {
  if (!v || typeof v !== 'object') return false
  const o = v as { fr?: unknown; en?: unknown }
  const speaks = (x: unknown) => typeof x === 'string' && x.trim().length > 0
  return speaks(o.fr) || speaks(o.en)
}

/**
 * One `figures` / `based_on` row, or null when the record does not hold one.
 *
 * The route refuses a `based_on` item with no label or no value at WRITE time
 * (`based_on_incomplete`), which is the right place for it — and this is the
 * read side, which cannot assume the write side was the only writer: the seed
 * inserts these rows directly, and `bk books analyse record` is not the only
 * way a row has ever arrived. A row that fails this is DROPPED and counted, not
 * rendered blank; see `analysisRows`.
 *
 * ── A LABEL MAY BE A BARE STRING ─────────────────────────────────────────
 * The door's `speaks()` accepts `"runway now (months)"` as readily as
 * `{fr, en}`, and the FIRST real agent filing (analysis #3, 2026-08-19) used
 * bare strings — this screen dropped all thirteen rows of a valid record.
 * A bare string renders as itself on both language sides; that is display
 * shaping, not an edit — the record stays as filed. (A bare NUMBER as `value`
 * is a separate seam: the door accepts one, this screen still drops and counts
 * it — flagged on #56 for one decision rather than changed unilaterally here.)
 */
function figureOf(v: unknown): AnalysisFigure | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { label?: unknown; value?: unknown; href?: unknown }
  const label: Label | null = isLabel(o.label)
    ? o.label
    : typeof o.label === 'string' && o.label.trim() !== ''
      ? { fr: o.label, en: o.label }
      : null
  if (!label) return null
  // A value is text and stays text. `0` and `false` are not values an agent
  // filed — every seeded one is a formatted string — so anything that is not a
  // non-empty string is a row this screen cannot show honestly.
  if (typeof o.value !== 'string' || o.value.trim() === '') return null
  return {
    label,
    value: o.value,
    href: typeof o.href === 'string' && o.href.trim() !== '' ? o.href : null,
  }
}

/**
 * What a screen may render, and what it must SAY it could not.
 *
 * ── THE DROPPED COUNT IS NOT A DETAIL ────────────────────────────────────
 * A snapshot is the whole point of the record. Silently rendering three of four
 * rows would make an answer look better-founded than it is — the reader would
 * see a complete-looking provenance table over an incomplete one. So the count
 * comes back and the screen states it.
 */
export interface AnalysisRows {
  rows: AnalysisFigure[]
  /** Rows the record holds that this app could not read. Rendered when > 0. */
  dropped: number
}

export function analysisRows(value: unknown): AnalysisRows {
  // `null`, `undefined` and a non-array are all "the column holds nothing this
  // screen can list". They are NOT an empty snapshot — see `hasSnapshot`.
  if (!Array.isArray(value)) return { rows: [], dropped: 0 }
  const rows: AnalysisFigure[] = []
  let dropped = 0
  for (const item of value) {
    const row = figureOf(item)
    if (row) rows.push(row)
    else dropped += 1
  }
  return { rows, dropped }
}

/**
 * Does this record carry a `based_on` snapshot at all?
 *
 * **Distinct from `rows.length > 0`**, and the distinction is the point of the
 * screen: an analysis filed WITHOUT a snapshot is an answer whose inputs nobody
 * recorded, which is a different and more serious thing than one whose snapshot
 * this app could not parse. The column is `NOT NULL` today and the route
 * requires the field — so a false here means the record predates that or was
 * written by something else, and the screen says which.
 */
export function hasSnapshot(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

// ===========================================================================
// THE BOOK, TODAY — AND WHAT THIS CHECK ACTUALLY ASKS
// ===========================================================================
// The screen must say something true about whether the answer has gone stale,
// and the honest answer starts with what the record makes comparable: NOTHING.
// A `based_on` value is prose. There is no key from a label to a figure this app
// serves, and the seeded `href`s address the MOCKUP (`app-ledger.html?…`), not
// this app. Any label→figure mapping would be a guess, and a guess that quietly
// replaced a filed figure with a fresh one is exactly the failure the route
// forbids.
//
// So this compares the BOOK rather than the figures, and it reports precisely
// what it asked — CLAUDE.md's rule about a claim being larger than the check:
//
//   `datedOnOrAfter`  entries in the set examined whose DATE is on or after the
//                     day the answer was filed. A booking date is when the
//                     money moved, NOT when the row was written — there is no
//                     `created_at` on `publicEntry` — so this is a sufficient
//                     signal that the books have moved and not a necessary one.
//                     An entry back-dated into January and typed in September
//                     is invisible to it.
//   `staged`          entries counting in NOTHING today. Not a change since the
//                     answer; a fact about the book now. It matters to an answer
//                     that rested on revenue and burn, because those derivations
//                     exclude staged rows.
//
// Both are stated in those words on the screen. Neither is called drift.

export interface BookToday {
  /** How many entries this check looked at. Zero means it asked nothing. */
  examined: number
  /** Entries dated on or after the filing day. See the header. */
  datedOnOrAfter: number
  /** Entries still staged, and therefore in no derived figure. */
  staged: number
}

/** The minimum of an entry this check reads. Deliberately not `Entry`. */
export interface DatedRow {
  date: string
  status: string
}

/**
 * What the book looks like today, against the day an answer was filed.
 *
 * ── NO `Date` IS CONSTRUCTED, FOR `<DateText>`'S REASON ───────────────────
 * `asked` is a full ISO timestamp in UTC and `entry.date` is a Postgres `date`.
 * Both are compared as their first ten characters, lexicographically, which is
 * exact for `YYYY-MM-DD` and cannot shift a booking across a year boundary for a
 * reader west of Greenwich. `new Date("2026-01-01")` would.
 */
export function bookToday(askedIso: string | null | undefined, entries: DatedRow[]): BookToday {
  const day = typeof askedIso === 'string' ? askedIso.slice(0, 10) : ''
  let datedOnOrAfter = 0
  let staged = 0
  for (const e of entries) {
    // POSITIVE, and against the value the vocabulary serves. `!== 'posted'`
    // would count a third status added server-side as staged, which is a claim
    // about what counts in the statements that this app was not told.
    if (e.status === 'staged') staged += 1
    // A filing date this function could not read asks nothing rather than
    // matching everything: `'' <= anything` is true for every string.
    if (day.length === 10 && e.date.slice(0, 10) >= day) datedOnOrAfter += 1
  }
  return { examined: entries.length, datedOnOrAfter, staged }
}

/** Is there anything for the screen to report? Both halves, never one. */
export function bookHasSomethingToSay(t: BookToday): boolean {
  return t.examined > 0 && (t.datedOnOrAfter > 0 || t.staged > 0)
}
