// The cross-book rollup — and the word for what it is not.
//
// ===========================================================================
// THIS IS AN INFORMATIONAL AGGREGATION. IT IS NEVER A CONSOLIDATION.
// ===========================================================================
// Consolidation is a defined legal act (art. 963 CO): eliminating intercompany
// balances and transactions to present a group as one economic entity, on a
// document with the same standing as a bilan. **Nothing here does any of that.**
// Two of the seeded books hold both sides of the same CHF 8'000 loan and both
// sides are counted, twice, on purpose — because the reader's question is "what
// do I hold", not "what would the group's balance sheet say".
//
// So the word "consolidated" appears nowhere in this product, ever, and the page
// that renders this carries a disclaimer saying so. That is not lawyerly
// throat-clearing: a document labelled as a consolidation which was produced by
// adding two totals together is a false statement about a filing obligation.
//
// ===========================================================================
// THE ARITHMETIC IS IN CENTIMES, IN BIGINT, LIKE EVERYTHING ELSE
// ===========================================================================
// This is the only place in the WEB surface that adds two amounts together, and
// it would have been the easiest place in the app to reintroduce the float that
// `lib/format.ts` and `lib/derive/index.ts` each spend a header removing. The
// seeded books already contain 22333.03 and 2283.03.
//
// `toCentimes` / `fromCentimes` are reused from `lib/derive/index.ts` rather
// than re-implemented. They are pure string↔bigint functions with no database
// in them, and a second copy of decimal parsing is a second copy that can round
// differently from the one the statements were derived with.
//
// `amount()` from `lib/format.ts` is NOT used here, and that is the whole point:
// its docstring says "never use this to compute a figure that is then displayed
// as money", and every figure here is displayed as money.

import { fromCentimes, toCentimes } from './derive'
import type { Money, OverviewBook } from './types'

export interface Rollup {
  /** How many books this covers. Never assumed, always counted. */
  books: number
  /**
   * Total assets across the DOUBLE-ENTRY books only.
   *
   * A simplified book has no balance sheet, so it contributes nothing here —
   * and `riBooks` below says how many books that silently excludes, because a
   * total that quietly covers two of three books is worse than no total.
   */
  totalActif: Money
  /** How many books are behind `totalActif`. */
  bilanBooks: number
  /** How many books are NOT, because they keep simplified books. */
  riBooks: number
  /**
   * Every book's bottom line, added up.
   *
   * ── AND IT ADDS TWO DIFFERENT KINDS OF NUMBER, WHICH IS SAID ON THE PAGE ──
   * A double-entry book's `resultat` is an accrual profit; a simplified book's
   * is a CASH result — no accruals, no depreciation (`riTotals`, which
   * deliberately refuses to call it a bénéfice). Summing them is defensible for
   * "roughly, how did the year go across everything I run" and indefensible as
   * anything a fiduciary would read. The page labels it accordingly.
   */
  resultat: Money
  entries: number
  /**
   * STRICTLY unrecognized, across every book. Not the work outstanding.
   *
   * Kept because it is a real number a screen may want to say the word
   * "unrecognized" about — but the panel's "Need a human" figure is `worklist`
   * below, and the two differ the moment anything is `inferred`.
   */
  unrecognized: number
  /**
   * What actually needs a human: `unrecognized` OR `inferred`, summed.
   *
   * ── ADDED 2026-08-18, BECAUSE THE PANEL WAS ADDING THE WRONG FIELD ───────
   * `GET …/overview` has served this per book since phase 2 and `lib/types.ts`
   * did not declare it, so `RollupPanel` summed `unrecognized` under the label
   * "Need a human" — 4 where `bk books overview` totalled 5, on the seeded
   * workspace. Nothing threw; the smaller number simply looked like less work.
   */
  worklist: number
  staged: number
  /** Books with no fiscal year yet — they contribute nothing and are counted. */
  withoutExercice: number
}

/**
 * Add up what the overview served.
 *
 * Takes the rows rather than fetching, so it is a pure function a test can call
 * with three books, one book, or none. **Nothing here counts to three.**
 */
export function rollup(books: OverviewBook[]): Rollup {
  let actif = 0n
  let resultat = 0n
  let bilanBooks = 0
  let riBooks = 0
  let withoutExercice = 0
  let entries = 0
  let unrecognized = 0
  let worklist = 0
  let staged = 0

  for (const b of books) {
    if (b.exercice === null) withoutExercice += 1
    if (b.bilan) {
      bilanBooks += 1
      actif += toCentimes(b.bilan.actif)
      resultat += toCentimes(b.bilan.resultat)
    }
    if (b.ri) {
      riBooks += 1
      resultat += toCentimes(b.ri.resultat)
    }
    entries += b.entries
    unrecognized += b.unrecognized
    worklist += b.worklist
    staged += b.staged
  }

  return {
    books: books.length,
    totalActif: fromCentimes(actif),
    bilanBooks,
    riBooks,
    resultat: fromCentimes(resultat),
    entries,
    unrecognized,
    worklist,
    staged,
    withoutExercice,
  }
}
