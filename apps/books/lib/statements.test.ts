// The statutory structures, checked against the mockup that specifies them.
//
// ===========================================================================
// WHY THIS TEST AND NOT A CODE REVIEW
// ===========================================================================
// lib/statements.ts is law transcribed by hand from art. 959a / 959b CO, by way
// of the mockup that is this app's specification. A transcription can drop a line,
// reorder two, or typo a `pos` — and none of those fail at build time. They fail
// as a bilan that does not balance, or an account whose money silently leaves the
// statement it legally belongs on, months later.
//
// So the fixture is the oracle: `fixtures/mockup.json` is `bbooks-data.js` dumped
// verbatim, and these tests assert this app agrees with it.
//
// This also discharges phase 0's "validation at load, fail loud" requirement for
// `statement_position`. There is deliberately no fallback "autre" bucket, so an
// unmapped account has to be caught, and here is where it is caught.

import { describe, it, expect } from 'vitest'
import { BILAN_STRUCTURE, CR_STRUCTURE, STATEMENT_POSITIONS, isStatementPosition } from './statements'
import fixture from '../fixtures/mockup.json'

interface FixtureAccount {
  no: string
  class: number
  statement: string
  statement_position: string
}

const accounts = fixture.ACCOUNTS as unknown as FixtureAccount[]

describe('statutory structures agree with the mockup', () => {
  it('discovers the fixture (guards against a vacuous pass)', () => {
    // Every assertion below iterates the fixture. An empty fixture would make
    // all of them pass while checking nothing, which is the failure mode this
    // repo's guards exist to avoid.
    expect(accounts.length).toBeGreaterThan(0)
    expect(BILAN_STRUCTURE.length).toBeGreaterThan(0)
    expect(CR_STRUCTURE.length).toBeGreaterThan(0)
  })

  it('has the same bilan lines, in the same order, as the mockup', () => {
    const mine = BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos))
    const theirs = (fixture.BILAN_STRUCTURE as unknown as { lines: { pos: string }[] }[]).flatMap(
      (g) => g.lines.map((l) => l.pos)
    )
    // Order matters and is the point: art. 959a dictates it. `toEqual` on arrays
    // compares position by position, which is what makes this a real check.
    expect(mine).toEqual(theirs)
  })

  it('has the same compte de résultat lines, in the same order and with the same signs', () => {
    const mine = CR_STRUCTURE.map((l) => `${l.pos}:${l.sign}`)
    const theirs = (fixture.CR_STRUCTURE as unknown as { pos: string; sign: number }[]).map(
      (l) => `${l.pos}:${l.sign}`
    )
    expect(mine).toEqual(theirs)
  })

  it('keeps the French statutory wording, which the filed PDF has to reproduce', () => {
    const mine = new Map(
      BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => [l.pos, l.label.fr] as const))
    )
    for (const g of fixture.BILAN_STRUCTURE as unknown as {
      lines: { pos: string; label: { fr: string } }[]
    }[]) {
      for (const l of g.lines) {
        expect(mine.get(l.pos), `bilan line ${l.pos}`).toBe(l.label.fr)
      }
    }
  })

  it('marks the same lines as related-party (art. 959a al. 4 separate presentation)', () => {
    const mine = BILAN_STRUCTURE.flatMap((g) => g.lines.filter((l) => l.related).map((l) => l.pos))
    const theirs = (fixture.BILAN_STRUCTURE as unknown as {
      lines: { pos: string; related?: boolean }[]
    }[]).flatMap((g) => g.lines.filter((l) => l.related).map((l) => l.pos))
    expect(mine.sort()).toEqual(theirs.sort())
  })
})

describe('every account maps to exactly one legal line', () => {
  it('maps every account in the chart, with no unknown position', () => {
    // The load-time guarantee, asserted. An account pointing at a position that
    // does not exist would otherwise contribute to no statement line at all: its
    // money would simply not appear, and the bilan would still "balance".
    const unmapped = accounts.filter((a) => !isStatementPosition(a.statement_position))
    expect(
      unmapped.map((a) => `${a.no} -> ${a.statement_position}`),
      'accounts whose statement_position is not a line of either statement'
    ).toEqual([])
  })

  it('puts bilan accounts on bilan lines and CR accounts on CR lines', () => {
    const bilanPositions = new Set(BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos)))
    const crPositions = new Set(CR_STRUCTURE.map((l) => l.pos))
    const crossed = accounts.filter((a) =>
      a.statement === 'bilan'
        ? !bilanPositions.has(a.statement_position)
        : !crPositions.has(a.statement_position)
    )
    expect(
      crossed.map((a) => `${a.no} (${a.statement}) -> ${a.statement_position}`),
      'accounts mapped onto the wrong statement'
    ).toEqual([])
  })

  it('has no position claimed by both statements', () => {
    const bilanPositions = BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos))
    const crPositions = CR_STRUCTURE.map((l) => l.pos)
    const overlap = bilanPositions.filter((p) => crPositions.includes(p))
    expect(overlap).toEqual([])
  })

  it('exposes every line of both statements as a valid position', () => {
    const declared = BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos)).length + CR_STRUCTURE.length
    expect(STATEMENT_POSITIONS.size).toBe(declared)
  })
})

describe('the chart uses the Swiss PME class convention', () => {
  it('sends classes 1-2 to the bilan and 3-8 to the compte de résultat', () => {
    const wrong = accounts.filter((a) =>
      a.class <= 2 ? a.statement !== 'bilan' : a.statement !== 'cr'
    )
    expect(wrong.map((a) => `${a.no} class ${a.class} -> ${a.statement}`)).toEqual([])
  })
})
