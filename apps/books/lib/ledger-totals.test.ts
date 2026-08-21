// `lib/ledger-totals.ts` — the totals of the rows currently on the ledger.
//
// ── THE MAGNITUDES ARE CHOSEN, NOT ARBITRARY ──────────────────────────────
// `lib/rollup.test.ts` records why: the first version of the equivalent
// assertion there PASSED against a rollup rewritten to use floats, because the
// fixture's numbers were small enough that a float accumulator agreed. So the
// float-disagreement cases below use values where `0.1 + 0.2` style drift is
// visible at two decimals, and each one is asserted string-for-string.
//
// ── MUTATIONS WATCHED GO RED, 2026-08-21 ─────────────────────────────────
//   a) `riTotals` counting `neutral` into `depenses`
//        → "a neutral movement is in no total" red. This is the exact defect
//          Andrea's answer created before migration 0009 and it misstated her
//          income, so it is the first case here.
//   b) `riTotals`'s final `else` folded into the `depense` branch
//        → "an unknown direction is counted, never absorbed" red.
//   c) `accountTotals` summing every line instead of the matching ones
//        → "it sums the account's lines, not the entry's" red.
//   d) `accountTotals` matching a null `account`
//        → "a staged line with no account is not this account's movement" red.
//   e) either function rewritten with `Number()` accumulators
//        → every float case red, and nothing else.
//   f) `entryTotal` returning `'0.00'` instead of null for no lines
//        → "no lines is null, never a zero" red.
//   g) the fixture's line field renamed to anything else
//        → `tsc` red at the fixture, which is the point of typing it. The
//          first version of this file cast it and was green against a field
//          name that does not exist — see `entry()` below.

import { describe, it, expect } from 'vitest'
import { riTotals, accountTotals, entryTotal } from './ledger-totals'
import type { Entry, EntryLine, RiEntry } from './types'

function ri(direction: string, amount: string): RiEntry {
  return { direction, amount } as unknown as RiEntry
}

/**
 * ── THE `lines` PARAMETER IS TYPED `EntryLine[]`, AND THAT IS DELIBERATE ───
 * The first version of this helper declared its own inline shape and cast the
 * whole thing with `as unknown as Entry`. The field was spelled `account_no`
 * — which does not exist; `EntryLine` calls it `account` — and **all twelve
 * tests passed**, because the cast told the compiler to stop looking and the
 * implementation was reading `undefined !== '6570'` on every line.
 *
 * `tsc` caught it in `ledger-totals.ts`, which uses the real type. It could not
 * catch it here, and a test that cannot see a renamed field is a test that
 * certifies the rename. So the fixture is typed where it matters — the lines —
 * and only the outer object is cast, because an `Entry` carries twenty fields
 * these functions never read.
 */
function entry(lines: EntryLine[]): Entry {
  return { lines } as unknown as Entry
}

describe('riTotals', () => {
  it('adds recettes and dépenses separately', () => {
    const t = riTotals([ri('recette', '7500.00'), ri('depense', '1109.00'), ri('recette', '250.50')])
    expect(t.recettes).toBe('7750.50')
    expect(t.depenses).toBe('1109.00')
    expect(t.resultat).toBe('6641.50')
  })

  it('a neutral movement is in no total', () => {
    // Art. 957 al. 2 CO, migration 0009: a transfer between the owner's own
    // accounts is logged and counts in neither direction. Counting it as a
    // dépense understates income by its full value.
    const t = riTotals([ri('recette', '1000.00'), ri('neutral', '5000.00')])
    expect(t.recettes).toBe('1000.00')
    expect(t.depenses).toBe('0.00')
    expect(t.neutral).toBe('5000.00')
    expect(t.resultat).toBe('1000.00')
  })

  it('an unknown direction is counted, never absorbed', () => {
    const t = riTotals([ri('recette', '100.00'), ri('apport_prive', '999.00')])
    expect(t.unknown).toBe(1)
    expect(t.recettes).toBe('100.00')
    expect(t.depenses).toBe('0.00')
    expect(t.neutral).toBe('0.00')
    // The 999.00 is in NO total. It is shown as a count instead.
    expect(t.resultat).toBe('100.00')
  })

  it('is exact where a float accumulator is not', () => {
    // Ten of these is 0.1+0.2's problem at ledger scale: summed as floats the
    // result drifts off the rappen, and a journal that does not balance to the
    // rappen is not a journal.
    const rows = Array.from({ length: 10 }, () => ri('recette', '0.10'))
    rows.push(ri('recette', '0.20'))
    expect(riTotals(rows).recettes).toBe('1.20')

    const big = riTotals([ri('recette', '99999999.99'), ri('recette', '0.02')])
    expect(big.recettes).toBe('100000000.01')
  })

  it('a negative amount is respected rather than made absolute', () => {
    // A corrected movement can be negative on the wire. Folding it to its
    // absolute value would turn a correction into a second charge.
    const t = riTotals([ri('depense', '500.00'), ri('depense', '-120.00')])
    expect(t.depenses).toBe('380.00')
  })

  it('an empty set is zero, not an em dash', () => {
    // A DERIVED zero. `0.00` is right here and an em dash would be wrong — the
    // rule runs both ways, and this is the direction that gets forgotten.
    const t = riTotals([])
    expect(t).toEqual({
      recettes: '0.00',
      depenses: '0.00',
      neutral: '0.00',
      resultat: '0.00',
      unknown: 0,
    })
  })
})

describe('entryTotal', () => {
  it('a balanced entry reports one magnitude and says it balances', () => {
    const t = entryTotal([
      { debit: '1850.00', credit: '0.00' },
      { debit: '0.00', credit: '1850.00' },
    ])
    expect(t).toEqual({ debit: '1850.00', credit: '1850.00', balanced: true })
  })

  it('an unbalanced staged entry is reported as unbalanced, not averaged', () => {
    // Staging exists precisely so an entry can be incomplete. Printing one side
    // as "the amount" would describe half a record as the whole of it.
    const t = entryTotal([
      { debit: '620.00', credit: '0.00' },
      { debit: '0.00', credit: '600.00' },
    ])
    expect(t).toEqual({ debit: '620.00', credit: '600.00', balanced: false })
  })

  it('a multi-line entry sums each side', () => {
    const t = entryTotal([
      { debit: '11600.00', credit: '0.00' },
      { debit: '1750.00', credit: '0.00' },
      { debit: '0.00', credit: '13350.00' },
    ])
    expect(t).toEqual({ debit: '13350.00', credit: '13350.00', balanced: true })
  })

  it('no lines is null, never a zero', () => {
    // An entry whose lines have not been written has no amount. `0.00` would
    // claim it moved nothing, which is a different statement.
    expect(entryTotal([])).toBeNull()
    expect(entryTotal(undefined)).toBeNull()
  })

  it('is exact where a float accumulator is not', () => {
    const lines = Array.from({ length: 7 }, () => ({ debit: '0.10', credit: '0.00' }))
    lines.push({ debit: '0.30', credit: '0.00' })
    expect(entryTotal(lines)!.debit).toBe('1.00')
  })
})

describe('accountTotals', () => {
  it('sums the account’s lines, not the entry’s', () => {
    // Both entries are ON SCREEN because they touch 6570. Each also carries its
    // other side, which is a different account and must not be counted.
    const rows = [
      entry([
        { account: '6570', debit: '120.00', credit: '0.00' },
        { account: '1020', debit: '0.00', credit: '120.00' },
      ]),
      entry([
        { account: '6570', debit: '80.00', credit: '0.00' },
        { account: '1020', debit: '0.00', credit: '80.00' },
      ]),
    ]
    const t = accountTotals(rows, '6570')
    expect(t.debit).toBe('200.00')
    expect(t.credit).toBe('0.00')
    expect(t.net).toBe('200.00')
    expect(t.lines).toBe(2)
  })

  it('a staged line with no account is not this account’s movement', () => {
    const rows = [
      entry([
        { account: null, debit: '999.00', credit: '0.00' },
        { account: '6570', debit: '10.00', credit: '0.00' },
      ]),
    ]
    const t = accountTotals(rows, '6570')
    expect(t.debit).toBe('10.00')
    expect(t.lines).toBe(1)
  })

  it('nets both sides, and the net is signed', () => {
    const rows = [
      entry([{ account: '1020', debit: '500.00', credit: '0.00' }]),
      entry([{ account: '1020', debit: '0.00', credit: '1250.00' }]),
    ]
    const t = accountTotals(rows, '1020')
    expect(t.debit).toBe('500.00')
    expect(t.credit).toBe('1250.00')
    expect(t.net).toBe('-750.00')
  })

  it('is exact where a float accumulator is not', () => {
    const rows = Array.from({ length: 3 }, () => entry([{ account: '6000', debit: '0.10', credit: '0.00' }]))
    rows.push(entry([{ account: '6000', debit: '0.70', credit: '0.00' }]))
    expect(accountTotals(rows, '6000').debit).toBe('1.00')
  })

  it('an account with no lines on screen totals zero and says so', () => {
    const rows = [entry([{ account: '1020', debit: '5.00', credit: '0.00' }])]
    const t = accountTotals(rows, '9999')
    expect(t.lines).toBe(0)
    expect(t.debit).toBe('0.00')
    expect(t.net).toBe('0.00')
  })

  it('an entry with no lines at all does not throw', () => {
    // `lines` is optional on a staged entry in some payload shapes. A crash on
    // the ledger is worse than a zero.
    const rows = [{ } as unknown as Entry]
    expect(accountTotals(rows, '6570').lines).toBe(0)
  })
})
