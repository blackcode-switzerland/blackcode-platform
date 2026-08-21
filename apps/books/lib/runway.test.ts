// `lib/runway.ts` — cash from the bilan, and how long it lasts.
//
// ── THE CASE THAT MATTERS MOST IS `not_burning` ───────────────────────────
// A runway is a division and a division is where a screen invents a number. A
// naive `cash / net` on a PROFITABLE book yields a negative month count, and a
// negative runway rendered as a figure — "-14 months of cash" — is the most
// confidently wrong thing this screen could print. It is the first case below.
//
// ── MUTATIONS WATCHED GO RED, 2026-08-21 ─────────────────────────────────
//   a) `net >= 0n` weakened to `net > 0n`
//        → **GREEN. The assertion for this is INERT and that is recorded
//          rather than hidden.** A net of exactly zero also reaches
//          `burnPerMonth === 0n` and returns the same answer, so the two
//          guards overlap on that one value and no test can tell them apart.
//          The `>=` is kept for clarity, not for behaviour. What IS
//          load-bearing is the second guard, and (g) below covers it.
//   b) the `not_burning` guard removed entirely
//        → "a profitable book has no runway, not a negative one" red.
//   c) `cashFrom` using `.find()` instead of summing
//        → "two cash lines are both counted" red.
//   d) `cashFrom` returning '0.00' instead of null when there is no line
//        → "no cash line is null, not zero" red.
//   e) dividing by 12 instead of `totals.months`
//        → "the rate is per month SERVED, not per calendar month" red.
//   f) `cashFrom` reading passif lines too
//        → "only the actif side is cash" red.
//   h) `runway` taking the derived cash figure again instead of the bilan
//        → "no bilan at all is a DIFFERENT refusal from no cash line" red.
//   g) the `burnPerMonth === 0n` guard removed
//        → "a burn too small to express per month is not burning" red, with
//          `months: Infinity`.

import { describe, it, expect } from 'vitest'
import { cashFrom, runway } from './runway'
import type { BilanResult } from './types'
import type { FlowTotals } from './analytique'

function bilan(
  lines: { pos: string; amount: string; side?: 'actif' | 'passif' }[]
): BilanResult {
  return {
    entity: 'x',
    exercice: 2026,
    groups: lines.map((l) => ({
      group: { fr: 'g', en: 'g' },
      side: l.side ?? 'actif',
      lines: [{ pos: l.pos, related: false, amount: l.amount }],
    })),
    totalActif: '0.00',
    totalPassif: '0.00',
    resultat: '0.00',
    balanced: true,
    ecart: '0.00',
  } as unknown as BilanResult
}

const totals = (net: string, months: number): FlowTotals => ({
  produits: '0.00',
  charges: '0.00',
  net,
  months,
})

describe('cashFrom', () => {
  it('reads the trésorerie line', () => {
    expect(cashFrom(bilan([{ pos: 'tresorerie', amount: '72189.43' }]))).toBe('72189.43')
  })

  it('two cash lines are both counted', () => {
    // A `.find()` would silently drop the second. The statement structure has
    // one today; a payload that grew a second must not lose it in silence.
    expect(
      cashFrom(
        bilan([
          { pos: 'tresorerie', amount: '100.00' },
          { pos: 'tresorerie', amount: '50.50' },
        ])
      )
    ).toBe('150.50')
  })

  it('only the actif side is cash', () => {
    expect(
      cashFrom(
        bilan([
          { pos: 'tresorerie', amount: '10.00' },
          { pos: 'tresorerie', amount: '999.00', side: 'passif' },
        ])
      )
    ).toBe('10.00')
  })

  it('no cash line is null, not zero', () => {
    // "This bilan has no trésorerie position" and "this book holds nothing" are
    // different statements, and only the second is a figure.
    expect(cashFrom(bilan([{ pos: 'creances_clients', amount: '5.00' }]))).toBeNull()
  })

  it('an absent bilan is null', () => {
    expect(cashFrom(undefined)).toBeNull()
  })
})

describe('runway', () => {
  it('a profitable book has no runway, not a negative one', () => {
    // `cash / net` with a positive net gives a NEGATIVE month count. Rendering
    // that is the failure this whole module is shaped around.
    const r = runway(bilan([{ pos: 'tresorerie', amount: '50000.00' }]), totals('12000.00', 6))
    expect(r.kind).toBe('not_burning')
  })

  it('a net of exactly zero is not burning', () => {
    expect(runway(bilan([{ pos: 'tresorerie', amount: '50000.00' }]), totals('0.00', 6)).kind).toBe('not_burning')
  })

  it('divides cash by the burn per month served', () => {
    // 6 months, net −12'000 → 2'000/month. 50'000 cash → 25 months.
    const r = runway(bilan([{ pos: 'tresorerie', amount: '50000.00' }]), totals('-12000.00', 6))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.months).toBeCloseTo(25, 6)
    expect(r.perMonth).toBe('2000.00')
    expect(r.over).toBe(6)
    expect(r.cash).toBe('50000.00')
  })

  it('the rate is per month SERVED, not per calendar month', () => {
    // The series is sparse — `monthlyFlows` drops empty months. Dividing by 12
    // would state a rate for a year the book has not lived. Two months of
    // −12'000 is 6'000/month, not 1'000.
    const r = runway(bilan([{ pos: 'tresorerie', amount: '60000.00' }]), totals('-12000.00', 2))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.perMonth).toBe('6000.00')
    expect(r.months).toBeCloseTo(10, 6)
  })

  it('no months served has no rate', () => {
    expect(runway(bilan([{ pos: 'tresorerie', amount: '50000.00' }]), totals('-1.00', 0)).kind).toBe('no_months')
  })

  it('no cash line refuses before it divides', () => {
    expect(runway(bilan([{ pos: 'creances_clients', amount: '5.00' }]), totals('-12000.00', 6)).kind)
      .toBe('no_cash_line')
  })

  it('no bilan at all is a DIFFERENT refusal from no cash line', () => {
    // ── THE BUG THIS TEST EXISTS FOR ──────────────────────────────────────
    // `runway` used to take the derived `cash` figure, and `cashFrom(undefined)`
    // is null exactly like "a bilan with no trésorerie line" is null. So a
    // SIMPLIFIED book — which keeps no balance sheet at all (art. 957 al. 2)
    // and whose bilan route refuses — was told "the balance sheet carries no
    // trésorerie position", a sentence about a document that does not exist.
    //
    // `no_bilan` was in `RunwayResult` and unreachable: a branch that could not
    // fire, beside a branch saying the wrong thing in its place. Found by
    // opening the RI book in a browser; every test passed a `cash` argument and
    // so could not tell the two nulls apart either.
    expect(runway(undefined, totals('-12000.00', 6)).kind).toBe('no_bilan')
  })

  it('zero cash is nought months, not an error', () => {
    // A book that has burnt through everything has a runway, and it is zero.
    const r = runway(bilan([{ pos: 'tresorerie', amount: '0.00' }]), totals('-6000.00', 3))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.months).toBe(0)
  })

  it('a burn too small to express per month is not burning', () => {
    // ── THE CASE THE SECOND GUARD ACTUALLY EXISTS FOR ──────────────────────
    // Integer division truncates. Five centimes over six months is ZERO
    // centimes a month, and `cash / 0` is Infinity — "Infinity months of cash"
    // rendered on a management screen. Not zero net, and not caught by the
    // first guard.
    expect(runway(bilan([{ pos: 'tresorerie', amount: '50000.00' }]), totals('-0.05', 6)).kind).toBe('not_burning')
  })

  it('is exact on the rate even where a float would drift', () => {
    // 3 months, net −0.30 → 0.10/month exactly. A float accumulator makes this
    // 0.09999999999999999.
    const r = runway(bilan([{ pos: 'tresorerie', amount: '1.00' }]), totals('-0.30', 3))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.perMonth).toBe('0.10')
  })
})
