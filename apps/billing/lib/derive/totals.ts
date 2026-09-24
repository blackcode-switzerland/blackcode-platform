// The totals: per line, per rate, in one of two price modes, under one of four
// rounding policies. **Pure, and nothing here is ever stored.**
//
// ===========================================================================
// WHY DERIVED AND NOT STORED (invariant I5)
// ===========================================================================
// A stored total is a total that disagrees with its lines the first time
// somebody edits one. And since decision D-B7 the rounding policy is a COMPANY
// setting, so a stored total would also have to be rewritten across history
// every time that setting moved — which is a migration triggered by a settings
// change, i.e. the shape nobody ships twice.
//
// So there is no `subtotal`, `vat` or `total` column anywhere in `billing.*`.
// Look for one and you are looking at a bug.
//
// ===========================================================================
// THE SHAPE, AND WHERE IT CAME FROM
// ===========================================================================
// An earlier draft of the plan had ONE rate per invoice, VAT added on top, and a
// single `VAT_ROUNDING_STEP = 5` constant. Reading the first external customer's
// billing code on 2026-09-16 broke all three assumptions at once
// (`docs/billing-app-plan/README.md`, decision D-B7):
//
//   - their invoices put a VAT-EXEMPT medical act beside a TAXABLE product on
//     one document, with a per-line taxable flag
//   - their prices INCLUDE VAT; the displayed price is what the patient pays and
//     the VAT portion is extracted from inside it for reporting
//   - they round the VAT portion to the RAPPEN and the payable total to FIVE
//     rappen, showing the difference
//
// None of that is unusual bookkeeping. All of it was impossible in the old
// shape, and all of it was cheap to support before the first row existed.
//
// A fourth policy followed on 2026-09-23, from the same customer's code read
// more closely: they keep each line's qty × price UNROUNDED, sum, and round the
// payable total ONCE to five rappen. `total_0_05` rounds each line to the rappen
// before summing, and on a fractional quantity that lands a different total
// (`totals.test.ts` has 0.5 × 12.35 + 0.333 × 12.45: 10.30 exact, 10.35 rounded
// first). That is `exact_0_05` — see `computeExactTotalsRappen` below.
//
// ── THE ONE RULE TO CARRY OUT OF THIS FILE ─────────────────────────────────
// **`vat_rate === null` is not `vat_rate === '0'`.** Null means the line carries
// no VAT at all — an exempt act, or a company that is not registered. Zero is a
// real rate: an export, or a reverse charge. They appear differently on the
// document and differently on a VAT return. Never write the test as `> 0`.

import {
  MILLI,
  formatRappen,
  formatRate,
  lineProduct,
  lineProductExact,
  milliToRappen,
  parseQty,
  parseRappen,
  parseRateBp,
  roundMilliToStep,
  roundToStep,
  divRoundHalfAway,
  type MilliRappen,
  type Rappen,
} from './money'
import type { InvoiceTotals, RoundingPolicy, VatLine } from '@/types'

/** What `computeTotals` needs from one line. A subset of the row, on purpose. */
export interface TotalsLine {
  /** `numeric(12,3)` as a string. */
  qty: string
  /** `numeric(14,2)` as a string. */
  unit_price: string
  /** `numeric(5,2)` as a string, or null for "this line carries no VAT". */
  vat_rate: string | null
}

/** The amounts, in rappen, before they are formatted for the wire. */
export interface TotalsInRappen {
  subtotal: Rappen
  vat: Array<{ rate_bp: number; base: Rappen; amount: Rappen }>
  vat_total: Rappen
  /**
   * The adjustment the policy produced. Signed; zero under `line_0_05` and
   * `none`. Under `exact_0_05` it is what makes the PRINTED figures foot: the
   * difference between the printed subtotal (plus VAT, when prices exclude it)
   * and the total that was rounded from the exact sum.
   */
  rounding: Rappen
  total: Rappen
  /** Each line's own total, in order, so a caller need not recompute them. */
  line_totals: Rappen[]
}

/**
 * One line's total, AS PRINTED.
 *
 * Under `line_0_05` it is rounded to five rappen HERE, before anything is
 * summed, which is what makes the printed column add up to the printed subtotal
 * with no rounding line. Under the other three policies it is rounded to the
 * rappen and the adjustment (if any) happens once, at the end. Under
 * `exact_0_05` this is the DISPLAY figure only: the sum is taken over the exact
 * products, not over these (`computeExactTotalsRappen`).
 */
export function lineTotal(line: TotalsLine, rounding: RoundingPolicy): Rappen {
  const raw = lineProduct(parseQty(line.qty), parseRappen(line.unit_price))
  return rounding === 'line_0_05' ? roundToStep(raw, 5) : raw
}

/**
 * The whole derivation.
 *
 * `prices_include_vat` and `rounding` are separate arguments rather than read
 * from a row, because they come from two different places — the invoice and its
 * company — and passing them explicitly is what stops a caller reading the
 * company's CURRENT price mode for an invoice that was issued under the old one.
 */
export function computeTotalsRappen(
  lines: TotalsLine[],
  pricesIncludeVat: boolean,
  rounding: RoundingPolicy
): TotalsInRappen {
  if (rounding === 'exact_0_05') return computeExactTotalsRappen(lines, pricesIncludeVat)

  const line_totals = lines.map((l) => lineTotal(l, rounding))
  const subtotal = line_totals.reduce((a, b) => a + b, 0)

  // Group by rate. Exempt lines (null) are in `subtotal` and in NO group, which
  // is the whole of invariant I3 at this layer: they contribute to what is owed
  // and to no VAT figure.
  //
  // A Map keyed by basis points, so `"8.1"` and `"8.10"` are one group — they
  // are the same rate written two ways, and two VAT lines for one rate would be
  // a document nobody could reconcile.
  const groups = new Map<number, Rappen>()
  lines.forEach((l, i) => {
    if (l.vat_rate === null) return
    const bp = parseRateBp(l.vat_rate)
    groups.set(bp, (groups.get(bp) ?? 0) + line_totals[i])
  })

  // Ascending by rate, so the document's VAT block has a stable order that does
  // not depend on the order the lines happen to be in.
  const rates = [...groups.keys()].sort((a, b) => a - b)

  const vat = rates.map((bp) => {
    const base = groups.get(bp)!
    // EXCLUSIVE: the rate applies ON TOP of the base.
    //     amount = base × rate / 100
    //
    // INCLUSIVE: the base ALREADY CONTAINS the VAT, so the portion inside it is
    //     amount = base × rate / (100 + rate)
    //
    // The second formula is the one that is easy to get wrong by reaching for
    // the first, and getting it wrong overstates the VAT by a factor of
    // (100 + rate)/100 — about 8% at the Swiss standard rate. `totals.test.ts`
    // asserts the difference on a fixture where the two disagree ("the mixed
    // invoice the first external customer actually sends").
    const amount = pricesIncludeVat
      ? divRoundHalfAway(base * bp, 10000 + bp)
      : divRoundHalfAway(base * bp, 10000)
    return {
      rate_bp: bp,
      base,
      amount: rounding === 'line_0_05' ? roundToStep(amount, 5) : amount,
    }
  })

  const vat_total = vat.reduce((a, v) => a + v.amount, 0)

  // INCLUSIVE means nothing is added: the total IS the sum of the lines, and the
  // VAT figure above is a report on what is already inside it.
  const beforeRounding = pricesIncludeVat ? subtotal : subtotal + vat_total

  const adjustment =
    rounding === 'total_0_05' ? roundToStep(beforeRounding, 5) - beforeRounding : 0

  return {
    subtotal,
    vat,
    vat_total,
    rounding: adjustment,
    total: beforeRounding + adjustment,
    line_totals,
  }
}

/**
 * `exact_0_05`: the first external customer's arithmetic (2026-09-23).
 *
 * Every line is kept EXACT — qty × unit_price in integer milli-rappen, with no
 * rounding at all — the VAT is taken per rate on the exact base, and the
 * payable total is rounded ONCE, half away from zero, to five rappen. Nothing
 * in the path is a float: `numeric(12,3) × numeric(14,2)` is exact in
 * thousandths of a rappen by construction.
 *
 * ── THE DOCUMENT STILL HAS TO FOOT ─────────────────────────────────────────
 * A line cannot print 6.175. So each line is printed to the rappen, the
 * printed subtotal is the sum of those PRINTED lines (not the exact sum), and
 * `rounding` carries whatever separates that printed subtotal (plus the VAT,
 * when prices exclude it) from the total. Lines → subtotal → rounding → total
 * adds up on paper; the exact sum is what the total was rounded FROM and is not
 * printed anywhere. `totals.test.ts` asserts the footing on a fixture where the
 * exact and printed sums differ.
 *
 * The VAT `base` reported per rate is the exact base, printed to the rappen.
 */
export function computeExactTotalsRappen(lines: TotalsLine[], pricesIncludeVat: boolean): TotalsInRappen {
  const exact: MilliRappen[] = lines.map((l) => lineProductExact(parseQty(l.qty), parseRappen(l.unit_price)))
  const line_totals = exact.map(milliToRappen)
  const subtotal = line_totals.reduce((a, b) => a + b, 0)

  // Same grouping rule as above — null is exempt and in no group; keyed by
  // basis points so `"8.1"` and `"8.10"` are one rate — over the EXACT products.
  const groups = new Map<number, MilliRappen>()
  lines.forEach((l, i) => {
    if (l.vat_rate === null) return
    const bp = parseRateBp(l.vat_rate)
    groups.set(bp, (groups.get(bp) ?? 0) + exact[i])
  })
  const rates = [...groups.keys()].sort((a, b) => a - b)

  const vat = rates.map((bp) => {
    const baseMilli = groups.get(bp)!
    // The same two formulas as the rappen path, one scale down: the divisor
    // carries the extra ×1000 so the result comes back as rappen in one
    // half-away-from-zero division.
    const amount = pricesIncludeVat
      ? divRoundHalfAway(baseMilli * bp, (10000 + bp) * MILLI)
      : divRoundHalfAway(baseMilli * bp, 10000 * MILLI)
    return { rate_bp: bp, base: milliToRappen(baseMilli), amount }
  })
  const vat_total = vat.reduce((a, v) => a + v.amount, 0)

  // The one rounding: the exact sum (plus the VAT, already in rappen, when it
  // is added on top) to five rappen.
  const exactBefore: MilliRappen = exact.reduce((a, b) => a + b, 0) + (pricesIncludeVat ? 0 : vat_total * MILLI)
  const total = roundMilliToStep(exactBefore, 5)

  // What the paper shows above the total, and the figure that closes the gap.
  const printedBefore = pricesIncludeVat ? subtotal : subtotal + vat_total
  return {
    subtotal,
    vat,
    vat_total,
    rounding: total - printedBefore,
    total,
    line_totals,
  }
}

/** The wire shape: every amount a string, the rate a trimmed percentage. */
export function computeTotals(
  lines: TotalsLine[],
  pricesIncludeVat: boolean,
  rounding: RoundingPolicy
): InvoiceTotals {
  const r = computeTotalsRappen(lines, pricesIncludeVat, rounding)
  const vat: VatLine[] = r.vat.map((v) => ({
    rate: formatRate(v.rate_bp),
    base: formatRappen(v.base),
    amount: formatRappen(v.amount),
  }))
  return {
    subtotal: formatRappen(r.subtotal),
    vat,
    vat_total: formatRappen(r.vat_total),
    rounding: formatRappen(r.rounding),
    total: formatRappen(r.total),
  }
}

/**
 * Does this invoice have a VAT block at all?
 *
 * **A document has one when at least one line carries a non-null rate** — not
 * when the invoice's own `vat_rate` is set, which is only a prefill for new
 * lines, and not when a total is greater than zero.
 *
 * There is deliberately no `hasVat` boolean on the invoice row. A column would
 * be a second source that can disagree with the lines, and the lines are the
 * fact.
 */
export const hasVatBlock = (lines: TotalsLine[]): boolean =>
  lines.some((l) => l.vat_rate !== null)
