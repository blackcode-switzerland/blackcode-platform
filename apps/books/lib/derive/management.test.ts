// The phase 4B derivations, pinned to the mockup reference's arithmetic.
//
// The tax numbers here are the ones the reference documents in its own
// comments (bbooks-data.js l.1268-1271): statutory combined ≈ 16.23% of
// after-tax profit, effective pre-tax ≈ 13.97%. If a parameter or a formula
// drifts, these fail naming the figure a fiduciary would be shown.

import { describe, it, expect } from 'vitest'
import {
  monthlyFlows,
  monthlyFlowsRi,
  costBreakdown,
  costBreakdownRi,
  vatPosition,
  pmProfitTax,
  pmCapitalTax,
  type TaxParams,
} from './management'
import type { ChartAccount } from './index'

/** The seeded Vaud/Renens parameters, exactly as the fixture states them. */
const VD_RENENS: TaxParams = {
  ifd: { rate_pct: 8.5 },
  cantonal: { base_rate_pct: 10 / 3, coefficient_pct: 155 },
  communal: { coefficient_pct: 77 },
  capital_tax: { base_rate_permille: 0.6 },
}

const CHART: ChartAccount[] = [
  { no: '1020', class: 1, statement: 'bilan', statement_position: 'tresorerie' },
  { no: '3400', class: 3, statement: 'cr', statement_position: 'produits_services' },
  { no: '6000', class: 6, statement: 'cr', statement_position: 'loyer' },
  { no: '6570', class: 6, statement: 'cr', statement_position: 'informatique' },
]

describe('monthlyFlows', () => {
  const L = (date: string, account: string, debit: string, credit: string, status = 'posted') => ({
    date,
    account_no: account,
    debit,
    credit,
    status,
  })

  it('buckets posted CR lines by month: class 3 as produits, the rest as charges', () => {
    const flows = monthlyFlows(
      [
        L('2026-01-05', '3400', '0.00', '5000.00'),
        L('2026-01-05', '1020', '5000.00', '0.00'), // bilan side of the same écriture: invisible here
        L('2026-01-20', '6000', '1800.00', '0.00'),
        L('2026-02-03', '6570', '398.75', '0.00'),
      ],
      CHART
    )
    expect(flows).toEqual([
      { month: '2026-01', produits: '5000.00', charges: '1800.00' },
      { month: '2026-02', produits: '0.00', charges: '398.75' },
    ])
  })

  it('staged lines are invisible: unexplained money reaches no chart', () => {
    const flows = monthlyFlows([L('2026-03-01', '6000', '900.00', '0.00', 'staged')], CHART)
    expect(flows).toEqual([])
  })

  it('a credit note in a charge account reduces its month, and a month that nets to zero on both sides is dropped', () => {
    const flows = monthlyFlows(
      [L('2026-04-01', '6000', '100.00', '0.00'), L('2026-04-15', '6000', '0.00', '100.00')],
      CHART
    )
    expect(flows).toEqual([])
  })

  it('the RI variant reads directions, and a neutral transfer lands in neither total', () => {
    const flows = monthlyFlowsRi([
      { date: '2026-01-10', direction: 'recette', amount: '1200.00' },
      { date: '2026-01-12', direction: 'depense', amount: '45.50' },
      { date: '2026-01-15', direction: 'neutral', amount: '2000.00' },
    ])
    expect(flows).toEqual([{ month: '2026-01', produits: '1200.00', charges: '45.50' }])
  })
})

describe('costBreakdown', () => {
  const CATS = [
    { key: 'bureau', label: { fr: 'Bureau' }, accounts: ['6000'] },
    { key: 'it_ai', label: { fr: 'IT' }, accounts: ['6570'] },
  ]
  const B = (date: string, account: string, debit: string, credit: string, n: number, who: string, status = 'posted') => ({
    date,
    account_no: account,
    debit,
    credit,
    status,
    counterparty: who,
    entry_number: n,
  })

  it('sums each category from posted lines and carries the lines, largest first', () => {
    const out = costBreakdown(CATS, [
      B('2026-01-20', '6000', '1800.00', '0.00', 3, 'Régie du Lac'),
      B('2026-02-20', '6000', '1800.00', '0.00', 7, 'Régie du Lac'),
      B('2026-02-03', '6570', '398.75', '0.00', 5, 'Hetzner'),
      B('2026-02-25', '6570', '0.00', '50.00', 9, 'Hetzner (avoir)'),
      B('2026-03-01', '6570', '900.00', '0.00', 11, 'OpenAI', 'staged'),
    ])
    expect(out.map((c) => [c.key, c.amount])).toEqual([
      ['bureau', '3600.00'],
      ['it_ai', '348.75'],
    ])
    expect(out[1].lines.map((l) => l.amount), 'the credit note is a negative line, not a deletion').toEqual([
      '398.75',
      '-50.00',
    ])
    expect(out[0].lines[0].counterparty).toBe('Régie du Lac')
  })

  it('a category with no movement keeps its row at zero: the set of categories is configuration', () => {
    const out = costBreakdown(CATS, [])
    expect(out.map((c) => [c.key, c.amount, c.lines.length])).toEqual([
      ['bureau', '0.00', 0],
      ['it_ai', '0.00', 0],
    ])
  })

  it('the RI breakdown groups dépenses by their own category and names the uncategorized bucket', () => {
    const out = costBreakdownRi([
      { seq: 1, date: '2026-01-05', direction: 'depense', amount: '45.50', counterparty: 'Café', raw_label: 'CARTE CAFE', category: { fr: 'Repas', en: 'Meals' } },
      { seq: 2, date: '2026-01-08', direction: 'depense', amount: '99.00', counterparty: null, raw_label: 'TWINT QUELQUE CHOSE', category: null },
      { seq: 3, date: '2026-01-09', direction: 'recette', amount: '500.00', counterparty: 'Client', raw_label: 'VIREMENT', category: null },
    ])
    expect(out.map((c) => [c.key, c.amount])).toEqual([
      ['__none', '99.00'],
      ['Repas', '45.50'],
    ])
    expect(out[0].lines[0].counterparty, 'no counterparty: the raw label speaks').toBe('TWINT QUELQUE CHOSE')
  })
})

describe('vatPosition', () => {
  it('output on posted revenue, input only when CLAIMED, on top of the opening due', () => {
    const v = vatPosition(150000n, [
      { status: 'posted', tva_amount: '81.00', tva_input_claimed: false, credits_revenue: true },
      { status: 'posted', tva_amount: '29.90', tva_input_claimed: true, credits_revenue: false },
      { status: 'posted', tva_amount: '12.00', tva_input_claimed: false, credits_revenue: false }, // evidence too weak to claim
      { status: 'staged', tva_amount: '99.00', tva_input_claimed: true, credits_revenue: false },
    ])
    expect(v).toEqual({
      opening_due: '1500.00',
      output_ytd: '81.00',
      input_claimed_ytd: '29.90',
      net_due: '1551.10',
    })
  })
})

describe('pmProfitTax', () => {
  it('the reference figures: statutory 16.23%, effective 13.97%', () => {
    const t = pmProfitTax(0n, VD_RENENS)
    expect(t.statutory_pct).toBe(16.23)
    expect(t.effective_pct).toBe(13.97)
  })

  it('CHF 100000 profit: cantonal 5166.67, communal 2566.67, IFD 8500.00', () => {
    const t = pmProfitTax(10000000n, VD_RENENS)
    expect(t.cantonal).toBe('5166.67')
    expect(t.communal).toBe('2566.67')
    expect(t.ifd).toBe('8500.00')
    expect(t.total).toBe('16233.33')
  })

  it('a loss computes as zero, not as a refund', () => {
    const t = pmProfitTax(-500000n, VD_RENENS)
    expect(t.total).toBe('0.00')
  })
})

describe('pmCapitalTax', () => {
  it('0.6‰ of equity, the cantonal+communal profit tax credited against it', () => {
    const c = pmCapitalTax(10000000n, 7733.33, VD_RENENS) // CHF 100k equity, healthy profit year
    expect(c.gross).toBe('60.00')
    expect(c.credited).toBe('60.00')
    expect(c.net_due, 'it only bites in loss years').toBe('0.00')
  })

  it('in a loss year nothing is credited and the gross is due', () => {
    const c = pmCapitalTax(10000000n, 0, VD_RENENS)
    expect(c).toEqual({ gross: '60.00', credited: '0.00', net_due: '60.00' })
  })
})
