// The search boxes over the rules table and the sources register.
//
// ===========================================================================
// WHAT THIS GUARDS, AND HOW IT WAS WATCHED GO RED
// ===========================================================================
// A search box has two ways to be quietly wrong, and neither shows on screen:
//
//   1. **It hides rows it should not.** An empty query that filters, an
//      accent-folded comparison that changes what a word means, a case-
//      sensitive match. The reader sees a shorter table and no reason for it.
//   2. **It reads fewer fields than the table shows.** The cell is right there,
//      the reader types what is in it, and gets "no rule matches that search".
//      This is the one that rots: a column added to `<RulesPanel>` or to
//      `<SourceRegister>` is invisible to the filter unless somebody remembers
//      the other file.
//
// (2) is why `ruleFields` and `sourceFields` are values in `lib/search.ts`
// rather than a loop over `Object.values(row)`, and why the tests below assert
// each rendered field BY NAME with a fixture that carries a distinct value in
// every one of them. It is a list, so it can be short; it cannot be short
// silently.
//
// ── MUTATIONS WATCHED, 2026-08-21 ────────────────────────────────────────
//   a) `matchesQuery` returning `false` for an empty query
//        → "an empty query hides nothing" red (7 rules became 0).
//   b) `ruleFields` with `rule.account` deleted from the list
//        → "every field the rules table renders is searchable" red on `account`.
//   c) `sourceFields` with `source.method` deleted
//        → same test red on `method`.
//   d) `matchesQuery` comparing without `.toLowerCase()` on the field
//        → "the match folds case, on both sides" red.

import { describe, it, expect } from 'vitest'
import { filterRows, matchesQuery, normalizeQuery, ruleFields, sourceFields } from './search'
import type { RecognitionRule, Source } from './types'

/**
 * One rule with a DISTINCT, searchable value in every field the table renders.
 *
 * Distinct on purpose: if two fields shared a token, dropping one from
 * `ruleFields` would still pass on the other's account.
 */
const RULE: RecognitionRule = {
  number: 4,
  active: true,
  source: 7,
  learned_from: 'subscription',
  pattern: { counterparty: 'IMMOREGIE', amount_chf: 2800, tolerance_chf: 5, interval: 'monthly' },
  explanation: { fr: 'Loyer des bureaux', en: 'Office rent' },
  account: '6000',
  created_from: 12,
  created_on: '2026-01-05',
  note: { fr: 'Bail signé', en: 'Signed lease' },
} as RecognitionRule

const SOURCE: Source = {
  number: 3,
  name: 'WIR Bank',
  type: 'bank',
  layer: 'routing_app',
  entity: 'blackcode',
  method: 'camt053',
  expected: 'monthly',
  last_import: '2026-06-30',
  retired: false,
  ledger_accounts: ['1020'],
  status: 'stale',
  windows: { stale_after_days: 45, gap_after_days: 90 },
  notes_freeform: { fr: 'Relation gelée', en: 'Frozen relationship' },
} as Source

/** The reader's side of a `{fr, en}` pair — `useLabel()`, as English. */
const en = (l: { fr: string; en?: string | null } | null | undefined) =>
  l ? (l.en ?? l.fr) : ''

describe('the inputs — assert them, or the checks below prove nothing', () => {
  it('the fixtures carry a value in every field the tables render', () => {
    // Without this, a fixture that lost a field would make the coverage test
    // below skip that field and stay green. Same reason `cli-parity` asserts it
    // found routes at all.
    const rule = ruleFields(RULE, en)
    expect(rule.filter((f) => f !== null && f !== '').length, 'a rule field is blank').toBe(
      rule.length
    )
    const source = sourceFields(SOURCE, en)
    expect(source.filter((f) => f !== null && f !== '').length, 'a source field is blank').toBe(
      source.length
    )
  })
})

describe('an empty query hides nothing', () => {
  it('matches every row', () => {
    expect(matchesQuery(['anything'], '')).toBe(true)
    expect(matchesQuery([null, undefined], '   ')).toBe(true)
    // Through the filter, which is what the components call.
    const rows = [RULE, { ...RULE, number: 5 }]
    expect(filterRows(rows, '', (r) => ruleFields(r, en))).toHaveLength(2)
    expect(filterRows(rows, '  ', (r) => ruleFields(r, en))).toHaveLength(2)
  })

  it('an undefined row list stays undefined, so the table still says "loading"', () => {
    // `<DataTable>` distinguishes `undefined` (in flight) from `[]` (nothing).
    // Filtering an in-flight list into `[]` would render "no source matches"
    // over a request that has not answered.
    expect(filterRows(undefined, 'x', () => [])).toBeUndefined()
  })
})

describe('the match itself', () => {
  it('folds case, on both sides', () => {
    expect(matchesQuery(['IMMOREGIE'], 'immo')).toBe(true)
    expect(matchesQuery(['immoregie'], 'IMMO')).toBe(true)
  })

  it('does not fold accents — they are letters in one of the two languages', () => {
    // Deliberate and stated in `lib/search.ts`: `dépenses` must find `dépenses`
    // and `resume` must not find `résumé`.
    expect(matchesQuery(['Dépenses courantes'], 'dépenses')).toBe(true)
    expect(matchesQuery(['résumé'], 'resume')).toBe(false)
  })

  it('is a substring, not a prefix', () => {
    expect(matchesQuery(['Office rent'], 'rent')).toBe(true)
  })

  it('normalizes the query the same way everywhere', () => {
    expect(normalizeQuery('  ImmO  ')).toBe('immo')
    expect(normalizeQuery(null)).toBe('')
  })

  it('a query nothing carries matches nothing', () => {
    expect(filterRows([RULE], 'zzzz', (r) => ruleFields(r, en))).toHaveLength(0)
  })
})

describe('every field the rules table renders is searchable', () => {
  // Each entry is a column of `<RulesPanel>` and the value that column shows.
  // A column added there without a line here is a cell a reader can see and
  // cannot search.
  const CELLS: [string, string][] = [
    ['counterparty', 'IMMOREGIE'],
    ['explanation', 'Office rent'],
    ['note', 'Signed lease'],
    ['account', '6000'],
    ['learned_from', 'subscription'],
    ['source', 'source 7'],
    ['interval', 'monthly'],
  ]

  for (const [name, typed] of CELLS) {
    it(`finds a rule by its ${name}`, () => {
      expect(
        filterRows([RULE], typed, (r) => ruleFields(r, en)),
        `typing "${typed}" — which this table PRINTS — found no rule. ` +
          `Add ${name} to ruleFields() in lib/search.ts.`
      ).toHaveLength(1)
    })
  }
})

describe('every field the sources register renders is searchable', () => {
  const CELLS: [string, string][] = [
    ['name', 'WIR'],
    ['type', 'bank'],
    ['layer', 'routing_app'],
    ['book', 'blackcode'],
    ['method', 'camt053'],
    ['cadence', 'monthly'],
    ['status', 'stale'],
    ['ledger account', '1020'],
    ['freeform note', 'Frozen relationship'],
  ]

  for (const [name, typed] of CELLS) {
    it(`finds a source by its ${name}`, () => {
      expect(
        filterRows([SOURCE], typed, (s) => sourceFields(s, en)),
        `typing "${typed}" — which this table PRINTS — found no source. ` +
          `Add ${name} to sourceFields() in lib/search.ts.`
      ).toHaveLength(1)
    })
  }

  it('does not match on the window sizes, which are not words', () => {
    // `stale > 45d · gap > 90d` is rendered, and it is a threshold rather than
    // anything a reader searches by. Included here so the omission is a
    // DECISION on the record rather than something nobody noticed.
    expect(filterRows([SOURCE], '45', (s) => sourceFields(s, en))).toHaveLength(0)
  })
})
