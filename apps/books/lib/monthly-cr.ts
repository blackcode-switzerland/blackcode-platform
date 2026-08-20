// The monthly compte de résultat, arranged for a grid. Ticket #64.
//
// ===========================================================================
// WHY THIS IS A MODULE AND NOT TWELVE `map()`s INSIDE THE COMPONENT
// ===========================================================================
// Everything ticket #64 asks the screen NOT to do is arithmetic or ordering:
// do not re-derive the row order per column, do not sort a column by its own
// values, do not add the months up to make a total, and do not turn a money
// string into a number on the way to the DOM. All four are properties of a
// TRANSFORM, and this app runs its tests in a `node` environment with no DOM —
// `vitest.config.ts`, `environment: 'node'`, `include: ['**/*.test.ts']`. A
// constraint that lives inside a `.tsx` render is a constraint nothing here can
// observe, and the only guard left would be a text scan over the component,
// whose granularity is its own bug (CLAUDE.md finding #11).
//
// So the arrangement is `lib/statement-view.ts`'s: the payload becomes a plain
// view model here, `lib/monthly-cr.test.ts` asserts the four properties on real
// values, and `<MonthlyCrGrid>` renders the result without deciding anything.
//
// ===========================================================================
// MONEY IS A STRING FROM THE WIRE TO THE DOM
// ===========================================================================
// Not one value in this file is parsed, compared numerically, summed or
// rounded. `lib/format.ts`'s header records what a `Number()` on the display
// path costs — `"0.145"` and `"8.005"` rounding in opposite directions, three
// lines below the docstring forbidding it — and a twelve-column grid with a
// total is the single most tempting place in this product to write
// `months.reduce(...)`.
//
// **The total column is the ANNUAL body of the same payload**, carried through
// verbatim. The route serves the year alongside the months precisely so that it
// need not be recomputed, and `lib/monthly-cr.test.ts` pins it string-for-string
// against values a float cannot round-trip.

import { en, legal } from './label'
import type { MetaPayload } from './hooks'
import type { CrResult, Money, MonthlyCrResult } from './types'
import type { StatementLabel } from './statements'

/** The month names, for the column `title` and the screen-reader text. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** One column heading. */
export interface MonthColumn {
  /** `"2026-03"`, verbatim from the wire. The React key and the data attribute. */
  month: string
  /** `"03"` — what the narrow column header prints. */
  short: string
  /** `"March 2026"`, for the `title` and the screen-reader gloss. */
  full: string
}

/** One statutory line, across the year. */
export interface MonthlyCrRow {
  pos: string
  /** The statutory French, from the SERVED structure. */
  fr: string
  /** The English gloss. */
  en: string
  /**
   * One cell per column, in `columns` order.
   *
   * **`null` is "no amount known" and is NOT zero.** A month that traded nothing
   * arrives from the route as a full set of real `"0.00"` lines and prints
   * zeroes; a `null` here means the month's payload did not carry this `pos` at
   * all, which the route says cannot happen and which must therefore be visible
   * as an em dash if it ever does. `DECISIONS.md`: *"Em dash for an unknown
   * amount; `0.00` only for a derived zero."*
   */
  cells: (Money | null)[]
  /** The YEAR, off the wire. Never the sum of `cells`. */
  total: Money
}

export interface MonthlyCrView {
  columns: MonthColumn[]
  rows: MonthlyCrRow[]
  /** Each month's own `resultat`, then the year's. All off the wire. */
  resultat: { cells: (Money | null)[]; total: Money }
}

/** `"2026-03"` → `"March 2026"`. Sliced, never parsed into a `Date`. */
function monthColumn(month: string): MonthColumn {
  const short = month.slice(5, 7) || month
  const name = MONTH_NAMES[Number(short) - 1]
  return { month, short, full: name ? `${name} ${month.slice(0, 4)}` : month }
}

/** The raw `pos` as a label, for a line the served structure does not carry. */
function fallbackLabel(pos: string): StatementLabel {
  return { fr: pos, en: pos }
}

/**
 * The grid, from ONE payload.
 *
 * It takes the whole `CrResult` rather than `lines` and `months` separately, and
 * that is deliberate: two arguments would let a caller hand it the annual body
 * of one fetch and the months of another. The route serves them together
 * expressly so they cannot be read from two moments, and a signature that can
 * take them apart is a signature that invites somebody to.
 *
 * `meta` is `/api/meta`'s copy of the art. 959b structure — the line NAMES, which
 * no statement payload carries. Same join, on `pos`, and the same reason as
 * `lib/statement-view.ts`: importing `lib/statements.ts` into the bundle would
 * keep rendering last week's legal structure after the server's had changed.
 */
export function monthlyCrView(
  cr: CrResult & { months: MonthlyCrResult[] },
  meta: MetaPayload | undefined
): MonthlyCrView {
  const names = new Map<string, StatementLabel>()
  for (const line of meta?.statements.cr ?? []) names.set(line.pos, line.label)

  const columns = cr.months.map((m) => monthColumn(m.month))

  // `pos` → amount, per month. Built once: ten rows × twelve columns would
  // otherwise be 120 linear scans of a ten-element array.
  const amounts = cr.months.map((m) => new Map(m.lines.map((l) => [l.pos, l.amount])))

  // ── THE ROW ORDER, TAKEN ONCE FROM THE YEAR ─────────────────────────────
  // `cr.lines` is the annual body, which is art. 959b's order. Every column
  // reuses it. Nothing here sorts, and nothing re-derives a structure per month
  // — those are the two ways a reader loses the ability to follow a line across
  // the table.
  const rows: MonthlyCrRow[] = cr.lines.map((line) => {
    const label = names.get(line.pos) ?? fallbackLabel(line.pos)
    return {
      pos: line.pos,
      fr: legal(label),
      en: en(label),
      // `?? null`, not `?? '0.00'`. See `MonthlyCrRow.cells`.
      cells: amounts.map((m) => m.get(line.pos) ?? null),
      // The wire's annual figure, verbatim. Not a sum of `cells`.
      total: line.amount,
    }
  })

  return {
    columns,
    rows,
    resultat: {
      // Each month's own `resultat` — not the sum of its column, which is not
      // what a résultat is: the column is magnitudes and the sign of each line
      // is fixed by the article.
      cells: cr.months.map((m) => m.resultat),
      total: cr.resultat,
    },
  }
}
