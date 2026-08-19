// Which journal a book keeps, and which filters that journal will answer.
//
// ── WHAT THIS ASKS, EXACTLY ─────────────────────────────────────────────
// It calls `journalFor` over every regime in `REGIMES` plus the values that are
// not regimes at all, and `journalAccepts` over every (journal, filter) pair
// including the `null` journal. Both halves are asserted: what each one ALLOWS
// (first, and it is the half that makes the refusals mean something — CLAUDE.md
// finding #16) and what each one refuses.
//
// ── WHY THIS MODULE IS WORTH A TEST OF ITS OWN ──────────────────────────
// It is the only thing standing between a screen and a payload of the wrong
// shape. `GET …/entries` serves two shapes with **no marker field on the wire**,
// so nothing downstream can recover the answer if this gets it wrong: the ledger
// renders whatever it is handed. On 2026-08-19, before the branch existed, that
// meant six recettes-dépenses movements drawn as écritures, with the amount —
// the only number an RI row carries — missing from the screen entirely, and six
// links into another book's records. Nothing threw.
//
// ── WHAT IT DOES NOT ASK ────────────────────────────────────────────────
// It does not open a page, so it cannot see whether `useEntries` and
// `useRiEntries` are still the ones the ledger calls, nor whether `<AccountRef>`
// still asks before building a link. That half is held by the type — `journal`
// is a required argument on both hooks and a required field on
// `AccountRefScope` — and by the browser checks recorded in the phase report.
//
// It also does not verify the SERVER's behaviour. That was tested by running it:
// `bk books entry list --entity ri --status posted` answers 400
// `ri_no_such_filter`, and the same command without the filter answers six rows
// of a different shape. Both are in the report.

import { describe, it, expect } from 'vitest'
import {
  JOURNAL_NAME,
  REGIMES,
  filtersFor,
  journalAccepts,
  journalFor,
  type Journal,
  type LedgerFilter,
} from './journal'

const JOURNALS: readonly Journal[] = ['grand_livre', 'recettes_depenses']
const FILTERS: readonly LedgerFilter[] = ['status', 'account', 'recognition']

describe('which journal a book keeps', () => {
  // Anti-vacuous. Every loop below is over `REGIMES`; an emptied list would make
  // all of them statements about nothing.
  it('knows about every regime this app declares', () => {
    expect(REGIMES.length, 'the regime list shrank — this file is stale').toBe(2)
    expect([...REGIMES]).toContain('simplified')
    expect([...REGIMES]).toContain('double_entry')
  })

  // THE POSITIVE CASES FIRST. A function returning null for everything passes
  // every refusal below and would leave the ledger permanently unable to say
  // which journal it is looking at.
  it('maps each known regime to its journal, and every regime has one', () => {
    expect(journalFor('double_entry')).toBe('grand_livre')
    expect(journalFor('simplified')).toBe('recettes_depenses')
    for (const regime of REGIMES) {
      expect(journalFor(regime), `${regime} has no journal`).not.toBeNull()
    }
  })

  // The branch is POSITIVE, so anything not enumerated is null rather than
  // falling into whichever arm a `!==` would have left open. A third regime
  // added server-side is the case this is really about, and it cannot be
  // written as a `BookkeepingRegime`, which is why the parameter is a wide
  // string — see the function's own note.
  it('answers null for a regime it has not been taught, rather than guessing', () => {
    expect(journalFor('cash_basis')).toBeNull()
    expect(journalFor('DOUBLE_ENTRY')).toBeNull()
    expect(journalFor('')).toBeNull()
  })

  it('answers null when there is no book in hand at all', () => {
    expect(journalFor(null)).toBeNull()
    expect(journalFor(undefined)).toBeNull()
  })

  it('names both journals, so a screen never renders a blank heading', () => {
    for (const journal of JOURNALS) {
      expect(JOURNAL_NAME[journal].fr.length, `${journal} has no French name`).toBeGreaterThan(0)
      expect(JOURNAL_NAME[journal].en.length, `${journal} has no English name`).toBeGreaterThan(0)
    }
  })
})

describe('which filters a journal will answer', () => {
  // POSITIVE FIRST, again, and this is the one that would otherwise rot: a
  // `journalAccepts` that returned false for everything would make every RI
  // assertion below pass while silently removing the income statement's
  // drill-down from the double-entry books it was built for.
  it('the grand livre takes all three — the drill-down depends on two of them', () => {
    expect(journalAccepts('grand_livre', 'account')).toBe(true)
    expect(journalAccepts('grand_livre', 'status')).toBe(true)
    expect(journalAccepts('grand_livre', 'recognition')).toBe(true)
    expect([...filtersFor('grand_livre')].sort()).toEqual([...FILTERS].sort())
  })

  // `recognition` is the one the route's own suggestion says works on both
  // journals: "drop --status/--account; --recognition works on both journals".
  it('the RI journal takes recognition, and that is not nothing', () => {
    expect(journalAccepts('recettes_depenses', 'recognition')).toBe(true)
    expect(filtersFor('recettes_depenses')).toContain('recognition')
  })

  // The two that are REFUSED, not ignored: 400 `ri_no_such_filter`. Both were
  // being sent — the ledger's status chip and `<AccountRef>`'s `?status=posted`
  // — and both were reproduced as errors in a browser on 2026-08-19.
  it('the RI journal refuses status and account — they are 400s, not no-ops', () => {
    expect(journalAccepts('recettes_depenses', 'status')).toBe(false)
    expect(journalAccepts('recettes_depenses', 'account')).toBe(false)
    expect(filtersFor('recettes_depenses')).not.toContain('status')
    expect(filtersFor('recettes_depenses')).not.toContain('account')
  })

  // The conservative direction, stated as a rule rather than left to be
  // discovered: a missing filter is a WIDER list, and a refused one is a screen
  // with an error box where the ledger should be. So an unknown journal sends
  // nothing. The ledger says so on the page rather than dropping it silently.
  it('an unknown journal accepts nothing at all', () => {
    for (const filter of FILTERS) {
      expect(journalAccepts(null, filter), `${filter} was sent to an unknown journal`).toBe(false)
    }
    expect(filtersFor(null)).toEqual([])
  })

  it('every journal answers about every filter, so no pair is undefined', () => {
    for (const journal of JOURNALS) {
      for (const filter of FILTERS) {
        expect(
          typeof journalAccepts(journal, filter),
          `${journal} × ${filter} is not a boolean`
        ).toBe('boolean')
      }
    }
  })
})
