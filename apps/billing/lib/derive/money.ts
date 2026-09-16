// Decimal strings ⇄ integer minor units, and nothing else.
//
// ===========================================================================
// WHY THIS FILE EXISTS AT ALL
// ===========================================================================
// Money is a `numeric(14,2)` column, a decimal STRING on the wire, and an
// INTEGER COUNT OF RAPPEN inside every calculation. Nothing in this app ever
// holds an amount as a JavaScript `number` with a fractional part.
//
// `apps/books/lib/format.ts` records what the float path cost when it was
// string → `Number()` → `toFixed(2)`: `"0.145"` and `"8.005"` rounded in
// OPPOSITE directions, because neither is exactly representable in binary
// floating point and the nearest double falls on a different side of the
// midpoint in each case. `"1e3"` rendered as `CHF 1'000.00` — `Number()` accepts
// exponent notation and nobody had asked it not to.
//
// **Do not import that file.** Apps never import each other
// (`lib/app-isolation.test.ts`). This is the same approach, written here.
//
// ── THE ONE THING TO UNDERSTAND BEFORE EDITING ─────────────────────────────
// An invoice wrong in the last rappen is not a rounding curiosity. It is a
// document that does not match the payment slip attached to it, which means a
// bank reconciliation that does not close and a bill somebody has to reissue.

/** Rappen: 1/100 of a franc. Every amount in this app is an integer count. */
export type Rappen = number

/**
 * The scale of a quantity: `numeric(12,3)`, so a thousandth of a unit.
 *
 * Quantities are not money and are deliberately not rounded to the rappen —
 * half an hour is a real quantity, and rounding it would be rounding the wrong
 * thing.
 */
const QTY_SCALE = 1000

/**
 * Parse a decimal string into an integer count of minor units at `scale`.
 *
 * ── IT IS A PARSER, NOT A CAST, AND THAT IS THE POINT ──────────────────────
 * `Number('1e3') * 100` is 100000. `parseMinor('1e3', 100)` throws. Postgres
 * `numeric` never emits exponent notation, so anything that looks like it came
 * from somewhere else — a hand-written request body, a spreadsheet paste, a
 * client that stringified a float — and refusing is the only safe answer. The
 * alternative is a bill for a thousand times the intended amount.
 *
 * Extra decimal places are refused rather than truncated. A caller sending
 * `"10.005"` for a price has either made a mistake or means something this
 * column cannot hold, and silently keeping `"10.00"` would make the invoice
 * disagree with what they sent.
 */
export function parseMinor(value: string, scale: number): number {
  const s = value.trim()
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s)
  if (!m) {
    throw new Error(
      `not a plain decimal: ${JSON.stringify(value)}. ` +
        'Exponent notation, currency symbols, thousands separators and empty strings are all ' +
        'refused rather than guessed at — see lib/derive/money.ts.'
    )
  }
  const [, sign, whole, frac = ''] = m
  const places = String(scale).length - 1
  if (frac.length > places) {
    // Trailing zeros are not extra precision, so `"10.500"` at scale 100 is fine.
    if (!/^0+$/.test(frac.slice(places))) {
      throw new Error(
        `${JSON.stringify(value)} has more than ${places} decimal place(s), which this column ` +
          'cannot hold. Refused rather than truncated: keeping a different number from the one ' +
          'the caller sent is how an invoice comes to disagree with its own request.'
      )
    }
  }
  const padded = (frac + '0'.repeat(places)).slice(0, places)
  const n = Number(whole) * scale + Number(padded || '0')
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${JSON.stringify(value)} is too large to hold exactly`)
  }
  return sign === '-' ? -n : n
}

/** A decimal string → integer rappen. */
export const parseRappen = (value: string): Rappen => parseMinor(value, 100)

/** A quantity string → integer thousandths. */
export const parseQty = (value: string): number => parseMinor(value, QTY_SCALE)

/**
 * Integer rappen → the decimal string the wire carries. Always two places.
 *
 * Built by string surgery on the integer, never by division: `1590 / 100` is
 * exactly 15.9 here but `2010 / 100` is 20.1 and `(0.1).toFixed(20)` shows why
 * that is not a promise worth relying on.
 */
export function formatRappen(r: Rappen): string {
  const neg = r < 0
  const abs = Math.abs(r)
  const whole = Math.trunc(abs / 100)
  const cents = abs % 100
  return `${neg ? '-' : ''}${whole}.${String(cents).padStart(2, '0')}`
}

/**
 * A VAT rate as BASIS POINTS: `"8.1"` → `810`, `"0"` → `0`, `"2.6"` → `260`.
 *
 * Basis points rather than a float because the rate is a multiplicand and every
 * multiplication has to stay in integers. `numeric(5,2)` gives two decimal
 * places, which is exactly one hundredth of a percent.
 */
export const parseRateBp = (rate: string): number => parseMinor(rate, 100)

/** `810` → `"8.1"`, for a label. Trailing zeros trimmed, because `TVA 8.10%` reads wrong. */
export function formatRate(bp: number): string {
  const s = formatRappen(bp)
  return s.replace(/\.?0+$/, '')
}

/**
 * Round half AWAY FROM ZERO — not JavaScript's `Math.round`, which rounds half
 * UP and therefore treats −0.5 and +0.5 differently.
 *
 * The asymmetry matters here because a credit note is a negative amount, and a
 * rule that rounded −2.5 to −2 while rounding 2.5 to 3 would make a credit note
 * and the invoice it cancels fail to sum to zero.
 *
 * Takes a numerator and denominator rather than a fraction so the division
 * happens once, here, on integers.
 */
export function divRoundHalfAway(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1
  const n = Math.abs(numerator)
  return sign * Math.floor((n * 2 + denominator) / (2 * denominator))
}

/**
 * Round to the nearest multiple of `step` rappen, half away from zero.
 *
 * `step` is 5 for the Swiss five-rappen rounding. Note that this is applied to
 * an amount ALREADY in rappen, so `roundToStep(247, 5)` is 245 and
 * `roundToStep(248, 5)` is 250.
 */
export function roundToStep(r: Rappen, step: number): Rappen {
  if (step <= 1) return r
  return divRoundHalfAway(r, step) * step
}

/**
 * The quantity × price multiplication, in integers, with the scaling made
 * explicit.
 *
 * `qtyMilli` is thousandths of a unit and `priceRappen` is rappen, so the
 * product is thousandths-of-a-rappen and has to come back down by 1000. Doing
 * that in one rounded division rather than two is what keeps
 * `1.5 × 10.00 = 15.00` exact and `0.333 × 100.00 = 33.30` right.
 */
export const lineProduct = (qtyMilli: number, priceRappen: Rappen): Rappen =>
  divRoundHalfAway(qtyMilli * priceRappen, QTY_SCALE)
