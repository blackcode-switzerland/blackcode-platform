// Rendering. Everything here turns a wire value into something a human reads, and
// NONE of it is ever stored or sent.
//
// The split matters: an amount arrives as the raw decimal string `"1234.50"` and
// `CHF 1'234.50` is made here, which is why the CLI and the web can disagree about
// presentation without either being wrong.
//
// ===========================================================================
// SWISS FORMATTING IS NOT `toLocaleString('de-CH')`
// ===========================================================================
// It nearly is. `de-CH` groups with U+2019 in modern ICU, which is
// typographically correct — but older ICU used an ASCII apostrophe and some
// versions a space. Rather than depend on which ICU a Node version or a browser
// ships, the grouping is done here.
//
// ── WHY THE ASCII APOSTROPHE AND NOT U+2019 (’) ───────────────────────────
// `apps/sales/lib/format.ts` chose U+2019. This app chooses ASCII `'`, and the
// divergence is deliberate: phase 1's acceptance test compares this app's output
// STRING FOR STRING against the mockup at localhost:8734, and the mockup's
// `fmtCHF` uses an ASCII apostrophe. Matching sales instead would fail every
// parity assertion on a character.
//
// Recorded rather than silently differing, because the next person to notice will
// otherwise "fix" it and break the acceptance test.
//
// ===========================================================================
// RAPPEN ARE NOT DROPPED HERE, UNLIKE IN SALES
// ===========================================================================
// Sales rounds to whole francs, on the argument that every deal value is a round
// figure and `CHF 24'000.00` reads like a bill rather than a pipeline number.
// That argument does not survive contact with bookkeeping: a bilan has to balance
// to the rappen, and a rounded total that appears to disagree with its own lines
// is the single most alarming thing an accounting screen can show. Two decimals,
// always.

/** The digit grouping mark. ASCII apostrophe, matching the mockup. */
const GROUP = "'"

/**
 * A CHF amount as the mockup writes it: `CHF 1'234.50`, and `CHF -1'234.50` for
 * a negative.
 *
 * `value` is the decimal string a route serves. Null in, em dash out, so an
 * absent amount is visibly absent rather than a misleading zero.
 */
export function money(value: string | number | null | undefined, currency = 'CHF'): string {
  const n = amount(value)
  if (n === null) return '—'
  return `${currency} ${group(n)}`
}

/** Just the grouped number, for a tile that carries its currency in the label. */
export function group(n: number): string {
  const sign = n < 0 ? '-' : ''
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)}.${frac}`
}

/**
 * Parse a wire amount for ARITHMETIC IN THE VIEW ONLY — a chart height, a
 * percentage, a sort key.
 *
 * Never use this to compute a figure that is then displayed as money, and never
 * to compute one that is stored. Money arithmetic belongs in SQL and in the
 * derivation layer, over `numeric`, where nothing rounds.
 */
export function amount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * A date as Swiss bookkeeping writes it: `05.01.2026`.
 *
 * Takes the wire form `"2026-01-05"` and slices it. Deliberately no `Date`
 * involved: a Postgres `date` has no time of day, and constructing a Date from
 * one puts it at midnight in whatever timezone the reader happens to be in,
 * which silently shifts a booking across a year boundary for anyone west of
 * Greenwich.
 */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return '—'
  return `${d}.${m}.${y}`
}

/** A percentage for a VAT rate: `8.1%`, and `0%` rather than `0.0%`. */
export function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—'
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`
}
