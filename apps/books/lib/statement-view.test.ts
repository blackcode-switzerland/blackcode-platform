// The join between a derived statement and its legal line list.
//
// The two facts this has to hold, and both of them are things somebody will
// break by "tidying up":
//
//   1. **No line is ever dropped**, including a zero one and including one the
//      served structure does not carry. A statutory statement missing a line is
//      not the document that gets filed.
//   2. **A line with no label renders its `pos`, never a blank.** An amount on
//      the page with nothing to say what it is, is worse than an ugly one.
//
// ── WATCHED FAIL BEFORE BEING TRUSTED (2026-08-18) ────────────────────────

import { describe, it, expect } from 'vitest'
import { bilanGroups, crGroups } from './statement-view'
import type { MetaPayload } from './hooks'
import type { BilanResult, CrResult } from './types'

const meta = {
  statements: {
    bilan: [
      {
        group: { fr: 'Actif circulant', en: 'Current assets' },
        side: 'actif' as const,
        lines: [
          { pos: 'tresorerie', label: { fr: 'Trésorerie', en: 'Cash & equivalents' } },
          { pos: 'resultat_exercice', label: { fr: 'Résultat', en: 'Result' }, derived: true },
        ],
      },
    ],
    cr: [{ pos: 'produits_nets', label: { fr: 'Produits nets', en: 'Net revenue' }, sign: 1 as const }],
  },
} as unknown as MetaPayload

const bilan = (lines: { pos: string; related: boolean; amount: string }[]): BilanResult => ({
  entity: 'x',
  exercice: 2026,
  groups: [{ group: { fr: 'Actif circulant', en: 'Current assets' }, side: 'actif', lines }],
  totalActif: '0.00',
  totalPassif: '0.00',
  resultat: '0.00',
  balanced: true,
  ecart: '0.00',
})

describe('bilanGroups', () => {
  // Mutation watched: `.filter(l => l.amount !== '0.00')` added to the line map.
  // Red, and this is the assertion that stands between a tidy-up and a bilan
  // that is not the document that gets filed.
  it('keeps a zero line', () => {
    const out = bilanGroups(
      bilan([
        { pos: 'tresorerie', related: false, amount: '0.00' },
        { pos: 'resultat_exercice', related: false, amount: '0.00' },
      ]),
      meta
    )
    expect(out[0].lines.map((l) => l.pos)).toEqual(['tresorerie', 'resultat_exercice'])
    expect(out[0].lines[0].amount).toBe('0.00')
  })

  // Mutation watched: `label: index.get(line.pos)!.label` — red with a TypeError
  // on the unknown pos, which is the same defect arriving as a crash instead of
  // a blank. Either way the line is unreadable.
  it('renders an unknown pos with its own name rather than a blank or a crash', () => {
    const out = bilanGroups(bilan([{ pos: 'a_line_added_last_week', related: false, amount: '5.00' }]), meta)
    expect(out[0].lines).toHaveLength(1)
    expect(out[0].lines[0].label).toEqual({ fr: 'a_line_added_last_week', en: 'a_line_added_last_week' })
    expect(out[0].lines[0].amount).toBe('5.00')
  })

  it('survives meta not having arrived, without losing a line', () => {
    const out = bilanGroups(bilan([{ pos: 'tresorerie', related: false, amount: '5.00' }]), undefined)
    expect(out[0].lines).toHaveLength(1)
    expect(out[0].lines[0].amount).toBe('5.00')
  })

  // Mutation watched: `related: legal?.related` — red. `related` is a property
  // of the line AS DERIVED, and reading it from the structure instead means the
  // art. 959a al. 4 marker could disagree with what the numbers were computed
  // as.
  it('takes `related` from the payload, not from the structure', () => {
    const out = bilanGroups(bilan([{ pos: 'tresorerie', related: true, amount: '1.00' }]), meta)
    expect(out[0].lines[0].related).toBe(true)
  })

  // `derived` is the opposite case and comes from the STRUCTURE, because the
  // payload has no such field — `resultat_exercice` is computed, never posted.
  it('takes `derived` from the structure, which is the only place it exists', () => {
    const out = bilanGroups(bilan([{ pos: 'resultat_exercice', related: false, amount: '1.00' }]), meta)
    expect(out[0].lines[0].derived).toBe(true)
  })
})

describe('crGroups', () => {
  const cr = (lines: CrResult['lines']): CrResult => ({
    entity: 'x',
    exercice: 2026,
    lines,
    resultat: '0.00',
  })

  // Mutation watched: `accounts: line.accounts.length ? line.accounts : undefined`.
  // Red — and it is the drill-down that would have silently vanished for the
  // lines that have one member, which is most of them.
  it('carries the accounts array through, which is the drill-down', () => {
    const out = crGroups(cr([{ pos: 'produits_nets', sign: 1, amount: '5420.00', accounts: ['3400'] }]), meta)
    expect(out[0].lines[0].accounts).toEqual(['3400'])
  })

  // An EMPTY accounts array is kept as empty rather than turned into anything
  // else: a line with no account mapped to it in this book has nowhere to drill,
  // and inventing a link would send the reader to an empty ledger.
  it('keeps an empty accounts array empty', () => {
    const out = crGroups(cr([{ pos: 'exceptionnel', sign: -1, amount: '0.00', accounts: [] }]), meta)
    expect(out[0].lines[0].accounts).toEqual([])
  })

  // Mutation watched: `lines.filter(l => l.amount !== '0.00')`. Red.
  // Lines 7-9 of art. 959b are zero on every seeded book and are a hard legal
  // requirement — this is the case that stops them being tidied away.
  it('keeps every line, in order, including the zeroes', () => {
    const out = crGroups(
      cr([
        { pos: 'produits_nets', sign: 1, amount: '5420.00', accounts: [] },
        { pos: 'financier', sign: -1, amount: '0.00', accounts: [] },
        { pos: 'hors_exploitation', sign: -1, amount: '0.00', accounts: [] },
        { pos: 'exceptionnel', sign: -1, amount: '0.00', accounts: [] },
      ]),
      meta
    )
    expect(out[0].lines.map((l) => l.pos)).toEqual([
      'produits_nets',
      'financier',
      'hors_exploitation',
      'exceptionnel',
    ])
  })

  it('is one group, because art. 959b is a flat sequence', () => {
    expect(crGroups(cr([]), meta)).toHaveLength(1)
  })
})
