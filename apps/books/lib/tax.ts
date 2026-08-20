// The tax snapshot's citations, and the two flags that decide what a figure is
// allowed to claim.
//
// ===========================================================================
// EVERY FIGURE ON THAT SCREEN CARRIES ITS ARTICLE, AND THIS IS WHERE IT COMES
// FROM
// ===========================================================================
// The phase brief: *"A tax estimate without the article it rests on is a number
// somebody might file."* The articles are not in this app — they are in
// `books.tax_params.params`, per book, filed with the rates they justify, so a
// book in another canton arrives with its own and this bundle needs no release.
// **Nothing here spells a rate, a coefficient, a canton or an article.**
//
// ── AND `params` IS A `jsonb` COLUMN SERVED VERBATIM ─────────────────────
// It is `unknown` on the wire (`lib/db/schema.ts` declares no `.$type<>()`), so
// `lib/wire-parity.test.ts` cannot hold a shape over it and this file is the
// only guard. Two shapes are already in the seed and BOTH are legitimate:
// `ifd.citation` is a plain string, `communal.citation` is a `{fr, en}` pair.
// A screen reading `.citation` straight would render `[object Object]` on one of
// the four blocks — which is why this is a function with a test rather than a
// property access in JSX.
//
// ===========================================================================
// `confirmed: false` IS THE MOST IMPORTANT FIELD ON THE PAYLOAD
// ===========================================================================
// The seeded `capital_tax` block is unconfirmed and carries an `open_question`
// for the fiduciary: whether the cantonal and communal coefficients apply to the
// per-mille rate, and what taxable equity means for a small SA. The seed's own
// comment records that the mockup marked it confirmed while carrying the open
// question in the same block, and that `false` is the honest flag.
//
// A figure rendered without that flag has turned an open question into a number
// somebody might file. So `isConfirmed` is STRICT — `=== true` — and every other
// value, including a missing field, reads as not confirmed. A parameter block
// that forgot to say must never be presented as settled.

import { en } from './label'
import type { Label, TaxParamBlock } from './types'

/** A `{fr, en}` pair with at least one side that says something. */
function isLabel(v: unknown): v is Label {
  if (!v || typeof v !== 'object') return false
  const o = v as { fr?: unknown; en?: unknown }
  const speaks = (x: unknown) => typeof x === 'string' && x.trim().length > 0
  return speaks(o.fr) || speaks(o.en)
}

/**
 * A field that may be a bare string or a `{fr, en}` pair, as one string.
 *
 * The English side is taken when there is one, which is D-A's rule for chrome —
 * and a citation is chrome, not statutory wording. The article number inside it
 * (`art. 68 LIFD`) is identical in both halves; what differs is the prose around
 * it, and translating THAT is not what D-A protects. `legal()` is for the bilan
 * and the compte de résultat line names and belongs nowhere near here.
 *
 * Returns `null`, never `''`: an absent citation is a fact the screen must be
 * able to state, and an empty string renders as a blank cell that reads as a
 * layout bug.
 */
export function citationText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (isLabel(v)) {
    const t = en(v).trim()
    return t === '' ? null : t
  }
  return null
}

/** The citation on a parameter block, or null when it carries none. */
export function blockCitation(block: TaxParamBlock | undefined): string | null {
  return citationText(block?.citation)
}

/**
 * Has a fiduciary confirmed this parameter?
 *
 * **STRICT.** `=== true` and nothing else. `undefined`, `null`, `"true"` and `1`
 * all read as not confirmed, because the only value that means "somebody
 * answered" is the boolean the seed writes. Mutation to watch it fire: relax it
 * to `!!block?.confirmed` and `lib/tax.test.ts` goes red on the string case.
 */
export function isConfirmed(block: TaxParamBlock | undefined): boolean {
  return block?.confirmed === true
}

/**
 * The open question a parameter block carries, if it carries one.
 *
 * Present on the seeded `capital_tax` block and nowhere else. It is the
 * fiduciary's outstanding question in their own terms, and the screen prints it
 * beside the figure it qualifies rather than as a footnote — a caveat the reader
 * has to scroll to is a caveat that did not happen.
 */
export function openQuestion(block: TaxParamBlock | undefined): string | null {
  const q = block?.open_question
  if (typeof q === 'string') return q.trim() === '' ? null : q.trim()
  if (isLabel(q)) {
    const t = en(q).trim()
    return t === '' ? null : t
  }
  return null
}

/**
 * Any note the block carries beyond its citation — the cantonal coefficient's
 * `coefficient_note`, the communal block's `validity`.
 *
 * Read by KEY rather than by scanning every field, because a parameter block is
 * `unknown` and a generic "print everything that looks like text" would print
 * `confirmed` and the rates as prose. Two keys, both in the seed, both meaning
 * "how long this number is good for or where it came from".
 */
export function blockNote(block: TaxParamBlock | undefined): string | null {
  const note = block?.coefficient_note
  if (typeof note === 'string' && note.trim()) return note.trim()
  if (isLabel(note)) {
    const t = en(note).trim()
    if (t) return t
  }
  const validity = block?.validity
  if (typeof validity === 'string' && validity.trim()) return `Valid ${validity.trim()}`
  return null
}

/**
 * Is every parameter this snapshot rests on confirmed?
 *
 * The four blocks the seed carries, asked one by one. A snapshot with any
 * unconfirmed parameter says so at the TOP of the screen, before the reader has
 * read a figure — the same reasoning as `openQuestion`'s placement.
 *
 * A block that is absent counts as unconfirmed. That is deliberate and it is the
 * conservative direction: a book whose parameters name no capital tax at all
 * should not be told its capital tax is settled.
 */
export function allConfirmed(params: {
  ifd?: TaxParamBlock
  cantonal?: TaxParamBlock
  communal?: TaxParamBlock
  capital_tax?: TaxParamBlock
}): boolean {
  return (
    isConfirmed(params.ifd) &&
    isConfirmed(params.cantonal) &&
    isConfirmed(params.communal) &&
    isConfirmed(params.capital_tax)
  )
}

/**
 * A tax rate, exact. **`percent()` from `lib/format.ts` is WRONG here, and this
 * was found by reading the screen against `bk`, not by review.**
 *
 * `percent(16.23)` renders `16.2%` and `percent(13.97)` renders `14.0%`: its
 * number branch is `rate.toFixed(1)`, which ROUNDS. That is correct for what it
 * was built for — a VAT rate is one of `8.1, 2.6, 3.8, 0` and the seeded wire
 * form is the string `"8.10"` — and it is wrong for these two, which the server
 * computes as `Math.round(x * 100) / 100` off a coefficient stack.
 *
 *     bk books tax --entity blackcode   statutory 16.23% · effective 13.97%
 *     percent()                         16.2%             · 14.0%
 *
 * A tax rate misstated by four hundredths on a screen whose whole claim is that
 * every figure is checkable against the CLI is a small error of exactly the kind
 * this product exists to refuse. `lib/format.ts`'s header says not to "fix"
 * `percent()` — its rounding is load-bearing for the phase-1 acceptance test —
 * so this is a second function rather than a change to that one.
 *
 * It prints the number the server sent, unchanged: `16.23` → `16.23%`. No
 * `toFixed`, so no rounding and no invented trailing zero. A value that is not a
 * finite number is an em dash, like `money()` — a rate this function cannot read
 * must look absent rather than render as `0%`, which is a legally different
 * claim.
 */
export function ratePercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${rate}%`
}
