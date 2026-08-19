// WHICH JOURNAL A BOOK KEEPS. Decided once, positively, before anything reads a row.
//
// ===========================================================================
// `GET …/entries` SERVES TWO SHAPES AND THERE IS NO MARKER FIELD ON THE WIRE
// ===========================================================================
// Since phase 4A the route serves the grand livre for a double-entry book and
// the recettes-dépenses journal for a simplified one. From the route's own
// header: *"The caller named the book (or accepted the default), so the caller
// knows which shape it gets — context explicit, no marker field."*
//
// So the CALLER carries the discriminator, there is nothing in the payload to
// recover it from, and reading a row before deciding is reading a row whose
// shape you have guessed. Deciding here, from `bookkeeping_regime`, is the
// whole of this module.
//
// **This is the THIRD payload to change shape under a merged screen.** Phase 1
// moved the books out of `/api/meta` and the overview said "you have no books"
// over three of them. Phase 3 added `kind: 'piece'` and the worklist grew a
// resolve button that rewrote the wrong entry. This one was live on
// `spec/b-books` and was reproduced in a browser on 2026-08-19 before a line was
// changed: `/dashboard/blackcode/ledger?entity=ri` rendered six recettes-dépenses
// rows through grand-livre columns — a blank `N°`, a blank `Status`, **no amount
// and no direction anywhere on the row**, "This entry has no lines." on all six,
// and every label linked to `/ledger/{n}`, which reads `books.entry` and opened
// **another book's écriture** under this book's name in the header. RI #3
// (CAISSE DE COMPENSATION VD, 640.00 dépense) opened blackcode SA's WIR-PMT
// REF-88213 IMMOREGIE SA. Assume there is a fourth you have not found yet.
//
// ===========================================================================
// THE BRANCH IS POSITIVE AND ENUMERATED, AND THAT IS NOT A STYLE PREFERENCE
// ===========================================================================
// `journalFor` maps each KNOWN regime to a journal and answers `null` for
// everything else. It is never `!== 'double_entry'`.
//
// `lib/resolvable.ts` carries the reason at length: the worklist's
// `kind !== 'ri_entry'` was exhaustive for two kinds and correct on the day it
// was written, and when a third arrived it failed TOWARD a write. A negative
// test here would fail toward reading a grand livre out of a payload that has
// no lines in it — every screen compiling, every request succeeding, and the
// numbers wrong. A third regime added server-side is a screen that says it
// cannot tell, which is a rendering nobody wrote and never a wrong statement.
//
// **`null` is not "the default journal".** It means the book is not in hand yet
// or its regime is a value this bundle does not know, and a caller must render
// that as an unknown rather than falling back — see `apps/books/lib/hooks.ts`'s
// `enabled` note for the same rule applied to the scope.

import type { BookkeepingRegime } from './types'

/**
 * The two journals `GET …/entries` serves.
 *
 * Spelled exactly as the SERVER spells them. `journalOf` in
 * `lib/db/queries/pieces.ts` returns these two strings and `POST
 * /pieces/{n}/match` puts one on the wire as `matched_journal`, so a screen that
 * has a `Journal` from either side is holding the same vocabulary. Inventing a
 * third spelling here would be a second copy of the rule.
 */
export type Journal = 'grand_livre' | 'recettes_depenses'

/**
 * Which journal does this book keep?
 *
 * POSITIVE and enumerated — see the header. `null` means "cannot tell", which is
 * a state a screen must render as such and must never resolve into a default.
 *
 * Takes a wide `string` rather than `BookkeepingRegime` on purpose: the value
 * arrives from the wire, and a union is a claim WE make on top of a `varchar`.
 * Narrowing the PARAMETER would move the unknown-regime case to a place no
 * runtime value can reach, which is the exact shape `_ExerciceKeys` in
 * `lib/wire-parity.test.ts` is on record for.
 */
export function journalFor(regime: string | null | undefined): Journal | null {
  if (regime === 'double_entry') return 'grand_livre'
  if (regime === 'simplified') return 'recettes_depenses'
  return null
}

/**
 * Every regime this app knows, for a test to iterate.
 *
 * ── TYPED SO THE UNION CANNOT OUTGROW IT ─────────────────────────────────
 * Same device as `WORKLIST_KINDS` in `lib/resolvable.ts`, and for the same
 * reason: `readonly BookkeepingRegime[]` alone would let a regime added to
 * `lib/types.ts` be forgotten here and leave the test passing over a smaller
 * set. `Exhaustive` fails to compile unless every member appears.
 */
type Exhaustive<T extends readonly BookkeepingRegime[]> =
  BookkeepingRegime extends T[number] ? T : never

export const REGIMES = ['double_entry', 'simplified'] as const satisfies Exhaustive<
  readonly ['double_entry', 'simplified']
>

/**
 * The `GET …/entries` query parameters, and which journal each one means anything to.
 *
 * ── THEY ARE REFUSED NOW, NOT IGNORED ────────────────────────────────────
 * Sending `?status=` or `?account=` to a simplified book is a 400
 * (`ri_no_such_filter`, *"an RI journal has no posting status and no accounts to
 * filter by"*). It used to be silently ignored. **We sent both**: the ledger has
 * a status filter chip, and `<AccountRef>` — the income statement's drill-down —
 * appends `?status=posted` so the figure reconciles to its own drill-down. Both
 * were verified 400 in a browser on 2026-08-19 before this module existed.
 *
 * So this is the table a screen asks before it builds a URL, rather than each
 * screen carrying its own copy of the rule.
 */
export type LedgerFilter = 'status' | 'account' | 'recognition'

const ACCEPTS: Record<Journal, readonly LedgerFilter[]> = {
  // The grand livre has a posting lifecycle and a chart mapping, so all three.
  grand_livre: ['status', 'account', 'recognition'],
  // An RI journal has neither. `recognition` is the one that works on both —
  // the route's own suggestion says so.
  recettes_depenses: ['recognition'],
}

/**
 * May this filter be sent to this journal?
 *
 * `null` (the journal is not known) answers **false for everything**, so a
 * screen that has not resolved its book yet sends no filter at all rather than
 * sending one that might be refused. That is the conservative direction: a
 * missing filter is a wider list, and a refused one is a screen with an error
 * box on it where the ledger should be.
 */
export function journalAccepts(journal: Journal | null, filter: LedgerFilter): boolean {
  if (journal === null) return false
  return ACCEPTS[journal].includes(filter)
}

/** Every filter this journal accepts. For a screen deciding what to render. */
export function filtersFor(journal: Journal | null): readonly LedgerFilter[] {
  return journal === null ? [] : ACCEPTS[journal]
}

/**
 * What to call this journal on screen, in the reader's words.
 *
 * English chrome (D-A). "Grand livre" survives as the heading of the
 * double-entry ledger because it is the name of the statutory document, the same
 * way the bilan's line labels do; the recettes-dépenses journal is named by
 * art. 957 al. 2 CO and has no English name that a fiduciary would recognise.
 */
export const JOURNAL_NAME: Record<Journal, { fr: string; en: string }> = {
  grand_livre: { fr: 'Grand livre', en: 'General ledger' },
  recettes_depenses: { fr: 'Recettes et dépenses', en: 'Receipts and expenses' },
}
