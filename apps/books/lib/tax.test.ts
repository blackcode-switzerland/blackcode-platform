// The tax snapshot's citations and its two flags.
//
// `books.tax_params.params` is a `jsonb` column served verbatim, so it crosses
// the wire as `unknown` and `lib/wire-parity.test.ts` structurally cannot hold a
// shape over it (#55). This file is the guard, and the two shapes it defends
// against are both already in the seed: `ifd.citation` is a plain string and
// `communal.citation` is a `{fr, en}` pair. A screen reading `.citation`
// straight renders `[object Object]` on one of the four blocks.
//
// Every case was watched fail before it was kept.

import { describe, it, expect } from 'vitest'
import {
  allConfirmed,
  blockCitation,
  blockNote,
  citationText,
  isConfirmed,
  openQuestion,
  ratePercent,
} from './tax'
import { percent } from './format'

// The four blocks exactly as `bk books tax --entity blackcode` serves them.
const IFD = { rate_pct: 8.5, citation: 'art. 68 LIFD', confirmed: true }
const CANTONAL = {
  base_rate_pct: 3.3333333333333335,
  coefficient_pct: 155,
  coefficient_note: {
    fr: 'Coefficient cantonal 155% (stable depuis 2021, reconduit 2026)',
    en: 'Cantonal coefficient 155% (stable since 2021, renewed 2026)',
  },
  citation: 'LI VD (RSV 642.11) · vd.ch/impots — impôt sur le bénéfice PM',
  confirmed: true,
}
const COMMUNAL = {
  coefficient_pct: 77,
  validity: '2024–2027',
  citation: {
    fr: "Arrêté d'imposition de Renens 2024–2027 (renens.ch) ; tableau officiel des impôts communaux vd.ch",
    en: 'Renens tax decree 2024–2027 (renens.ch); official vd.ch communal tax table',
  },
  confirmed: true,
}
const CAPITAL = {
  base_rate_permille: 0.6,
  imputation: true,
  citation: 'art. 118 LI VD · vd.ch/impots — impôt sur le capital',
  confirmed: false,
  open_question: {
    fr: 'Reste à confirmer avec la fiduciaire : application exacte des coefficients…',
    en: 'Still to confirm with the fiduciary: exact application of the (cantonal/communal) coefficients to the 0.6‰ rate, and the precise taxable-equity definition for a small SA.',
  },
}

describe('citationText — two shapes, both in the seed', () => {
  // Mutation watched: made it `String(v)`. Red on the communal case, which
  // became `[object Object]` — the exact string that would have shipped under
  // one of the four figures on the taxes screen.
  it('reads a bare string and a {fr, en} pair alike', () => {
    expect(citationText(IFD.citation)).toBe('art. 68 LIFD')
    expect(citationText(COMMUNAL.citation)).toMatch(/^Renens tax decree/)
  })

  // D-A: English chrome. A citation is chrome — the article number inside it is
  // identical in both halves, and what differs is the prose around it.
  it('takes the English side of a pair, and falls back to the French', () => {
    expect(citationText({ fr: 'art. 1 CO', en: 'art. 1 CO (English)' })).toBe('art. 1 CO (English)')
    expect(citationText({ fr: 'art. 1 CO', en: '' })).toBe('art. 1 CO')
  })

  // ── NULL, NEVER `''` ──────────────────────────────────────────────────
  // An absent citation is a fact `<CitedFigure>` must be able to STATE, in red.
  // An empty string renders as a blank line that reads as a layout bug.
  // Mutation watched: returned `''` instead of null. Red, and the component's
  // refusal branch stopped rendering — a figure then shipped with no article and
  // nothing saying so, which is the one thing that screen exists to prevent.
  it('an absent or unreadable citation is null, so the screen can refuse it', () => {
    for (const bad of [undefined, null, '', '   ', {}, { fr: '', en: '' }, 42, []]) {
      expect(citationText(bad)).toBeNull()
    }
  })

  it('blockCitation survives a block that is not there at all', () => {
    expect(blockCitation(undefined)).toBeNull()
    expect(blockCitation({})).toBeNull()
    expect(blockCitation(CAPITAL)).toMatch(/^art\. 118 LI VD/)
  })
})

describe('isConfirmed is STRICT, and everything else is not confirmed', () => {
  // A figure rendered without this flag has turned an open question into a
  // number somebody might file. The conservative direction is the only safe one.
  //
  // Mutation watched: relaxed it to `!!block?.confirmed`. Red on `'false'` — the
  // string — and on `1`. Both are truthy, and either would have marked the
  // capital tax settled if a writer ever spelled the flag that way.
  it('only the boolean true counts', () => {
    expect(isConfirmed({ confirmed: true })).toBe(true)
    for (const v of [false, 'true', 'false', 1, 0, null, undefined, {}]) {
      expect(isConfirmed({ confirmed: v })).toBe(false)
    }
  })

  it('a block with no flag, and a block that is not there, are both unconfirmed', () => {
    expect(isConfirmed({})).toBe(false)
    expect(isConfirmed(undefined)).toBe(false)
  })

  // The seed, as it actually stands: three confirmed, one not.
  it('the seeded parameters are not all confirmed, and capital_tax is the one', () => {
    expect(isConfirmed(IFD)).toBe(true)
    expect(isConfirmed(CANTONAL)).toBe(true)
    expect(isConfirmed(COMMUNAL)).toBe(true)
    expect(isConfirmed(CAPITAL)).toBe(false)
    expect(
      allConfirmed({ ifd: IFD, cantonal: CANTONAL, communal: COMMUNAL, capital_tax: CAPITAL })
    ).toBe(false)
  })

  // ── A MISSING BLOCK IS UNCONFIRMED, NOT VACUOUSLY CONFIRMED ───────────
  // Mutation watched: rewrote `allConfirmed` as
  // `Object.values(params).every(isConfirmed)`. **GREEN on every case above**,
  // and TRUE for `{}` — a book whose parameters name no capital tax at all would
  // have been told its capital tax was settled. This is the case that catches it.
  it('an empty parameter set is not "everything confirmed"', () => {
    expect(allConfirmed({})).toBe(false)
    expect(allConfirmed({ ifd: IFD })).toBe(false)
  })
})

describe('openQuestion — the fiduciary’s outstanding question, beside its figure', () => {
  it('reads the pair the seed carries', () => {
    expect(openQuestion(CAPITAL)).toMatch(/Still to confirm with the fiduciary/)
  })

  it('a bare string works too, and an absent one is null', () => {
    expect(openQuestion({ open_question: 'ask her' })).toBe('ask her')
    expect(openQuestion(IFD)).toBeNull()
    expect(openQuestion(undefined)).toBeNull()
    expect(openQuestion({ open_question: '  ' })).toBeNull()
  })
})

describe('blockNote — read by KEY, never by scanning', () => {
  // A parameter block is `unknown`; a generic "print anything that looks like
  // text" would print the rates and `confirmed` as prose.
  //
  // Mutation watched: added a fallback that joined every string value in the
  // block. Red — the cantonal block then rendered its citation twice and the
  // communal one printed `2024–2027` without the word "Valid".
  it('picks up the cantonal coefficient note and the communal validity', () => {
    expect(blockNote(CANTONAL)).toMatch(/^Cantonal coefficient 155%/)
    expect(blockNote(COMMUNAL)).toBe('Valid 2024–2027')
  })

  it('a block with neither has no note, rather than an invented one', () => {
    expect(blockNote(IFD)).toBeNull()
    expect(blockNote(CAPITAL)).toBeNull()
    expect(blockNote(undefined)).toBeNull()
  })
})

describe('ratePercent — exact, because `percent()` rounds a tax rate', () => {
  // ── THE BUG THIS FUNCTION EXISTS FOR, PINNED AS A COMPARISON ──────────
  // Found by reading the rendered screen against `bk books tax`, not by review:
  // the taxes page showed `16.2%` and `14.0%` where the CLI prints `16.23%` and
  // `13.97%`. `percent()`'s number branch is `toFixed(1)`.
  //
  // This asserts BOTH — that `percent` really does round these two, and that
  // `ratePercent` does not. If `percent()` ever stops rounding, the first half
  // goes red and this function can be reconsidered rather than quietly kept.
  it('percent() rounds these two, which is why they do not go through it', () => {
    expect(percent(16.23)).toBe('16.2%')
    expect(percent(13.97)).toBe('14.0%')
  })

  // The exact figures `bk books tax --entity blackcode` prints on the seeded
  // book, character for character.
  it('renders the server’s number unchanged', () => {
    expect(ratePercent(16.23)).toBe('16.23%')
    expect(ratePercent(13.97)).toBe('13.97%')
    expect(ratePercent(0)).toBe('0%')
    expect(ratePercent(8.5)).toBe('8.5%')
  })

  // Mutation watched (2026-08-19): made it `${(rate ?? 0)}%`. Red on all four —
  // an unreadable rate then rendered as `0%`, which says the book pays no tax.
  it('a rate it cannot read is an em dash, never a zero', () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      expect(ratePercent(bad as number)).toBe('—')
    }
  })
})
