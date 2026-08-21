// The ledger's result count may not claim a total, because there is not one.
//
// ===========================================================================
// WHY A TEST OVER COPY, AND NOT OVER CODE
// ===========================================================================
// `GET …/entries` serves `{ data, next_cursor }` and **no count of any kind**,
// and `listEntries` caps its answer at `limit ?? 100` (clamped to 500) while the
// ledger screen sends no `limit`. So on a book with more than a hundred
// écritures the page holds a page, and the only true sentence it can print is
// about the page.
//
// Nothing in the code can go wrong here — `rows.length` is `rows.length`. What
// can go wrong is the WORDING, and it is one sentence away: "115 entries" reads
// as a total to anybody who has ever seen a result count, and "115 of 200" is a
// figure this screen would have to invent. The failure mode of this feature is
// a translator, or a later reader, tightening the copy. So the copy is what is
// asserted.
//
// The rule is mechanical and therefore checkable: **the ledger's count strings
// interpolate `{n}` and nothing else.** A second placeholder is a second number,
// and the only second number available would be a made-up one.
//
// ── IT DISCRIMINATES, AND THAT IS ASSERTED TOO ────────────────────────────
// A check that only ever says "no key contains {total}" would pass just as
// happily against a dictionary where NO key contains anything — CLAUDE.md's
// finding #16, a guard satisfied by an absent subject. So the positive half is
// here as well: `table.searchMatches` — the rules and sources search, where the
// whole list IS in memory and "N of M" is true — must carry BOTH placeholders.
// If the scanner cannot see `{total}` there, it cannot see it anywhere.
//
// ── MUTATIONS WATCHED, 2026-08-21 ────────────────────────────────────────
//   a) `'ledger.countMany': '{n} of {total} entries on this page'` (en)
//        → "the ledger's count claims no total" red, naming en/ledger.countMany.
//   b) the same in `fr` only
//        → red, naming fr — so a French-only regression is caught.
//   c) `'table.searchMatches': '{n} shown'`
//        → "the scanner can see a total when there is one" red.
//   d) `ledger.countOne` renamed
//        → "the keys this guards still exist" red.

import { describe, it, expect } from 'vitest'
import { LOCALES } from '@blackcode/platform-i18n'
import { DICTIONARY } from './dictionary'

/**
 * The ledger's result-count strings. Every one of them talks about a PAGE.
 *
 * Named by hand, and that is the weakness of this guard: a fifth count key
 * added to the ledger and not added here is not checked. It is a short list in
 * one file and the comment beside the keys points here — the alternative, a
 * prefix match on `ledger.count`, would silently stop covering a key somebody
 * spelled `ledger.rowCount`. Both fail the same way; this one at least reads
 * as a list somebody has to maintain. (CLAUDE.md finding #22 is the same shape
 * one level up: a registry a new member must opt into.)
 */
const PAGE_COUNTS = [
  'ledger.countOne',
  'ledger.countMany',
  'ledger.riCountOne',
  'ledger.riCountMany',
] as const

/** Every `{placeholder}` in a string. */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

describe('the inputs', () => {
  it('the keys this guards still exist, in both languages', () => {
    for (const locale of LOCALES) {
      for (const key of PAGE_COUNTS) {
        expect(
          DICTIONARY[locale][key],
          `${locale}/${key} is gone. If it was renamed, rename it in PAGE_COUNTS too — ` +
            'a guard over a key that does not exist checks nothing.'
        ).toBeTruthy()
      }
    }
  })

  it('the scanner can see a total when there is one', () => {
    // The positive case. `table.searchMatches` is the rules/sources search
    // count, where both numbers are real because the whole list is in memory.
    for (const locale of LOCALES) {
      const found = placeholders(DICTIONARY[locale]['table.searchMatches'])
      expect(found, `${locale}/table.searchMatches lost a placeholder`).toContain('n')
      expect(found, `${locale}/table.searchMatches lost its total`).toContain('total')
    }
  })
})

describe("the ledger's count claims no total", () => {
  it('every page-count string interpolates {n} and nothing else', () => {
    const offenders: string[] = []
    for (const locale of LOCALES) {
      for (const key of PAGE_COUNTS) {
        const value = DICTIONARY[locale][key]
        const found = placeholders(value)
        if (found.length !== 1 || found[0] !== 'n') {
          offenders.push(`${locale}/${key}: "${value}" interpolates ${found.join(', ') || 'nothing'}`)
        }
      }
    }
    expect(
      offenders,
      'the ledger count may only talk about the rows on this page. `GET …/entries` serves no ' +
        'total and caps its answer at 100, so a second number in this sentence is one nobody ' +
        'has. If a total is wanted, it is a route change first:\n' + offenders.join('\n')
    ).toEqual([])
  })

  it('the caveat beside it is still there and still says what it says', () => {
    // Not a wording test — a presence test. `<ResultCount>` renders the count
    // and this caveat together; the caveat is the half that stops the number
    // reading as a total, so losing it is losing the feature.
    for (const locale of LOCALES) {
      expect(DICTIONARY[locale]['ledger.countNotTotal'].length).toBeGreaterThan(20)
      expect(placeholders(DICTIONARY[locale]['ledger.countNotTotal'])).toEqual([])
    }
  })
})
