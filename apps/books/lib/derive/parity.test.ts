// The derivations agree with the mockup to the rappen.
//
// ===========================================================================
// WHY THIS IS THE MOST IMPORTANT TEST IN THE APP
// ===========================================================================
// `lib/derive/index.ts` is a port. A port that is subtly wrong does not crash: it
// produces a bilan that is off by a rappen, or puts one account's money on the
// wrong line, and both of those look like working software until a fiduciary reads
// the output months later.
//
// So this file re-implements the mockup's derivations INDEPENDENTLY, in floats,
// straight from `bbooks/assets/bbooks-data.js` lines 1281-1372, and asserts the
// real implementation agrees. Two implementations, written from the same reference
// in different numeric styles, checked against each other.
//
// The reference is included here rather than imported because the mockup is a
// browser file in another repo. `fixtures/mockup.json` is its data, dumped by
// LOADING it, so the numbers cannot have been mistyped.
//
// ── WHAT AGREEMENT PROVES, AND WHAT IT DOES NOT ─────────────────────────────
// It proves the arithmetic, the sign conventions, the statement mapping and the
// posted-only filter match the specification. It does NOT prove the accounting is
// legally right: the mockup could be wrong and this test would faithfully agree
// with it. That question belongs to BRIEF.md and to Andrea.

import { describe, it, expect } from 'vitest'
import fixture from '../../fixtures/mockup.json'
import { BILAN_STRUCTURE, CR_STRUCTURE } from '../statements'
import { bilanFor, crFor, riTotals, isBalanced, movement, type PostingLine, type ChartAccount } from './index'

interface FxEntity { id: number; slug: string; legal_form: string }
interface FxAccount { no: string; class: number; statement: string; statement_position: string }
interface FxLine { account: string | null; debit: number; credit: number }
interface FxTx { id: number; entity_id: number; status: string; lines: FxLine[] }

const ENTITIES = fixture.ENTITIES as unknown as FxEntity[]
const ACCOUNTS = fixture.ACCOUNTS as unknown as FxAccount[]
const TX = fixture.TX as unknown as FxTx[]
const OPENING = fixture.OPENING as unknown as Record<string, Record<string, number>>
const RI_ENTRIES = fixture.RI_ENTRIES as unknown as { direction: string; amount: number }[]

// ===========================================================================
// THE REFERENCE, IN FLOATS, AS THE MOCKUP WROTE IT
// ===========================================================================

const txFor = (entityId: number) => TX.filter((t) => t.entity_id === entityId)
const accountByNo = (no: string) => ACCOUNTS.find((a) => a.no === no)!

function refMovement(entityId: number, accountNo: string): number {
  return txFor(entityId)
    .filter((t) => t.status === 'posted')
    .reduce(
      (s, t) =>
        s +
        t.lines
          .filter((l) => l.account === accountNo)
          .reduce((ls, l) => ls + (l.debit || 0) - (l.credit || 0), 0),
      0
    )
}

function refBalance(entity: FxEntity, accountNo: string): number {
  const open = (OPENING[entity.slug] && OPENING[entity.slug][accountNo]) || 0
  const acc = accountByNo(accountNo)
  const mov = refMovement(entity.id, accountNo)
  if (acc.class === 2) return open + -mov
  return open + mov
}

function refCr(entity: FxEntity) {
  const lines = CR_STRUCTURE.map((row) => {
    const accs = ACCOUNTS.filter((a) => a.statement === 'cr' && a.statement_position === row.pos)
    let amount = 0
    accs.forEach((a) => {
      const mov = refMovement(entity.id, a.no)
      amount += row.sign === 1 ? -mov : mov
    })
    return { pos: row.pos, sign: row.sign, amount }
  })
  const resultat = lines.reduce((s, l) => s + (l.sign === 1 ? l.amount : -l.amount), 0)
  return { lines, resultat }
}

function refBilan(entity: FxEntity) {
  const resultat = refCr(entity).resultat
  const posSum: Record<string, number> = {}
  ACCOUNTS.filter((a) => a.statement === 'bilan').forEach((a) => {
    posSum[a.statement_position] = (posSum[a.statement_position] || 0) + refBalance(entity, a.no)
  })
  posSum['resultat_exercice'] = resultat
  const total = (side: string) =>
    BILAN_STRUCTURE.filter((g) => g.side === side).reduce(
      (s, g) => s + g.lines.reduce((ls, l) => ls + (posSum[l.pos] || 0), 0),
      0
    )
  return { posSum, totalActif: total('actif'), totalPassif: total('passif'), resultat }
}

// ===========================================================================
// ADAPTING THE FIXTURE TO WHAT THE REAL IMPLEMENTATION TAKES
// ===========================================================================
// Amounts become fixed-2 STRINGS, which is how they arrive from `numeric(14,2)`.
// Passing the fixture's raw numbers would test the wrong thing: the whole point is
// that the real code handles the string form correctly.

function linesFor(entityId: number): PostingLine[] {
  const out: PostingLine[] = []
  for (const t of txFor(entityId)) {
    for (const l of t.lines) {
      out.push({
        account_no: l.account,
        debit: (l.debit || 0).toFixed(2),
        credit: (l.credit || 0).toFixed(2),
        status: t.status,
      })
    }
  }
  return out
}

const CHART: ChartAccount[] = ACCOUNTS.map((a) => ({
  no: a.no,
  class: a.class,
  statement: a.statement,
  statement_position: a.statement_position,
}))

function openingsFor(slug: string): Map<string, bigint> {
  const m = new Map<string, bigint>()
  for (const [no, amount] of Object.entries(OPENING[slug] ?? {})) {
    m.set(no, BigInt(Math.round(amount * 100)))
  }
  return m
}

/** The two books that keep double-entry accounts. The RI has no bilan, ever. */
const DOUBLE_ENTRY = ENTITIES.filter((e) => e.legal_form !== 'RI')

// ===========================================================================
// THE ASSERTIONS
// ===========================================================================

describe('the fixture is really there (guards against a vacuous pass)', () => {
  it('has books, accounts and postings', () => {
    expect(DOUBLE_ENTRY.length).toBeGreaterThan(0)
    expect(ACCOUNTS.length).toBeGreaterThan(0)
    expect(TX.filter((t) => t.status === 'posted').length).toBeGreaterThan(0)
    // If nothing were staged, the posted-only filter would be untested.
    expect(TX.filter((t) => t.status === 'staged').length).toBeGreaterThan(0)
  })
})

describe.each(DOUBLE_ENTRY.map((e) => [e.slug, e] as const))('%s', (_slug, entity) => {
  const lines = linesFor(entity.id)
  const openings = openingsFor(entity.slug)
  const mine = bilanFor(lines, CHART, openings)
  const theirs = refBilan(entity)

  it('actif equals passif', () => {
    expect(mine.totalActif, `écart of ${mine.ecart}`).toBe(mine.totalPassif)
    expect(mine.balanced).toBe(true)
  })

  it('total actif matches the mockup to the rappen', () => {
    expect(mine.totalActif).toBe(theirs.totalActif.toFixed(2))
  })

  it('total passif matches the mockup to the rappen', () => {
    expect(mine.totalPassif).toBe(theirs.totalPassif.toFixed(2))
  })

  it('every bilan line matches the mockup, line by line', () => {
    for (const g of mine.groups) {
      for (const l of g.lines) {
        expect(l.amount, `bilan line ${l.pos}`).toBe((theirs.posSum[l.pos] || 0).toFixed(2))
      }
    }
  })

  it('every compte de résultat line matches the mockup', () => {
    const m = crFor(lines, CHART)
    const t = refCr(entity)
    expect(m.lines.length).toBe(t.lines.length)
    for (let i = 0; i < m.lines.length; i++) {
      expect(m.lines[i].pos).toBe(t.lines[i].pos)
      expect(m.lines[i].amount, `cr line ${m.lines[i].pos}`).toBe(t.lines[i].amount.toFixed(2))
    }
  })

  it('résultat de l\'exercice matches, and is what the bilan injects into equity', () => {
    expect(mine.resultat).toBe(theirs.resultat.toFixed(2))
    const equity = mine.groups
      .flatMap((g) => g.lines)
      .find((l) => l.pos === 'resultat_exercice')
    expect(equity?.amount).toBe(mine.resultat)
  })

  it('renders every legal line, including the zero ones', () => {
    const emitted = mine.groups.flatMap((g) => g.lines.map((l) => l.pos))
    const legal = BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos))
    // A zero-balance statutory line still legally exists. Collapsing it is a view
    // decision; dropping it from the model is not allowed.
    expect(emitted).toEqual(legal)
    expect(emitted.filter((p) => mine.groups.flatMap((g) => g.lines).find((l) => l.pos === p)!.amount === '0.00').length)
      .toBeGreaterThan(0)
  })

  it('counts posted entries only', () => {
    // Prove the filter does something: staging a posted entry's account would
    // change the movement if the filter were absent.
    const staged = linesFor(entity.id).filter((l) => l.status === 'staged' && l.account_no)
    if (staged.length === 0) return
    const acct = staged[0].account_no!
    const withFilter = movement(lines, acct)
    const asIfUnfiltered = lines
      .filter((l) => l.account_no === acct)
      .reduce((s, l) => s + BigInt(Math.round(Number(l.debit) * 100)) - BigInt(Math.round(Number(l.credit) * 100)), 0n)
    expect(withFilter).not.toBe(asIfUnfiltered)
  })
})

describe('the sole proprietorship', () => {
  it('recettes, dépenses and résultat match the mockup', () => {
    const mine = riTotals(RI_ENTRIES.map((r) => ({ direction: r.direction, amount: r.amount.toFixed(2) })))
    const rec = RI_ENTRIES.filter((e) => e.direction === 'recette').reduce((s, e) => s + e.amount, 0)
    const dep = RI_ENTRIES.filter((e) => e.direction === 'depense').reduce((s, e) => s + e.amount, 0)
    expect(mine.recettes).toBe(rec.toFixed(2))
    expect(mine.depenses).toBe(dep.toFixed(2))
    expect(mine.resultat).toBe((rec - dep).toFixed(2))
  })
})

describe('isBalanced', () => {
  it('agrees with the mockup on every posted entry', () => {
    for (const t of TX.filter((t) => t.status === 'posted')) {
      const lines = t.lines.map((l) => ({
        debit: (l.debit || 0).toFixed(2),
        credit: (l.credit || 0).toFixed(2),
      }))
      expect(isBalanced(lines), `entry ${t.id}`).toBe(true)
    }
  })

  it('rejects an entry that misses by one rappen', () => {
    // The case a float comparison would let through.
    expect(isBalanced([{ debit: '1850.00', credit: '0.00' }, { debit: '0.00', credit: '1849.99' }])).toBe(false)
  })

  it('holds for amounts a float would get wrong', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(isBalanced([
      { debit: '0.10', credit: '0.00' },
      { debit: '0.20', credit: '0.00' },
      { debit: '0.00', credit: '0.30' },
    ])).toBe(true)
  })
})
