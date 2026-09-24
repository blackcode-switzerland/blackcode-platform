// The arithmetic, against numbers worked out by hand.
//
// ===========================================================================
// WHY THE EXPECTATIONS ARE LITERALS AND NOT COMPUTED
// ===========================================================================
// Every expectation below is a number somebody worked out, with the working
// shown in a comment. A test that computes its expectation the same way the code
// does asserts only that the code is self-consistent, which it would be if the
// formula were wrong.
//
// This matters more here than almost anywhere else in the repo: the output of
// this module goes onto a legal document and into a payment slip, and being
// wrong in the last rappen means a bank reconciliation that does not close.

import { describe, it, expect } from 'vitest'
import {
  divRoundHalfAway,
  formatRappen,
  formatRate,
  lineProduct,
  lineProductExact,
  milliToRappen,
  parseQty,
  parseRappen,
  parseRateBp,
  roundMilliToStep,
  roundToStep,
} from './money'
import { computeTotals, computeTotalsRappen, hasVatBlock, type TotalsLine } from './totals'

const line = (qty: string, unit_price: string, vat_rate: string | null): TotalsLine => ({
  qty,
  unit_price,
  vat_rate,
})

describe('parsing refuses what a cast would accept', () => {
  it('parses plain decimals exactly', () => {
    expect(parseRappen('1590.00')).toBe(159000)
    expect(parseRappen('0.05')).toBe(5)
    expect(parseRappen('10')).toBe(1000)
    expect(parseRappen('-12.34')).toBe(-1234)
    // Trailing zeros are not extra precision.
    expect(parseRappen('10.500')).toBe(1050)
  })

  it('REFUSES exponent notation — the `1e3` bug, which would bill 1000x', () => {
    // `Number('1e3') * 100` is 100000: a bill for CHF 1000 where CHF 1 was
    // meant. apps/books/lib/format.ts records this reaching a rendered page.
    expect(() => parseRappen('1e3')).toThrow(/not a plain decimal/)
    expect(() => parseRappen('1E3')).toThrow()
  })

  it('refuses the other things a cast would swallow', () => {
    expect(() => parseRappen('')).toThrow()
    expect(() => parseRappen('CHF 10.00')).toThrow()
    expect(() => parseRappen("1'000.00")).toThrow()
    expect(() => parseRappen('10,00')).toThrow()
    expect(() => parseRappen('NaN')).toThrow()
    expect(() => parseRappen('Infinity')).toThrow()
    expect(() => parseRappen('0x10')).toThrow()
  })

  it('refuses excess precision rather than truncating it', () => {
    // Keeping "10.00" from "10.005" would make the invoice disagree with the
    // request that created it, silently.
    expect(() => parseRappen('10.005')).toThrow(/more than 2 decimal place/)
  })

  it('parses quantities at three decimals, because half an hour is real', () => {
    expect(parseQty('12')).toBe(12000)
    expect(parseQty('0.5')).toBe(500)
    expect(parseQty('0.333')).toBe(333)
  })

  it('parses a rate as basis points', () => {
    expect(parseRateBp('8.1')).toBe(810)
    expect(parseRateBp('2.6')).toBe(260)
    expect(parseRateBp('0')).toBe(0)
    expect(parseRateBp('3.8')).toBe(380)
  })
})

describe('formatting never divides', () => {
  it('round-trips through the string, not the float', () => {
    expect(formatRappen(159000)).toBe('1590.00')
    expect(formatRappen(5)).toBe('0.05')
    expect(formatRappen(0)).toBe('0.00')
    expect(formatRappen(-1234)).toBe('-12.34')
    // 2010/100 is 20.1 in binary floating point, not 20.10.
    expect(formatRappen(2010)).toBe('20.10')
  })

  it('trims a rate, because `TVA 8.10%` reads wrong', () => {
    expect(formatRate(810)).toBe('8.1')
    expect(formatRate(260)).toBe('2.6')
    expect(formatRate(0)).toBe('0')
    expect(formatRate(1000)).toBe('10')
  })
})

describe('rounding is half AWAY FROM ZERO, not half up', () => {
  it('treats a credit note symmetrically', () => {
    // Math.round(-0.5) is -0 and Math.round(0.5) is 1. If rounding were
    // asymmetric, a credit note and the invoice it cancels would not sum to
    // zero.
    expect(divRoundHalfAway(5, 2)).toBe(3)
    expect(divRoundHalfAway(-5, 2)).toBe(-3)
    expect(roundToStep(-248, 5)).toBe(-250)
    expect(roundToStep(248, 5)).toBe(250)
  })

  it('rounds to five rappen at the boundary', () => {
    expect(roundToStep(247, 5)).toBe(245) // 2.47 -> 2.45
    expect(roundToStep(248, 5)).toBe(250) // 2.48 -> 2.50
    expect(roundToStep(2475, 5)).toBe(2475) // already a multiple
    expect(roundToStep(2, 5)).toBe(0) // 0.02 -> 0.00
    expect(roundToStep(3, 5)).toBe(5) // 0.03 -> 0.05
  })
})

describe('the line product keeps its scale', () => {
  it('multiplies a fractional quantity exactly', () => {
    // 1.5 × 10.00 = 15.00
    expect(lineProduct(parseQty('1.5'), parseRappen('10.00'))).toBe(1500)
    // 0.333 × 100.00 = 33.30
    expect(lineProduct(parseQty('0.333'), parseRappen('100.00'))).toBe(3330)
    // 12 × 132.50 = 1590.00 — the mockup's figure
    expect(lineProduct(parseQty('12'), parseRappen('132.50'))).toBe(159000)
    // 3 × 0.333... is where a float path drifts: 7 × 0.07 = 0.49
    expect(lineProduct(parseQty('7'), parseRappen('0.07'))).toBe(49)
  })
})

describe('null is not zero, and this is the load-bearing distinction', () => {
  it('an exempt line contributes to the subtotal and to no VAT figure', () => {
    // 1 × 200.00 exempt. Subtotal 200.00, no VAT block, total 200.00.
    const t = computeTotals([line('1', '200.00', null)], false, 'none')
    expect(t.subtotal).toBe('200.00')
    expect(t.vat).toEqual([])
    expect(t.vat_total).toBe('0.00')
    expect(t.total).toBe('200.00')
  })

  it('a ZERO-RATED line produces a VAT line reading 0%', () => {
    // An export or a reverse charge. 1 × 200.00 at 0%: the block EXISTS and
    // says 0, which is a different statement from "no VAT applies".
    const t = computeTotals([line('1', '200.00', '0')], false, 'none')
    expect(t.vat).toEqual([{ rate: '0', base: '200.00', amount: '0.00' }])
    expect(t.total).toBe('200.00')
  })

  it('tells the two apart when they sit on one invoice', () => {
    const t = computeTotals([line('1', '100.00', null), line('1', '100.00', '0')], false, 'none')
    expect(t.subtotal).toBe('200.00')
    // One VAT line, on the zero-rated base only — NOT on 200.00.
    expect(t.vat).toEqual([{ rate: '0', base: '100.00', amount: '0.00' }])
  })

  it('hasVatBlock reads the LINES, never the invoice or a total', () => {
    expect(hasVatBlock([line('1', '100.00', null)])).toBe(false)
    expect(hasVatBlock([line('1', '100.00', '0')])).toBe(true)
    expect(hasVatBlock([line('1', '100.00', null), line('1', '1.00', '8.1')])).toBe(true)
  })
})

describe('the mixed invoice the first external customer actually sends', () => {
  // A VAT-exempt medical act beside a taxable product, prices INCLUDING VAT,
  // which is their model exactly.
  const lines = [
    line('1', '250.00', null), // the consultation: exempt
    line('2', '60.00', '8.1'), // two units of product: taxable, price includes VAT
  ]

  it('extracts the VAT from inside the price rather than adding it', () => {
    const t = computeTotals(lines, true, 'none')
    // Subtotal = 250.00 + 120.00 = 370.00
    expect(t.subtotal).toBe('370.00')
    // The taxable base is 120.00 and ALREADY contains its VAT, so the portion
    // inside it is 120.00 × 8.1 / 108.1 = 8.9916… → 8.99
    //   12000 × 810 = 9_720_000;  9_720_000 / 10810 = 899.16… → 899 rappen
    expect(t.vat).toEqual([{ rate: '8.1', base: '120.00', amount: '8.99' }])
    // NOTHING IS ADDED: the total is the sum of the lines.
    expect(t.total).toBe('370.00')
  })

  it('would overstate the VAT by ~8% if the exclusive formula were used here', () => {
    // The mistake this guards: 120.00 × 8.1 / 100 = 9.72 rather than 8.99.
    // Same lines, exclusive mode, so the difference is visible.
    const wrong = computeTotals(lines, false, 'none')
    expect(wrong.vat).toEqual([{ rate: '8.1', base: '120.00', amount: '9.72' }])
    // And in exclusive mode it IS added: 370.00 + 9.72
    expect(wrong.total).toBe('379.72')
    // The two must not agree, or one of the formulas is unreachable.
    expect(wrong.vat[0].amount).not.toBe('8.99')
  })
})

describe('the four rounding policies, on one fixture where three of them differ', () => {
  // Chosen so every policy lands somewhere different. Exclusive, 8.1%.
  //   3 × 33.33 = 99.99  (9999 rappen)
  //   VAT at 8.1% = 9999 × 810 / 10000 = 809.919 → 810 rappen = 8.10
  const lines = [line('3', '33.33', '8.1')]

  it('`none` rounds to the rappen and adds nothing', () => {
    const t = computeTotals(lines, false, 'none')
    expect(t.subtotal).toBe('99.99')
    expect(t.vat_total).toBe('8.10')
    expect(t.rounding).toBe('0.00')
    // 99.99 + 8.10 = 108.09
    expect(t.total).toBe('108.09')
  })

  it('`total_0_05` leaves the parts alone and adjusts the payable total', () => {
    const t = computeTotals(lines, false, 'total_0_05')
    expect(t.subtotal).toBe('99.99')
    expect(t.vat_total).toBe('8.10')
    // 108.09 → nearest five rappen is 108.10, so the adjustment is +0.01
    expect(t.rounding).toBe('0.01')
    expect(t.total).toBe('108.10')
  })

  it('`line_0_05` rounds the parts so the printed column adds up', () => {
    const t = computeTotals(lines, false, 'line_0_05')
    // The LINE is rounded first: 99.99 → 100.00
    expect(t.subtotal).toBe('100.00')
    // and the VAT is computed on the rounded base, then rounded itself:
    //   10000 × 810 / 10000 = 810 → already a multiple of 5 → 8.10
    expect(t.vat_total).toBe('8.10')
    expect(t.rounding).toBe('0.00')
    // 100.00 + 8.10 = 108.10, and every printed number adds up with no
    // rounding line — which is the whole reason this is the default.
    expect(t.total).toBe('108.10')
  })

  it('`exact_0_05` coincides with `total_0_05` here, because 3 × 33.33 has no fraction to lose', () => {
    // The exact product is 99.99 to the milli-rappen, so rounding it to the
    // rappen first changes nothing and the two policies agree. The fixture
    // where they part is below.
    const t = computeTotals(lines, false, 'exact_0_05')
    expect(t.subtotal).toBe('99.99')
    // VAT on the exact base: 9_999_000 × 810 / 10_000_000 = 809.919 → 810
    expect(t.vat_total).toBe('8.10')
    // 99.99 + 8.10 = 108.09 exact → rounded ONCE to five rappen → 108.10
    expect(t.rounding).toBe('0.01')
    expect(t.total).toBe('108.10')
  })

  it('the policies do not all agree, or one of them is unreachable', () => {
    const totals = (['none', 'total_0_05', 'line_0_05', 'exact_0_05'] as const).map(
      (p) => computeTotals(lines, false, p).subtotal
    )
    // `none`, `total_0_05` and `exact_0_05` share a subtotal; `line_0_05` must differ.
    expect(new Set(totals).size).toBeGreaterThan(1)
  })
})

describe('`exact_0_05`: lines kept exact, one rounding at the end (the first customer, 2026-09-23)', () => {
  it('rounds milli-rappen to five rappen in ONE step', () => {
    // 0.5 × 12.35 = 6.175 exactly, in milli-rappen
    expect(lineProductExact(parseQty('0.5'), parseRappen('12.35'))).toBe(617_500)
    // …which PRINTS as 6.18
    expect(milliToRappen(617_500)).toBe(618)
    // …and rounds to 6.20 as a total: 6.175 / 0.05 = 123.5 → half away → 124 × 5
    expect(roundMilliToStep(617_500, 5)).toBe(620)
    // Symmetric for a credit: -6.175 → -6.20, not -6.15
    expect(roundMilliToStep(-617_500, 5)).toBe(-620)
    // 10.32085 → 10.30, and NOT 10.33 → 10.35 (that would be two roundings)
    expect(roundMilliToStep(1_032_085, 5)).toBe(1030)
  })

  it('golden: 0.5 × 12.35 prints 6.18 and totals 6.20', () => {
    const t = computeTotals([line('0.5', '12.35', null)], true, 'exact_0_05')
    // The printed line is the exact 6.175 to the rappen.
    expect(computeTotalsRappen([line('0.5', '12.35', null)], true, 'exact_0_05').line_totals).toEqual([618])
    expect(t.subtotal).toBe('6.18')
    expect(t.vat).toEqual([])
    // 6.175 → 6.20 in one rounding; the paper shows 6.18 + 0.02 = 6.20.
    expect(t.rounding).toBe('0.02')
    expect(t.total).toBe('6.20')
  })

  it('golden: the worked example — 1.5 × 350 exempt + 1 × 180 at 8.1%, less 10% as two negative lines', () => {
    // Prices INCLUDE VAT. −10% is a taxable −18.00 and an exempt −52.50.
    const lines = [
      line('1.5', '350.00', null), // 525.00
      line('1', '180.00', '8.1'), // 180.00, VAT inside
      line('1', '-18.00', '8.1'), // −10% of the taxable line
      line('1', '-52.50', null), // −10% of the exempt line
    ]
    const t = computeTotals(lines, true, 'exact_0_05')
    // 525.00 + 180.00 − 18.00 − 52.50 = 634.50, already a multiple of 0.05
    expect(t.subtotal).toBe('634.50')
    expect(t.rounding).toBe('0.00')
    expect(t.total).toBe('634.50')
    // The taxable base is 180.00 − 18.00 = 162.00 and CONTAINS its VAT:
    //   162.00 × 8.1 / 108.1 = 12.1387… → 12.14
    //   in milli-rappen: 16_200_000 × 810 / (10810 × 1000) = 1213.87… → 1214
    expect(t.vat).toEqual([{ rate: '8.1', base: '162.00', amount: '12.14' }])
    expect(t.vat_total).toBe('12.14')
  })

  // The fixture the policy exists for: a fractional quantity whose exact
  // product is not a whole number of rappen.
  //   0.5   × 12.35 = 6.175    (617_500 milli-rappen) → prints 6.18
  //   0.333 × 12.45 = 4.14585  (414_585 milli-rappen) → prints 4.15
  //   exact sum   = 10.32085   → ONE rounding to five rappen → 10.30
  //   printed sum = 10.33      → what the paper shows as the subtotal
  const fractional = [line('0.5', '12.35', null), line('0.333', '12.45', null)]

  it('golden: differs from `total_0_05`, which rounds the lines first', () => {
    const exact = computeTotals(fractional, true, 'exact_0_05')
    expect(exact.subtotal).toBe('10.33')
    expect(exact.total).toBe('10.30')
    // 10.33 − 0.03 = 10.30 — the Arrondi line carries the gap.
    expect(exact.rounding).toBe('-0.03')

    // `total_0_05`: 6.18 + 4.15 = 10.33 → nearest five rappen is 10.35
    const rounded = computeTotals(fractional, true, 'total_0_05')
    expect(rounded.subtotal).toBe('10.33')
    expect(rounded.rounding).toBe('0.02')
    expect(rounded.total).toBe('10.35')

    // The two must not agree, or the exact path is unreachable.
    expect(exact.total).not.toBe(rounded.total)
  })

  it('takes the VAT on the exact base, and prints that base to the rappen', () => {
    // Same two lines, EXCLUDING VAT at 8.1% on both.
    const taxed = fractional.map((l) => line(l.qty, l.unit_price, '8.1'))
    const t = computeTotals(taxed, false, 'exact_0_05')
    // base = 10.32085 exact; VAT = 1_032_085 × 810 / (10000 × 1000) = 83.598… → 0.84
    expect(t.vat).toEqual([{ rate: '8.1', base: '10.32', amount: '0.84' }])
    // exact 10.32085 + 0.84 = 11.16085 → ONE rounding → 11.15
    expect(t.total).toBe('11.15')
    // printed: 10.33 + 0.84 = 11.17, so the Arrondi line is −0.02
    expect(t.subtotal).toBe('10.33')
    expect(t.rounding).toBe('-0.02')
  })

  it('THE DOCUMENT FOOTS: printed lines → subtotal → (VAT) → rounding → total, where exact ≠ printed', () => {
    for (const pricesIncludeVat of [true, false]) {
      const lines = pricesIncludeVat ? fractional : fractional.map((l) => line(l.qty, l.unit_price, '8.1'))
      const r = computeTotalsRappen(lines, pricesIncludeVat, 'exact_0_05')

      // PRECONDITION, asserted so this test cannot pass vacuously: the exact sum
      // and the sum of the printed lines are different numbers here.
      const exactSum = lines.reduce((a, l) => a + lineProductExact(parseQty(l.qty), parseRappen(l.unit_price)), 0)
      const printedSum = r.line_totals.reduce((a, b) => a + b, 0)
      expect(milliToRappen(exactSum)).not.toBe(printedSum)

      // 1. the printed subtotal is the sum of the PRINTED lines, not the exact sum
      expect(r.subtotal).toBe(printedSum)
      // 2. the total is the EXACT sum rounded once
      expect(r.total).toBe(roundMilliToStep(exactSum + (pricesIncludeVat ? 0 : r.vat_total * 1000), 5))
      // 3. and the rounding figure closes the gap on paper
      expect(r.subtotal + (pricesIncludeVat ? 0 : r.vat_total) + r.rounding).toBe(r.total)
      // 4. it is a real gap, not zero — or this fixture proves nothing
      expect(r.rounding).not.toBe(0)
    }
  })

  it('an empty invoice and a whole-number invoice behave like `total_0_05`', () => {
    expect(computeTotals([], true, 'exact_0_05').total).toBe('0.00')
    const whole = [line('12', '132.50', '8.1')]
    // 1590.00 exact; VAT 128.79; 1718.79 → 1718.80, rounding +0.01
    const t = computeTotals(whole, false, 'exact_0_05')
    expect(t).toEqual(computeTotals(whole, false, 'total_0_05'))
    expect(t.total).toBe('1718.80')
    expect(t.rounding).toBe('0.01')
  })
})

describe('several rates on one document', () => {
  it('gives one VAT line per rate, ascending, on its own base', () => {
    const t = computeTotals(
      [
        line('1', '100.00', '8.1'), // standard
        line('1', '200.00', '2.6'), // reduced
        line('1', '300.00', null), // exempt
        line('1', '50.00', '8.1'), // standard again — must MERGE with the first
      ],
      false,
      'none'
    )
    expect(t.subtotal).toBe('650.00')
    expect(t.vat).toEqual([
      // 2.6% on 200.00 = 5.20  (20000 × 260 / 10000 = 520)
      { rate: '2.6', base: '200.00', amount: '5.20' },
      // 8.1% on 150.00 = 12.15 (15000 × 810 / 10000 = 1215)
      { rate: '8.1', base: '150.00', amount: '12.15' },
    ])
    expect(t.vat_total).toBe('17.35')
    expect(t.total).toBe('667.35')
  })

  it('merges rates written two ways, because they are one rate', () => {
    const t = computeTotals([line('1', '100.00', '8.1'), line('1', '100.00', '8.10')], false, 'none')
    expect(t.vat).toHaveLength(1)
    expect(t.vat[0]).toEqual({ rate: '8.1', base: '200.00', amount: '16.20' })
  })

  it('orders the block by rate, not by line order', () => {
    const t = computeTotals([line('1', '10.00', '8.1'), line('1', '10.00', '2.6')], false, 'none')
    expect(t.vat.map((v) => v.rate)).toEqual(['2.6', '8.1'])
  })
})

describe('edge cases that have to be answered rather than crash', () => {
  it('an empty invoice totals zero', () => {
    const t = computeTotals([], false, 'line_0_05')
    expect(t).toEqual({
      subtotal: '0.00',
      vat: [],
      vat_total: '0.00',
      rounding: '0.00',
      total: '0.00',
    })
  })

  it('a credit line makes a negative total, and rounds symmetrically', () => {
    const t = computeTotals([line('1', '100.00', null), line('-1', '150.00', null)], false, 'total_0_05')
    expect(t.subtotal).toBe('-50.00')
    expect(t.total).toBe('-50.00')
  })

  it('reports each line total so a caller need not recompute one', () => {
    const r = computeTotalsRappen(
      [line('12', '132.50', '8.1'), line('0.5', '200.00', null)],
      false,
      'none'
    )
    expect(r.line_totals).toEqual([159000, 10000])
  })
})
