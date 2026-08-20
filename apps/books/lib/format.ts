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

// ===========================================================================
// THE DISPLAY PATH NEVER CONSTRUCTS A NUMBER — FIXED 2026-08-17
// ===========================================================================
// `money()` used to be `group(amount(value))`, and `amount()` is `Number(value)`.
// So every rendered franc went string → float64 → `toFixed(2)` → string, three
// lines below `amount()`'s own docstring saying "never use this to compute a
// figure that is then displayed as money".
//
// Measured before the change: lossless for all 200 000 sampled values across the
// full `numeric(14,2)` range — and wrong the moment a value carries a third
// decimal, which is what a VAT computation produces. `"0.145"` rendered `0.14`
// and `"8.005"` rendered `8.01`: the same input shape rounding in opposite
// directions, because that is binary floating point and not a rule anybody chose.
// `"1e3"` rendered `CHF 1'000.00`, because `Number()` accepts scientific notation
// and a bookkeeping amount is never written that way.
//
// The rounding below is decimal and half-away-from-zero, applied to the digits.
// It is what a person doing it on paper does, it is what Postgres `numeric` does,
// and it does not depend on how a value happens to sit in a mantissa.
//
// **Output is unchanged for every value `numeric(14,2)` can hold.** That was the
// constraint: this removes a latent fault, it does not restyle anything.

/** The digit grouping mark. ASCII apostrophe, matching the mockup. */
const GROUP = "'"

/**
 * The negative marker, and where it sits.
 *
 * ── OPEN, AND DELIBERATELY ONE EDIT WIDE ──────────────────────────────────
 * The mockup's `fmtCHF` writes `−CHF 1'234.50` — U+2212 MINUS SIGN, before the
 * currency (verified by hexdump of `bbooks-data.js`). This app writes
 * `CHF -1'234.50`: ASCII hyphen, after. Two differences at once, against a phase
 * 1 acceptance test that this file's own header says compares output string for
 * string against that mockup.
 *
 * Which one moves is a specification decision and not this file's to take, so
 * today's output is preserved exactly and the decision is concentrated here.
 * When it is answered, it is these two constants and nothing else.
 */
const MINUS = '-'
const MINUS_LEADS_CURRENCY = false

/** A bookkeeping amount, as digits. Scientific notation is not one. */
const DECIMAL = /^-?\d+(\.\d+)?$/

/**
 * A CHF amount as the mockup writes it: `CHF 1'234.50`, and `CHF -1'234.50` for
 * a negative.
 *
 * `value` is the decimal string a route serves, and it stays a string the whole
 * way through — see the header above. Null, blank, or anything that is not a
 * plain decimal gives an em dash, so an absent or malformed amount is visibly
 * absent rather than a confident wrong number.
 */
export function money(value: string | number | null | undefined, currency = 'CHF'): string {
  const s = decimalOf(value)
  if (s === null) return '—'
  const negative = s.startsWith('-')
  const body = grouped(negative ? s.slice(1) : s)
  if (body === null) return '—'
  const sign = negative && !isZero(body) ? MINUS : ''
  return MINUS_LEADS_CURRENCY ? `${sign}${currency} ${body}` : `${currency} ${sign}${body}`
}

/**
 * Just the grouped number, for a tile that carries its currency in its label.
 *
 * Takes a `number` because its callers are view arithmetic — a chart axis, a
 * total of things already parsed. A value straight off the wire belongs in
 * `money()`, which never parses.
 */
export function group(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const s = n.toFixed(2)
  const negative = s.startsWith('-')
  const body = grouped(negative ? s.slice(1) : s)
  if (body === null) return '—'
  return `${negative && !isZero(body) ? MINUS : ''}${body}`
}

/** `"1234.5"` → `"1'234.50"`. Digits only, no sign, or `null` if it is not one. */
function grouped(unsigned: string): string | null {
  const [rawInt = '', rawFrac = ''] = unsigned.split('.')
  if (!/^\d+$/.test(rawInt)) return null
  const [int, frac] = toTwoDecimals(rawInt, rawFrac)
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)}.${frac}`
}

/**
 * Round a digit string to two decimals, half away from zero, by carrying through
 * the digits. No `Number` is constructed, so nothing depends on binary rounding.
 */
function toTwoDecimals(int: string, frac: string): [string, string] {
  if (frac.length <= 2) return [int, frac.padEnd(2, '0')]
  if (frac.charCodeAt(2) - 48 < 5) return [int, frac.slice(0, 2)]

  const digits = (int + frac.slice(0, 2)).split('')
  let i = digits.length - 1
  for (;;) {
    if (i < 0) {
      digits.unshift('1')
      break
    }
    if (digits[i] === '9') {
      digits[i] = '0'
      i -= 1
      continue
    }
    digits[i] = String(Number(digits[i]) + 1)
    break
  }
  const carried = digits.join('')
  return [carried.slice(0, -2), carried.slice(-2)]
}

/** `-0.001` rounds to zero, and a signed zero is not a thing a ledger prints. */
function isZero(body: string): boolean {
  return /^[0']*\.00$/.test(body)
}

/** The wire value as a plain decimal string, or `null` if it is not one. */
function decimalOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  // A `number` caller already holds a float and there is nothing left to protect;
  // `toFixed` is the last honest thing that can be done with it.
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : null
  const t = value.trim()
  return DECIMAL.test(t) ? t : null
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
 * A recognition rule's match window: `~CHF 1'850.00 ±5.00`, or `any amount`.
 *
 * ── IT TAKES NUMBERS, AND THAT IS THE WIRE'S FAULT, NOT A LOOSENING ───────
 * `books.rule.pattern` is `jsonb` and `publicRule` passes the column through, so
 * `amount_chf` and `tolerance_chf` arrive as JSON floats (`1850`, `89.9`) rather
 * than as `numeric` strings. Every other amount in this app is a string and must
 * stay one; these two never were.
 *
 * **This is not money and must never be rendered by `<Money>`.** It is a MATCH
 * THRESHOLD — the window inside which a future payment looks like this rule —
 * and no figure in anybody's books is computed from it. Keeping it out of the
 * money component is what stops the exception spreading: `<Money>`'s prop is
 * `string | null` with no numeric overload precisely so a float cannot reach the
 * display path, and widening that for this one field would remove the guard
 * everywhere.
 *
 * `money()` already accepts a `number` and routes it through the same grouping,
 * so nothing new parses anything here. **No `Number()` is constructed on a wire
 * string** — this file's rule is intact.
 *
 * A null amount is `any amount`, in words: a rule with no expected amount
 * matches every one, and rendering that as an em dash would read as missing data
 * rather than as the deliberate wildcard it is.
 */
export function ruleAmount(
  amountChf: number | null | undefined,
  toleranceChf: number | null | undefined
): string {
  if (amountChf === null || amountChf === undefined) return 'any amount'
  const base = `~${money(amountChf)}`
  if (!toleranceChf) return base
  // `money(x, '')` returns a leading space where the currency would have been.
  return `${base} ±${money(toleranceChf, '').trim()}`
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

/**
 * A percentage for a VAT rate: `8.1%`, and `0%` rather than `0.0%`.
 *
 * ── IT TAKES THE WIRE STRING, BECAUSE THAT IS WHAT THE WIRE SENDS ─────────
 * `entry.tva.rate` is `numeric(4,2)` and arrives as `"8.10"`, not `8.1`
 * (verified against `GET …/entries` on 2026-08-18; `lib/types.ts` declared it as
 * a `number` and was corrected). Taking only a `number` here would have put a
 * `Number()` at every call site — the precise thing this file's header exists to
 * prevent — so the string is handled HERE, by trimming digits rather than by
 * parsing.
 *
 * The `number` overload stays for a rate a view computed. A malformed value is
 * an em dash, like `money()`: a rate this function does not recognise must look
 * absent, never render as `0%`, which is a legally different claim.
 */
export function percent(rate: string | number | null | undefined): string {
  if (rate === null || rate === undefined || rate === '') return '—'
  if (typeof rate === 'number') {
    return Number.isFinite(rate) ? `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%` : '—'
  }
  const t = rate.trim()
  if (!DECIMAL.test(t)) return '—'
  // Trim the trailing zeros off the fraction, then the point if nothing is left.
  // `"8.10"` → `8.1`, `"0.00"` → `0`, `"2.60"` → `2.6`. No float is constructed,
  // so a rate cannot round on its way to the screen.
  const trimmed = t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t
  return `${trimmed === '' || trimmed === '-' ? '0' : trimmed}%`
}
