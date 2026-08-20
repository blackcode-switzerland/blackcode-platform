// The category template agrees with the categories the seeded books have, and
// every account it names is one a new book actually starts with.
//
// ===========================================================================
// THE PIN THAT MATTERS
// ===========================================================================
// `lib/derive/parity.test.ts` proves the analytique's breakdown against the
// mockup's numbers, and those numbers were produced with the mockup's five
// buckets. A `DEFAULT_CATEGORIES` that drifted from `fixtures/mockup.json`
// would leave that proof intact and worthless — a statement about a grouping
// no created book has, while every book from `createEntity` used another.
//
// The second case is the one that would have caught the original bug's cousin:
// a category naming an account outside `PME_CHART` is a bucket that silently
// collects nothing in every new book, because `costBreakdown` matches on
// account number and a new book's chart is exactly the template.
//
// Importing the fixture here is fine and importing it from app code is not —
// see `chart.test.ts` for the same note.

import { describe, it, expect } from 'vitest'
import { DEFAULT_CATEGORIES, takesDefaultCategories } from './categories'
import { PME_CHART } from './chart'
import fixture from '../fixtures/mockup.json'

interface FxCategory {
  key: string
  accounts: string[]
  label: { fr: string; en: string }
}

const FX = (fixture as unknown as { ANALYTIQUE_CATEGORIES: FxCategory[] }).ANALYTIQUE_CATEGORIES

describe('DEFAULT_CATEGORIES', () => {
  it('is exactly what the seeded books group their costs by', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.key)).toEqual(FX.map((c) => c.key))
    for (const fx of FX) {
      const t = DEFAULT_CATEGORIES.find((c) => c.key === fx.key)
      expect(t, `the seed has "${fx.key}" and the template does not`).toBeDefined()
      expect(t!.accounts, `"${fx.key}" collects different accounts`).toEqual(fx.accounts)
      expect(t!.label).toEqual(fx.label)
    }
  })

  it('names only accounts a new book starts with', () => {
    const chart = new Set(PME_CHART.map((a) => a.no))
    for (const c of DEFAULT_CATEGORIES) {
      for (const no of c.accounts) {
        expect(chart.has(no), `category "${c.key}" collects ${no}, which PME_CHART does not carry`).toBe(true)
      }
    }
  })

  it('collects only compte de résultat accounts — a bilan account is not a cost', () => {
    // `createCategory` refuses this with `not_a_flow_account`; the template must
    // satisfy its own door.
    const cr = new Set(PME_CHART.filter((a) => a.statement === 'cr').map((a) => a.no))
    for (const c of DEFAULT_CATEGORIES) {
      for (const no of c.accounts) {
        expect(cr.has(no), `category "${c.key}" collects ${no}, which is not a cr account`).toBe(true)
      }
    }
  })

  it('every key satisfies the door that would reject it', () => {
    // Same regex as `createCategory`'s `bad_key`.
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.key, `"${c.key}" would be refused by createCategory`).toMatch(/^[a-z][a-z0-9_]{0,39}$/)
    }
  })

  it('no account is claimed by two buckets', () => {
    // A double-counted charge is the one arithmetic error a breakdown can make
    // that still looks plausible.
    const seen = new Map<string, string>()
    for (const c of DEFAULT_CATEGORIES) {
      for (const no of c.accounts) {
        expect(seen.has(no), `${no} is in both "${seen.get(no)}" and "${c.key}"`).toBe(false)
        seen.set(no, c.key)
      }
    }
  })

  it('the REGIME decides, not the legal form', () => {
    // An RI electing double entry (art. 957 al. 2) derives its breakdown the
    // account-mapped way and gets the template; `seed.ts` tests `legal_form`
    // instead, which is why this is spelled out.
    expect(takesDefaultCategories('double_entry')).toBe(true)
    expect(takesDefaultCategories('simplified')).toBe(false)
  })
})
