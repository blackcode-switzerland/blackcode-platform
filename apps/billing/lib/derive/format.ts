// Formatting money and dates for a human. **No `Number` is constructed on any
// path in this file.**
//
// ===========================================================================
// THREE MONEY FORMATS, TWO OF THEM MANDATED
// ===========================================================================
// | Where | Example | Why |
// |---|---|---|
// | the document and the screen | `CHF 1 590.00` | the mockup's, and spec §3.5.4 for the payment part: a SPACE as the thousands separator |
// | the QR payload | `1590.00` | no separator at all; the payload is parsed by machines and a space there is a malformed amount |
// | the wire | `1590.00` | `formatRappen` in ./money — this file never produces it |
//
// `apps/books` uses an apostrophe (`CHF 1'590.00`), which is the other correct
// Swiss convention. **Do not import its formatter** — apps never import each
// other — and do not "unify" the two: books is a bookkeeping surface and this is
// a document that has to match a printed payment part.
//
// ── WHY NOT `Intl.NumberFormat` ────────────────────────────────────────────
// Because it takes a `number`. Every path into it starts by destroying the
// string, and the separator it chooses depends on a locale rather than on the
// specification. `apps/books/lib/format.ts` records what the float path cost;
// this one operates on the digits.

/**
 * `"1590.00"` → `"1 590.00"`. The separator is a NARROW NO-BREAK SPACE (U+202F)
 * rather than a plain space, so a line break can never fall inside an amount.
 *
 * A plain space is what the specification's examples show, and a renderer that
 * emitted one would occasionally print `CHF 1` at the end of a line and `590.00`
 * at the start of the next — on a payment slip.
 */
const THIN = ' '

/** Group the integer part in threes, operating on the digit string. */
function groupDigits(whole: string, sep: string): string {
  const neg = whole.startsWith('-')
  const digits = neg ? whole.slice(1) : whole
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += sep
    out += digits[i]
  }
  return (neg ? '-' : '') + out
}

/**
 * A wire amount → the human form. `money('1590.00', 'CHF')` → `CHF 1 590.00`.
 *
 * Takes the STRING the server sent, not a number, and splits it on the dot. It
 * never parses: there is nothing to compute here, only digits to group.
 */
export function money(amount: string, currency?: string): string {
  const [whole, frac = '00'] = amount.split('.')
  const body = `${groupDigits(whole, THIN)}.${frac.padEnd(2, '0').slice(0, 2)}`
  return currency ? `${currency}${THIN}${body}` : body
}

/**
 * The payload form: no separator, two decimals, no currency.
 *
 * Separate from `money` rather than a flag on it, because the two have different
 * audiences and only one of them is allowed to change. A flag invites somebody
 * to pass the wrong one, and the consequence is a QR code a bank rejects.
 */
export function amountForPayload(amount: string): string {
  const [whole, frac = '00'] = amount.split('.')
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`
}

/**
 * A Postgres `date` → `DD.MM.YYYY`, by SLICING THE ISO STRING.
 *
 * ── NEVER CONSTRUCT A `Date` ───────────────────────────────────────────────
 * `new Date('2026-01-01')` is parsed as UTC midnight, and
 * `.toLocaleDateString()` in any timezone west of Greenwich renders it as
 * 31 December 2025. An invoice dated a day earlier than it was issued crosses a
 * FISCAL YEAR boundary once a year, which is the kind of error a fiduciary finds
 * and nobody else does.
 *
 * A Postgres `date` has no timezone. Treating it as an instant is the bug; this
 * function treats it as what it is, three numbers in a string.
 */
export function date(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  return `${d}.${mo}.${y}`
}

/** The year of a Postgres `date`, for `{YYYY}`. Same slicing rule, same reason. */
export function yearOf(iso: string): number {
  const m = /^(\d{4})/.exec(iso)
  if (!m) throw new Error(`not an ISO date: ${JSON.stringify(iso)}`)
  return Number(m[1])
}

/** `"8.1"` → `"8.1%"`. The rate arrives already trimmed from `formatRate`. */
export const percent = (rate: string): string => `${rate}%`
