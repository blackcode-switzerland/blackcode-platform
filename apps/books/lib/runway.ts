// Cash, and how long it lasts at the current rate.
//
// ===========================================================================
// THE MOCKUP'S RUNWAY BLOCK, BUILT FROM A ROUTE THAT ALREADY EXISTS
// ===========================================================================
// `MOCKUP-DIFF.md` listed the runway chart as "blocked on the backend, not on
// us", because `GET …/analytique` serves the categories and the months and no
// cash figure at all. That was true of THAT route and it made the whole block
// look like a route change.
//
// It is not. **The bilan already serves cash**: `pos === 'tresorerie'` is an
// art. 959a position, the balance-sheet screen renders it, and it is the same
// book and the same exercice. So this is arithmetic over two payloads the app
// already fetches, which is where every derived figure in this app belongs —
// `lib/rollup.ts`, `lib/analytique.ts`, `lib/ledger-totals.ts`.
//
// ── EVERY REFUSAL HERE IS A REAL ONE, AND THERE ARE FIVE ──────────────────
// A runway is a division, and a division is where a screen invents a number.
// `runway()` returns a discriminated result rather than a number-or-null,
// because *why* there is no figure is what the reader needs:
//
//   no_bilan       a simplified book has none (art. 957 al. 2). Not an error.
//   no_cash_line   the bilan carries no `tresorerie` position at all
//   no_months      the series is empty — nothing has been posted this year
//   not_burning    net ≥ 0. The book is not consuming cash, so "how long until
//                  it runs out" has no answer. **This is the one that matters:**
//                  a naive `cash / net` on a positive net yields a negative
//                  month count, and a negative runway rendered as a figure is
//                  the most confidently wrong thing this screen could print.
//   ok             a real figure, with the basis that produced it
//
// ── AND THE MONTHS ARE THE SERIES', NOT THE CALENDAR'S ────────────────────
// `FlowTotals.months` counts months that carried a posted écriture, because
// `monthlyFlows` drops empty ones — the series is sparse by design. So the
// per-month rate is `net / months_with_activity`, and the screen says which
// months those are. Dividing by 12 would state a rate for a year the book has
// not lived.

import { toCentimes, fromCentimes } from './derive'
import type { BilanResult, Money } from './types'
import type { FlowTotals } from './analytique'

/** The art. 959a position that IS cash. Not a guess — see `lib/statements.ts`. */
const CASH_POS = 'tresorerie'

/**
 * The trésorerie line of a bilan, or `null` if it has none.
 *
 * Sums every line at that position rather than taking the first. The statement
 * structure has one `tresorerie` line today, and a payload that carried two
 * would silently lose one to a `.find()` — the same class of quiet omission the
 * rollup's coverage footnotes exist for.
 */
export function cashFrom(bilan: BilanResult | undefined): Money | null {
  if (!bilan) return null
  let total = 0n
  let found = false
  for (const g of bilan.groups) {
    if (g.side !== 'actif') continue
    for (const l of g.lines) {
      if (l.pos !== CASH_POS) continue
      found = true
      total += toCentimes(l.amount)
    }
  }
  return found ? fromCentimes(total) : null
}

export type RunwayResult =
  | { kind: 'ok'; months: number; cash: Money; perMonth: Money; over: number }
  | { kind: 'no_bilan' | 'no_cash_line' | 'no_months' | 'not_burning' }

/**
 * How many months the cash lasts at the rate the served months imply.
 *
 * The month count is a NUMBER and that is deliberate: it is a geometry, not a
 * figure. `docs/frontend.md` §4bis's line — *a figure is exact, a geometry is a
 * float* — applies, and a runway is an estimate by construction. `cash` and
 * `perMonth` beside it are exact strings, so the reader can check the division.
 */
export function runway(
  /**
   * The bilan itself, not the cash figure.
   *
   * ── `no_bilan` WAS UNREACHABLE, AND IT SAID THE WRONG THING (2026-08-21) ──
   * This took `cash: Money | null` and returned `no_cash_line` for every null.
   * `cashFrom(undefined)` is also null, so a SIMPLIFIED book — which has no
   * balance sheet at all under art. 957 al. 2, and whose bilan route refuses
   * outright — was told "the balance sheet carries no trésorerie position".
   * A sentence about a document that does not exist.
   *
   * `no_bilan` was declared in `RunwayResult` and no code path could produce
   * it: a branch that cannot fire, shipped alongside a branch saying the wrong
   * thing in its place. Found by opening the RI book, not by a test — the
   * tests all passed a `cash` argument and so could not tell the two nulls
   * apart either.
   *
   * Taking the payload rather than the derived figure is what makes the
   * distinction expressible at all.
   */
  bilan: BilanResult | undefined,
  totals: FlowTotals
): RunwayResult {
  if (bilan === undefined) return { kind: 'no_bilan' }
  const cash = cashFrom(bilan)
  if (cash === null) return { kind: 'no_cash_line' }
  if (totals.months === 0) return { kind: 'no_months' }

  const net = toCentimes(totals.net)
  // `>= 0n` rather than `> 0n`, and the zero is NOT load-bearing here: a net of
  // exactly zero also reaches `burnPerMonth === 0n` below and returns the same
  // answer. Weakening this to `> 0n` was mutated on 2026-08-21 and the suite
  // stayed green, correctly — the two guards overlap on that one value. It is
  // kept because returning early where the intent is obvious beats relying on a
  // downstream truncation to mean the same thing.
  if (net >= 0n) return { kind: 'not_burning' }

  // ── THIS ONE IS LOAD-BEARING, AND FOR A CASE THAT IS NOT ZERO ───────────
  // Integer division truncates: a book burning five centimes over six months
  // divides to ZERO centimes a month, and `cash / 0` is Infinity. A runway of
  // Infinity months is not a figure, so a burn too small to express per month
  // is treated as not burning.
  const burnPerMonth = -net / BigInt(totals.months)
  if (burnPerMonth === 0n) return { kind: 'not_burning' }

  const cashC = toCentimes(cash)
  if (cashC <= 0n) return { kind: 'ok', months: 0, cash, perMonth: fromCentimes(burnPerMonth), over: totals.months }

  // The only float on this path, and it is the estimate itself.
  const months = Number(cashC) / Number(burnPerMonth)
  return {
    kind: 'ok',
    months,
    cash,
    perMonth: fromCentimes(burnPerMonth),
    over: totals.months,
  }
}
