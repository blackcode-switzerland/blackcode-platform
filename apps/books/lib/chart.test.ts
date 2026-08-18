// The chart template agrees with the chart the seeded books actually have.
//
// ===========================================================================
// WHY THIS PIN MATTERS MORE THAN IT LOOKS
// ===========================================================================
// `lib/derive/parity.test.ts` proves the derivations against the mockup's numbers,
// and those numbers were produced with the mockup's chart. A `PME_CHART` that
// drifted from `fixtures/mockup.json` would leave that proof intact and worthless:
// it would be a statement about a chart no real book has, while every book created
// through `createEntity` used a different one.
//
// This file is also where the reasoning in `chart.ts`'s header is checked rather
// than asserted. The claim "art. 959a al. 4 separation lives on the statement line,
// not on the account" is only safe if every account the fixture flags
// `related_party` maps to a position `BILAN_STRUCTURE` marks `related`. If that
// stopped being true, dropping the column would start losing a legal distinction.
//
// Importing the fixture here is fine and importing it from app code is not. The
// rule in `docs/frontend.md` is about the RUNTIME reading development data; a test
// comparing the template to the data it was drawn from has to see both.

import { describe, it, expect } from 'vitest'
import { PME_CHART } from './chart'
import { BILAN_STRUCTURE, STATEMENT_POSITIONS } from './statements'
import fixture from '../fixtures/mockup.json'

interface FxAccount {
  no: string
  class: number
  label: { fr: string; enSuffix: string }
  statement: string
  statement_position: string
  related_party?: boolean
}

const FX = (fixture as unknown as { ACCOUNTS: FxAccount[] }).ACCOUNTS

describe('the PME chart template', () => {
  it('has the accounts the fixture has, in the same order', () => {
    expect(FX.length, 'the fixture itself changed shape').toBe(26)
    expect(PME_CHART.map((a) => a.no)).toEqual(FX.map((a) => a.no))
  })

  it('matches field for field', () => {
    const problems: string[] = []
    for (const fx of FX) {
      const t = PME_CHART.find((a) => a.no === fx.no)
      if (!t) {
        problems.push(`${fx.no} is in the fixture and not in PME_CHART`)
        continue
      }
      if (t.class !== fx.class) problems.push(`${fx.no}: class ${t.class} vs fixture ${fx.class}`)
      if (t.statement !== fx.statement) problems.push(`${fx.no}: statement ${t.statement} vs ${fx.statement}`)
      if (t.statement_position !== fx.statement_position) {
        problems.push(`${fx.no}: position ${t.statement_position} vs ${fx.statement_position}`)
      }
      // The label is what a screen prints, so a typo here is a typo on a filing.
      if (t.label.fr !== fx.label.fr) problems.push(`${fx.no}: fr "${t.label.fr}" vs "${fx.label.fr}"`)
      if (t.label.enSuffix !== fx.label.enSuffix) {
        problems.push(`${fx.no}: enSuffix "${t.label.enSuffix}" vs "${fx.label.enSuffix}"`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('maps every account to a real statement position', () => {
    // `account.statement_position` is a NOT NULL FK to `books.statement_position`.
    // An account that failed this would make `createEntity` throw on the insert, so
    // this is the check that turns a runtime failure into a build failure.
    const unknown = PME_CHART.filter((a) => !STATEMENT_POSITIONS.has(a.statement_position))
    expect(
      unknown.map((a) => `${a.no} -> ${a.statement_position}`),
      'these positions do not exist, so the foreign key would refuse the account'
    ).toEqual([])
  })

  it('numbers each account consistently with its class', () => {
    // The Swiss plan encodes the class in the first digit. Nothing reads the number
    // to get the class, but a mismatch means one of the two is a typo, and the
    // consequences differ: the class decides the bilan sign flip.
    const wrong = PME_CHART.filter((a) => Number(a.no[0]) !== a.class)
    expect(wrong.map((a) => `${a.no} declared class ${a.class}`)).toEqual([])
  })

  it('has unique account numbers', () => {
    // `UNIQUE (entity_id, no)` would refuse a duplicate, one book in.
    const seen = new Set<string>()
    const dupes = PME_CHART.filter((a) => (seen.has(a.no) ? true : (seen.add(a.no), false)))
    expect(dupes.map((a) => a.no)).toEqual([])
  })

  it('puts every related-party account on a position that is presented separately', () => {
    // The claim being checked: dropping the fixture's account-level `related_party`
    // flag loses nothing, because art. 959a al. 4 separation is carried by the
    // statement line. That holds only while these agree.
    const relatedPositions = new Set(
      BILAN_STRUCTURE.flatMap((g) => g.lines.filter((l) => l.related).map((l) => l.pos))
    )
    expect(relatedPositions.size, 'no bilan line is marked related any more').toBeGreaterThan(0)

    const flagged = FX.filter((a) => a.related_party)
    expect(flagged.length, 'the fixture flags no related-party account any more').toBe(2)

    for (const fx of flagged) {
      const t = PME_CHART.find((a) => a.no === fx.no)!
      expect(
        relatedPositions.has(t.statement_position),
        `account ${fx.no} is a related-party account and sits on "${t.statement_position}", ` +
          'which the bilan does NOT present separately. Art. 959a al. 4 separation would be lost.'
      ).toBe(true)
    }
  })

  it('carries the classes the derivations depend on', () => {
    // Not a tautology over the data above: it states the shape `bilanFor` and
    // `crFor` assume. Class 2 is the only sign flip on the bilan, and CR accounts
    // must never be class 1 or 2 or their movement would be read as a balance.
    for (const a of PME_CHART) {
      if (a.statement === 'bilan') expect([1, 2], `${a.no} is on the bilan`).toContain(a.class)
      else expect(a.class, `${a.no} is on the compte de résultat`).toBeGreaterThan(2)
    }
  })
})
