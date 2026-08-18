// The matcher agrees with every judgment the mockup baked in.
//
// ===========================================================================
// THE FIXTURE IS THE ORACLE, AND IT TESTS BOTH DIRECTIONS
// ===========================================================================
// The mockup has no matcher to port: its `matched_rule_id` values are Andrea's
// judgments stored as data. So the test is not "two implementations agree" (as
// in parity.test.ts) but "the algorithm reproduces the human's verdicts":
//
//   POSITIVE  every entry linked to a rule satisfies `matchesRule` against it,
//             OR is the entry that TAUGHT the rule (created_from) — 1001 is
//             taught-by and must NOT silently start matching.
//   NEGATIVE  every unrecognized entry matches NO active rule of its book.
//             One leak here and the completeness signal lies.
//
// Both directions are checked against ALL seventeen entries and all seven
// rules, so a loosened matcher (drops the source test, say) fails the negative
// direction rather than passing everything harder.

import { describe, it, expect } from 'vitest'
import { matchesRule, suggestFor, entryAmount, needsHuman } from './recognition'
import fixture from '../../fixtures/mockup.json'

interface FxRule {
  id: number
  entity_id: number
  source_id: number | null
  active: boolean
  pattern: { counterparty?: string | null; amount_chf?: number | null; tolerance_chf?: number | null; interval?: string | null }
  created_from: number | null
}
interface FxTx {
  id: number
  entity_id: number
  source_id: number | null
  raw_label: string
  recognition: string
  matched_rule_id: number | null
  lines: { account: string | null; debit: number; credit: number }[]
}

const F = fixture as unknown as { RECOGNITION_RULES: FxRule[]; TX: FxTx[] }
const ruleById = new Map(F.RECOGNITION_RULES.map((r) => [r.id, r]))

const asEntry = (t: FxTx) => ({
  source_id: t.source_id,
  raw_label: t.raw_label,
  lines: t.lines.map((l) => ({ debit: l.debit, credit: l.credit })),
})

describe('the matcher against the fixture', () => {
  it('is not testing air', () => {
    expect(F.TX.filter((t) => t.matched_rule_id !== null).length).toBeGreaterThan(4)
    expect(F.TX.filter((t) => t.recognition === 'unrecognized').length).toBeGreaterThan(2)
  })

  it('reproduces every positive judgment, or knows the entry taught the rule', () => {
    for (const t of F.TX) {
      if (t.matched_rule_id === null) continue
      const rule = ruleById.get(t.matched_rule_id)!
      const fired = matchesRule(asEntry(t), rule)
      const taught = rule.created_from === t.id
      expect(
        fired || taught,
        `entry ${t.id} is linked to rule ${rule.id} but neither matches it nor taught it`
      ).toBe(true)
    }
  })

  it('knows 1001 is taught-by, not matched — the two provenances stay distinct', () => {
    // The frozen-UBS rent that taught rule 101. The rule is keyed to the WIR
    // account where rent is paid from NOW; if this ever starts matching, the
    // source test has been loosened and the pair key is gone.
    const t = F.TX.find((x) => x.id === 1001)!
    const rule = ruleById.get(t.matched_rule_id!)!
    expect(matchesRule(asEntry(t), rule)).toBe(false)
    expect(rule.created_from).toBe(1001)
  })

  it('leaks nothing: no unrecognized entry matches any active rule of its book', () => {
    for (const t of F.TX) {
      if (t.recognition !== 'unrecognized') continue
      const rules = F.RECOGNITION_RULES.filter((r) => r.entity_id === t.entity_id)
      const hits = suggestFor(asEntry(t), rules)
      expect(hits.map((r) => r.id), `entry ${t.id} ("${t.raw_label}") would be silently explained`).toEqual([])
    }
  })

  it('enforces the pair: same merchant text on the wrong source stays unmatched', () => {
    // The doctrine case, synthetic so it survives fixture edits: rule keyed to
    // source 501, identical label arriving through source 502.
    const rule = { source_id: 501, active: true, pattern: { counterparty: 'IMMOREGIE', amount_chf: null, tolerance_chf: null } }
    const onTracked = { source_id: 501, raw_label: 'WIR-PMT IMMOREGIE SA', lines: [{ debit: 1850, credit: 0 }] }
    const onUntracked = { ...onTracked, source_id: 502 }
    expect(matchesRule(onTracked, rule)).toBe(true)
    expect(matchesRule(onUntracked, rule)).toBe(false)
  })

  it('treats tolerance as centime-exact arithmetic, not float arithmetic', () => {
    const rule = { source_id: 1, active: true, pattern: { counterparty: 'X', amount_chf: 89.9, tolerance_chf: 5 } }
    const at = (debit: number | string) => ({ source_id: 1, raw_label: 'X', lines: [{ debit, credit: 0 }] })
    expect(matchesRule(at('94.90'), rule), 'exactly on the upper bound').toBe(true)
    expect(matchesRule(at('94.91'), rule), 'one rappen over').toBe(false)
    expect(matchesRule(at('84.90'), rule), 'exactly on the lower bound').toBe(true)
    expect(matchesRule(at('84.89'), rule), 'one rappen under').toBe(false)
  })

  it('matches any amount when the pattern sets none (rule 104, Stripe)', () => {
    const rule = ruleById.get(104)!
    const t = F.TX.find((x) => x.matched_rule_id === 104)!
    expect(rule.pattern.amount_chf).toBeNull()
    expect(matchesRule(asEntry(t), rule)).toBe(true)
    expect(matchesRule({ ...asEntry(t), lines: [{ debit: 999999, credit: 0 }] }, rule)).toBe(true)
  })

  it('lets null source equal null source, for the RI, and nothing else', () => {
    const rule = ruleById.get(107)! // CAISSE DE COMPENSATION, source null
    expect(rule.source_id).toBeNull()
    const sourceless = { source_id: null, raw_label: 'CAISSE DE COMPENSATION AVS', lines: [{ debit: 640, credit: 0 }] }
    expect(matchesRule(sourceless, rule)).toBe(true)
    expect(matchesRule({ ...sourceless, source_id: 501 }, rule)).toBe(false)
  })

  it('refuses an inactive rule and a rule with no counterparty fragment', () => {
    const entry = { source_id: 1, raw_label: 'ANYTHING', lines: [{ debit: 1, credit: 0 }] }
    expect(matchesRule(entry, { source_id: 1, active: false, pattern: { counterparty: 'ANY' } })).toBe(false)
    expect(matchesRule(entry, { source_id: 1, active: true, pattern: { counterparty: null } })).toBe(false)
    expect(matchesRule(entry, { source_id: 1, active: true, pattern: null })).toBe(false)
  })

  it('sums debit lines as the movement (entry 1004, GitHub at 43.70 within 44±3)', () => {
    const t = F.TX.find((x) => x.id === 1004)!
    expect(entryAmount(asEntry(t))).toBe(4370n)
    expect(matchesRule(asEntry(t), ruleById.get(102)!)).toBe(true)
  })

  it('puts unrecognized and inferred on the worklist, and nothing else', () => {
    expect(needsHuman({ recognition: 'unrecognized' })).toBe(true)
    expect(needsHuman({ recognition: 'inferred' })).toBe(true)
    expect(needsHuman({ recognition: 'known_recurring' })).toBe(false)
    expect(needsHuman({ recognition: 'known_one_off' })).toBe(false)
    // The seeded double-entry worklist is exactly these five.
    const listed = F.TX.filter((t) => needsHuman(t)).map((t) => t.id).sort()
    expect(listed).toEqual([1009, 1011, 1012, 1013, 2004])
  })
})
