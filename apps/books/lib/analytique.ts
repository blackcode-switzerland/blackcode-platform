// The management view's arithmetic — and the line between the two kinds of it.
//
// ===========================================================================
// THIS SCREEN IS WHERE CHARTS MEET MONEY, AND MONEY IS A STRING
// ===========================================================================
// Every other screen in this app renders an amount and never computes one. This
// one has to do both, so the two are separated here rather than in a component,
// and the rule is stated once:
//
//   A FIGURE — anything the reader sees as an amount — is exact. It comes off
//   the wire as a string, or it is added here in CENTIMES, in bigint, with
//   `toCentimes` / `fromCentimes` from `lib/derive`. It reaches the screen
//   through `<Money>`, whose prop type is `string | null` precisely so a float
//   cannot get in.
//
//   A GEOMETRY — a bar's width, a column's height, a percentage share, a sort
//   key — is a float, from `amount()`, and it is never rendered as an amount.
//
// `amount()`'s own docstring is the rule ("never use this to compute a figure
// that is then displayed as money") and `lib/format.ts`'s header is the record
// of what happened the last time the display path constructed a number.
//
// ── THE EXACT HALF IS lib/rollup.ts's PATTERN, DELIBERATELY ────────────────
// That module is the only other place in this web surface that adds money, and
// it reuses `toCentimes`/`fromCentimes` rather than re-implementing decimal
// parsing, for the reason its header gives: a second copy of that parsing is a
// second copy that can round differently from the one the statements were
// derived with. Same here.
//
// **The server does not serve a total for this screen.** `GET …/analytique`
// serves the categories and the months and no sums, so "revenue this exercice"
// is either added in the browser or not shown at all. It is added — exactly,
// here, out of the strings — and `lib/analytique.test.ts` pins that with an
// input at a magnitude where a float accumulator and this one disagree. Read
// `lib/rollup.test.ts` before touching that case: the first version of the
// equivalent assertion there **passed against a rollup rewritten to use
// floats**, because at any magnitude this product sees, `toFixed` hides the
// drift. Asking the server for the totals is in the phase report; until then
// this is the honest version of doing it here.

import { fromCentimes, toCentimes } from './derive'
import { amount } from './format'
import type { AnalytiqueCategory, MonthlyFlow, Money } from './types'

// ===========================================================================
// EXACT — figures. Centimes, bigint, no float anywhere below this line.
// ===========================================================================

export interface FlowTotals {
  /** Produits over every month served. */
  produits: Money
  /** Charges over every month served. */
  charges: Money
  /** produits − charges. Signed, and negative is the ordinary case here. */
  net: Money
  /**
   * How many months carried a posted écriture.
   *
   * **Not how many months the exercice has.** The series is sparse by design
   * (`monthlyFlows` drops empty months), so this is the coverage of the figures
   * beside it, and the screen says so — a reader who takes `net` for a year
   * when it covers two months has been misled by an omission rather than by a
   * number.
   */
  months: number
}

/**
 * Add up the monthly series, exactly.
 *
 * Takes the rows rather than fetching, so a test can call it with two months,
 * one, or none. **Nothing here divides**: a per-month average is a figure this
 * function deliberately does not produce — see the header of
 * `components/run-figures.tsx`.
 */
export function flowTotals(flows: MonthlyFlow[]): FlowTotals {
  let produits = 0n
  let charges = 0n
  for (const f of flows) {
    produits += toCentimes(f.produits)
    charges += toCentimes(f.charges)
  }
  return {
    produits: fromCentimes(produits),
    charges: fromCentimes(charges),
    net: fromCentimes(produits - charges),
    months: flows.length,
  }
}

/**
 * The breakdown's total, exactly.
 *
 * ── IT IS NOT THE SAME NUMBER AS `flowTotals().charges`, AND THAT IS REAL ──
 * The breakdown counts only the accounts a category claims; the monthly flows
 * count every CR account that is not class 3. An account in no category — or in
 * a RETIRED one — is in the second and not in the first. On the seeded
 * blackcode book they happen to agree at 16'413.60; on a book with an
 * unmapped charge account they will not, and the screen shows both rather than
 * picking one, because a breakdown that silently omits a franc is the failure
 * this product exists to refuse.
 */
export function breakdownTotal(categories: AnalytiqueCategory[]): Money {
  let cents = 0n
  for (const c of categories) cents += toCentimes(c.amount)
  return fromCentimes(cents)
}

/**
 * The largest of a set of amounts, compared exactly.
 *
 * This is a CHART CEILING, so it is one of the few things here that a float
 * would in fact get right: at the top of `numeric(14,2)` the gap between two
 * doubles is finer than a rappen, so `Math.max` over parsed values orders
 * every amount this column can hold. `lib/analytique.test.ts` records that
 * mutation staying GREEN rather than claiming a check it does not have.
 *
 * It is exact anyway, for `lib/rollup.ts`'s reason — correct by construction
 * beats correct by luck of magnitude — and for one local one: the result is
 * handed straight back to `barLength` as a STRING, so this module keeps
 * exactly one parser and it is `amount()`.
 *
 * Returns `"0.00"` for an empty set, and for a set with no positive amount:
 * a bucket can be negative (a credit note reduces its category) and a negative
 * ceiling would invert every bar.
 */
export function maxAmount(values: Money[]): Money {
  let top = 0n
  for (const v of values) {
    const c = toCentimes(v)
    if (c > top) top = c
  }
  return fromCentimes(top)
}

/** Is this amount exactly zero? Decided on the string, not on a parse. */
export function isZeroAmount(value: Money): boolean {
  return toCentimes(value) === 0n
}

// ===========================================================================
// GEOMETRY — floats, from `amount()`. NOTHING BELOW HERE IS EVER DISPLAYED
// AS AN AMOUNT.
// ===========================================================================
//
// Three functions, and they are the ONLY `amount()` call sites this screen has.
// Each one answers a question about pixels or about a share, and each one's
// output is a `number` — which `<Money>` refuses to take, so the type system is
// what keeps them on their own side of the line.

/**
 * A bar's length as a percentage of the chart's ceiling, 0–100.
 *
 * A non-zero amount never returns less than `minVisible`: a bar 0.3px wide is
 * indistinguishable from no bar, and "this category has almost nothing in it"
 * and "this category has nothing in it" are different facts. A genuinely zero
 * amount returns exactly 0 and draws nothing — its ROW is still on the screen,
 * carrying its label and `CHF 0.00`.
 */
export function barLength(value: Money, ceiling: Money, minVisible = 1.5): number {
  const v = amount(value) ?? 0
  const max = amount(ceiling) ?? 0
  if (v === 0 || max <= 0) return 0
  return Math.max(minVisible, Math.min(100, (v / max) * 100))
}

/**
 * One amount's share of a total, as a percentage rounded to one decimal.
 *
 * `null` when the total is zero — every share of nothing is undefined, and a
 * screen printing `0.0%` there states a ratio nobody computed. AIOS's breakdown
 * is four zero buckets and one at 27.10; a book with no postings at all is five
 * zeroes and this returns null for every one of them.
 */
export function share(value: Money, total: Money): number | null {
  const t = amount(total) ?? 0
  if (t === 0) return null
  const v = amount(value) ?? 0
  return Math.round((v / t) * 1000) / 10
}

/**
 * The y-axis ceiling and its ticks, in FRANCS, for a column chart.
 *
 * ── A TICK IS A SCALE MARK AND NOT A FIGURE ───────────────────────────────
 * These numbers are rounded to a "nice" step and rendered compactly (`5k`), so
 * they are deliberately not money and are never passed to `<Money>`. Every
 * actual figure on this screen is in the table beside the chart, off the wire.
 * That split is what lets the axis be readable and the figures be exact.
 *
 * The step is the mockup's `niceStep` (1/2/2.5/5/10 × a power of ten), kept
 * because a reader comparing the two screens should see the same gridlines.
 */
export function axisTicks(values: Money[]): { max: number; ticks: number[] } {
  const peak = Math.max(0, ...values.map((v) => amount(v) ?? 0))
  if (peak <= 0) return { max: 1, ticks: [0] }
  const raw = peak / 4
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  let step = 10 * pow
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * pow) {
      step = m * pow
      break
    }
  }
  const max = Math.ceil(peak / step) * step
  const ticks: number[] = []
  // `+ step / 2` rather than `<= max`: `max` is a product of floats and the
  // last tick would otherwise drop out on a value like 0.1 + 0.2.
  for (let v = 0; v < max + step / 2; v += step) ticks.push(v)
  return { max, ticks }
}

/** A tick, compactly: `15k`, `2.5k`, `600`. Scale, never an amount. */
export function tickLabel(v: number): string {
  if (v >= 1000) {
    const k = v / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(Math.round(v))
}

// ===========================================================================
// NEITHER — labels. No arithmetic at all.
// ===========================================================================

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `"2026-01"` → `"Jan 26"`.
 *
 * Sliced, never parsed — the same rule as `date()` in `lib/format.ts`. A
 * `new Date("2026-01")` is midnight UTC, which is December for anybody west of
 * Greenwich, and this label would name the wrong month on a screen whose whole
 * subject is which month a franc landed in.
 */
export function monthLabel(ym: string): string {
  const y = ym.slice(2, 4)
  const m = Number(ym.slice(5, 7))
  const name = MONTHS[m - 1]
  return name ? `${name} ${y}` : ym
}

/**
 * Is the sparse series missing a month BETWEEN two it carries?
 *
 * The chart must not interpolate, and this is what lets it say so instead of
 * silently drawing consecutive months that are not consecutive. `2026-01` and
 * `2026-03` with no February is a gap; `2026-01`, `2026-02` is not.
 */
export function hasGaps(flows: MonthlyFlow[]): boolean {
  if (flows.length < 2) return false
  const index = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7))
  const first = index(flows[0].month)
  const last = index(flows[flows.length - 1].month)
  return last - first + 1 !== flows.length
}
