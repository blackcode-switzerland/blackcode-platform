// What the rows currently on the ledger add up to.
//
// ===========================================================================
// THE TOTALS ARE OF THE SHOWN SET, AND THAT IS THE WHOLE POINT
// ===========================================================================
// A reader who filters the ledger to one account, or to everything a rule has
// not explained yet, immediately wants to know what that set comes to. Today
// they have to add it up themselves or leave for the income statement.
//
// So these are totals of **the rows the table was handed** — the same set the
// count describes, and for the same reason: a figure derived from anything else
// can disagree with what is on screen, and a total that disagrees with the rows
// under it is worse than no total.
//
// ── THE ARITHMETIC IS IN CENTIMES, AS BIGINT ──────────────────────────────
// `lib/rollup.ts`'s pattern, reused rather than re-implemented. Money crosses
// the wire as a `numeric(14,2)` STRING and a float cannot hold one — a ledger
// balances to the rappen. Everything here goes string → `toCentimes` → `bigint`
// → `fromCentimes` → string, and no `Number` is constructed anywhere on the
// path.
//
// **`lib/rollup.test.ts` is the file to read before touching this.** The first
// version of the equivalent assertion there PASSED against a rollup rewritten
// to use floats, because the fixture's magnitudes were too small to disagree.
// The tests here use magnitudes where a float accumulator and this one differ.
//
// ── AND A TOTAL IS NEVER A CLAIM ABOUT THE JOURNAL ────────────────────────
// It is a claim about a page of it. The grand livre is capped server-side
// (`listEntries`, `limit ?? 100` clamped to 500) and the screen says so when it
// is at the cap. These functions do not know about that and must not: they add
// up what they are given. Saying what the set IS belongs to the screen.

import { toCentimes, fromCentimes } from './derive'
import type { Entry, RiEntry } from './types'

// ---------------------------------------------------------------------------
// The recettes-dépenses journal
// ---------------------------------------------------------------------------

export interface RiTotals {
  recettes: string
  depenses: string
  /**
   * The third direction. Migration 0009: a transfer between the owner's own
   * accounts is LOGGED and counts in neither recettes nor dépenses.
   */
  neutral: string
  /** `recettes - depenses`. Neutral movements are not in it, by definition. */
  resultat: string
  /**
   * How many movements carried a direction this module does not know.
   *
   * Not folded into any total. A fourth direction added server-side must not be
   * silently counted as a dépense — which is exactly the defect Andrea's
   * "logged but neutral" answer created before 0009 existed, and it misstated
   * her income. An unknown direction is COUNTED and SHOWN, never absorbed.
   */
  unknown: number
}

export function riTotals(rows: readonly RiEntry[]): RiTotals {
  let recettes = 0n
  let depenses = 0n
  let neutral = 0n
  let unknown = 0

  for (const r of rows) {
    const c = toCentimes(r.amount)
    // Positive and enumerated, never a two-branch `recette ? … : dépense`.
    // `lib/resolvable.ts` records what the negative test cost this app when a
    // third value arrived — and here a third value already HAS arrived once.
    if (r.direction === 'recette') recettes += c
    else if (r.direction === 'depense') depenses += c
    else if (r.direction === 'neutral') neutral += c
    else unknown += 1
  }

  return {
    recettes: fromCentimes(recettes),
    depenses: fromCentimes(depenses),
    neutral: fromCentimes(neutral),
    resultat: fromCentimes(recettes - depenses),
    unknown,
  }
}

// ---------------------------------------------------------------------------
// One écriture
// ---------------------------------------------------------------------------

/**
 * What this entry MOVED — the magnitude a reader means by "how much was it".
 *
 * ── IT IS THE DEBIT SIDE, AND THE CREDIT SIDE IS NOT A SECOND FIGURE ──────
 * A posted entry balances: migration 0004's deferred constraint refuses a
 * posting where debit ≠ credit, so on anything posted the two sides are the
 * same number and showing both would be showing one figure twice.
 *
 * A STAGED entry need not balance and often does not — that is the whole point
 * of staging. So `balanced` is returned beside the figure rather than assumed,
 * and the screen says which it is instead of printing a total that quietly
 * describes only one side of an unbalanced record.
 *
 * Returns `null` for an entry with no lines. Not `"0.00"`: an entry whose lines
 * have not been written yet has no amount, and a derived zero would be a claim
 * that it moved nothing.
 */
export interface EntryTotal {
  debit: string
  credit: string
  balanced: boolean
}

export function entryTotal(lines: readonly { debit: string; credit: string }[] | undefined): EntryTotal | null {
  if (!lines || lines.length === 0) return null
  let debit = 0n
  let credit = 0n
  for (const l of lines) {
    debit += toCentimes(l.debit)
    credit += toCentimes(l.credit)
  }
  return {
    debit: fromCentimes(debit),
    credit: fromCentimes(credit),
    balanced: debit === credit,
  }
}

// ---------------------------------------------------------------------------
// The grand livre, filtered to one account
// ---------------------------------------------------------------------------

export interface AccountTotals {
  debit: string
  credit: string
  /**
   * `debit - credit`. Which side that lands on is the account's own business —
   * an asset account moves one way and a revenue account the other — so this is
   * a signed movement and the screen labels it as such rather than calling it a
   * balance.
   *
   * **It is not the account's balance.** The opening balance is not in it, and
   * neither is anything outside the rows on screen.
   */
  net: string
  /** How many LINES matched, which is not how many entries are on screen. */
  lines: number
}

/**
 * What one account moved, across the entries currently listed.
 *
 * ── IT SUMS LINES, NOT ENTRIES, AND THAT IS THE SUBTLE PART ───────────────
 * `?account=` filters which ÉCRITURES appear; each one is then shown WHOLE,
 * both sides, because the other side is what says where the money went. So a
 * listed entry usually carries lines that are NOT this account's, and adding up
 * every line on screen would double the figure and mean nothing.
 *
 * This walks into the lines and counts only the ones naming the account. A
 * line's `account` is nullable while an entry is staged, and a null never
 * matches — a staged line with no account yet is not this account's movement.
 */
export function accountTotals(rows: readonly Entry[], accountNo: string): AccountTotals {
  let debit = 0n
  let credit = 0n
  let lines = 0

  for (const e of rows) {
    for (const l of e.lines ?? []) {
      if (l.account !== accountNo) continue
      lines += 1
      debit += toCentimes(l.debit)
      credit += toCentimes(l.credit)
    }
  }

  return {
    debit: fromCentimes(debit),
    credit: fromCentimes(credit),
    net: fromCentimes(debit - credit),
    lines,
  }
}
