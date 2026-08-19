// The management view's arithmetic — the exact half and the float half, and
// the boundary between them.
//
// ── WATCHED FAIL BEFORE BEING TRUSTED (2026-08-19) ────────────────────────
// The mutation is recorded beside each case. An assertion nobody has seen fail
// is not an assertion — CLAUDE.md's standing rule, and twenty-one findings.
//
// ── AND THE EXACTNESS CASE IS BORROWED, DELIBERATELY ──────────────────────
// `lib/rollup.test.ts` records that the FIRST version of its equivalent
// assertion passed against a rollup rewritten to accumulate in a JavaScript
// `number`: at any magnitude this product sees, `toFixed(2)` rounds the drift
// away, so ordinary inputs cannot tell an exact implementation from a float
// one. The 22 amounts below are the input that file found by greedy reduction
// from a random hit — the smallest set that DOES separate them — and they are
// reused here rather than a fresh "obviously fine" set, because this module
// adds money for the same reason and would fail the same way.
//
// No real book looks like this. That is said rather than hidden: the case
// exists to pin the IMPLEMENTATION, and the ordinary-magnitude cases beside it
// check the sums are RIGHT. Both properties matter and neither implies the
// other.

import { describe, it, expect } from 'vitest'
import {
  axisTicks,
  barLength,
  breakdownTotal,
  flowTotals,
  hasGaps,
  isZeroAmount,
  maxAmount,
  monthLabel,
  share,
  tickLabel,
} from './analytique'
import type { AnalytiqueCategory, MonthlyFlow } from './types'

const flow = (month: string, produits: string, charges: string): MonthlyFlow => ({
  month,
  produits,
  charges,
})

const cat = (key: string, amount: string): AnalytiqueCategory => ({
  key,
  label: { fr: key, en: key },
  accounts: ['6000'],
  amount,
  lines: [],
})

describe('flowTotals', () => {
  // The seeded blackcode book, read off `bk books analytique` on 2026-08-19.
  // Mutation watched: `produits += toCentimes(f.charges)`. Red on all three.
  it('adds the served months and signs the net', () => {
    const t = flowTotals([flow('2026-01', '0.00', '15333.60'), flow('2026-02', '5420.00', '1080.00')])
    expect(t.produits).toBe('5420.00')
    expect(t.charges).toBe('16413.60')
    expect(t.net).toBe('-10993.60')
    expect(t.months).toBe(2)
  })

  // Mutation watched: `months: 12`. Red.
  // The series is SPARSE — this is the coverage of the figures beside it, not
  // the length of the exercice, and the screen says so in words.
  it('counts the months it was given, which is not the length of a year', () => {
    expect(flowTotals([]).months).toBe(0)
    expect(flowTotals([flow('2026-03', '1.00', '0.00')]).months).toBe(1)
  })

  it('an empty series totals to zeroes, not to NaN or an em dash', () => {
    const t = flowTotals([])
    expect([t.produits, t.charges, t.net]).toEqual(['0.00', '0.00', '0.00'])
  })

  // See the header. Mutation watched: rewrote `flowTotals` to accumulate in a
  // `number` and return `.toFixed(2)`. RED here, and GREEN on every other case
  // in this file — which is the whole point of keeping this one.
  it('is exact where a float accumulator is not', () => {
    const amounts = [
      '337041829142.77', '849040464376.25', '961180221364.47', '-249409505529.45',
      '677686285178.45', '670166416075.13', '759039300117.92', '801153259569.52',
      '435247829114.44', '617978998808.37', '407011767622.88', '986008509500.09',
      '-323362444061.55', '977049613790.98', '544573149086.32', '175746542384.39',
      '822440421105.78', '307452228495.38', '-59736699690.79', '-332889776561.02',
      '-482286619406.61', '-714576247992.35',
    ]
    // Summed as JavaScript numbers and `.toFixed(2)`-ed this gives
    // 8166555542491.38 — one rappen too many. Confirmed in node, not assumed.
    expect(flowTotals(amounts.map((a, i) => flow(`20${10 + i}-01`, a, '0.00'))).produits).toBe(
      '8166555542491.37'
    )
  })

  // The other half of the same magnitude story: `net` is a SUBTRACTION of two
  // accumulators, so it can drift where neither total does.
  it('is exact in the net, not only in the two totals', () => {
    const rows = [flow('2026-01', '0.07', '0.10'), flow('2026-02', '0.07', '0.10')]
    expect(flowTotals(rows).net).toBe('-0.06')
    const ten = Array.from({ length: 10 }, (_, i) =>
      flow(`2026-${String(i + 1).padStart(2, '0')}`, '0.07', '0.10')
    )
    expect(flowTotals(ten).produits).toBe('0.70')
    expect(flowTotals(ten).net).toBe('-0.30')
  })
})

describe('breakdownTotal', () => {
  // blackcode's five buckets, off `bk books analytique`.
  //
  // Mutation attempted: `continue` on a zero amount. GREEN — adding zero
  // changes nothing, so this case CANNOT see that mutation. Recorded rather
  // than left implied: the zero bucket's protection is that its ROW renders,
  // which is a fact about the screen and not about this total. A case that
  // cannot fail must not be claimed as covering what it does not.
  it('adds the buckets exactly, zero buckets included', () => {
    expect(
      breakdownTotal([
        cat('personnel', '13350.00'),
        cat('bureau', '1850.00'),
        cat('it_ai', '133.60'),
        cat('admin', '1080.00'),
        cat('autres', '0.00'),
      ])
    ).toBe('16413.60')
  })

  it('an unconfigured book totals to zero, not to nothing', () => {
    expect(breakdownTotal([])).toBe('0.00')
  })
})

describe('maxAmount', () => {
  // Mutation watched: `if (c >= top)` → `if (c < top)`. Red.
  // The ceiling decides which bar fills the track; get it wrong and the
  // shortest bar is the longest one.
  it('picks the largest, exactly', () => {
    expect(maxAmount(['13350.00', '1850.00', '133.60', '0.00'])).toBe('13350.00')
    expect(maxAmount([])).toBe('0.00')
    expect(maxAmount(['0.00', '0.00'])).toBe('0.00')
  })

  // ── A MUTATION THAT STAYED GREEN, RECORDED RATHER THAN QUIETLY DROPPED ──
  // `Math.max(0, ...values.map(Number)).toFixed(2)` passes every case in this
  // block, INCLUDING an input at the top of `numeric(14,2)`. The reason is
  // arithmetic and it is worth writing down: at 1e12 the gap between two
  // doubles is about 1.2e-4, which is finer than a rappen, so a float can
  // order every value this column can hold. There is no separating input to
  // find and this file does not pretend to have one.
  //
  // `maxAmount` stays exact anyway, for the reason `lib/rollup.ts` gives about
  // its own arithmetic: correct by construction beats correct by luck of
  // magnitude, and one parser in this module is easier to hold than two. But a
  // reader must not take this block for a check that the implementation is
  // exact — the only assertion in this FILE that can tell those apart is
  // `flowTotals` "is exact where a float accumulator is not", which was
  // watched to be red on precisely that rewrite while all twenty others
  // stayed green.
  it('normalises to two decimals, whatever the wire spelled', () => {
    expect(maxAmount(['5'])).toBe('5.00')
    expect(maxAmount(['5.1', '5.09'])).toBe('5.10')
  })

  // Negative amounts are real: a credit note reduces its category, so a bucket
  // can be negative. A ceiling of zero draws no bars, which is right — there
  // is no positive magnitude to scale against.
  it('does not let a negative amount become the ceiling', () => {
    expect(maxAmount(['-500.00', '-10.00'])).toBe('0.00')
  })
})

describe('isZeroAmount', () => {
  // Mutation watched: `value === '0.00'`. Red on `'0'` and `'-0.00'` — both of
  // which a `numeric` column can produce and neither of which is that string.
  it('reads the value, not its spelling', () => {
    expect(isZeroAmount('0.00')).toBe(true)
    expect(isZeroAmount('0')).toBe(true)
    expect(isZeroAmount('-0.00')).toBe(true)
    expect(isZeroAmount('0.01')).toBe(false)
    expect(isZeroAmount('-0.01')).toBe(false)
  })
})

describe('the geometry — floats, and never displayed as money', () => {
  // Mutation watched: dropped the `minVisible` floor. Red on the 27.10 case,
  // which is what AIOS's only non-zero bucket looks like beside blackcode's
  // ceiling: 0.2% of the width, which is no bar at all.
  it('gives a non-zero amount a bar you can see, and a zero amount none', () => {
    expect(barLength('0.00', '13350.00')).toBe(0)
    expect(barLength('27.10', '13350.00')).toBe(1.5)
    expect(barLength('13350.00', '13350.00')).toBe(100)
    expect(barLength('6675.00', '13350.00')).toBe(50)
  })

  // A ceiling of zero is every bucket at zero — a book with no postings. The
  // bars are all absent, and none of them is 100% of nothing.
  it('draws nothing against a zero ceiling', () => {
    expect(barLength('0.00', '0.00')).toBe(0)
    expect(barLength('5.00', '0.00')).toBe(0)
  })

  // Mutation watched: `return 0` instead of `null` when the total is zero. Red.
  // `0.0%` is a ratio nobody computed; the screen shows a dash instead.
  it('has no share of a zero total', () => {
    expect(share('0.00', '0.00')).toBeNull()
    expect(share('13350.00', '16413.60')).toBe(81.3)
    expect(share('0.00', '16413.60')).toBe(0)
  })

  it('scales an axis to a round ceiling above the peak', () => {
    const a = axisTicks(['15333.60', '5420.00', '1080.00', '0.00'])
    expect(a.max).toBeGreaterThanOrEqual(15333.6)
    expect(a.ticks[0]).toBe(0)
    expect(a.ticks[a.ticks.length - 1]).toBe(a.max)
    // Mutation watched: `v < max` for the loop bound. Red — the top tick drops
    // out on this input, leaving the ceiling gridline missing.
    expect(a.ticks.length).toBeGreaterThan(2)
  })

  // Every month at zero is a real state — a book whose only postings are
  // balance-sheet movements. A ceiling of 1 draws a baseline and nothing else,
  // rather than dividing by zero.
  it('survives an all-zero series', () => {
    expect(axisTicks(['0.00', '0.00'])).toEqual({ max: 1, ticks: [0] })
    expect(axisTicks([])).toEqual({ max: 1, ticks: [0] })
  })

  it('labels a tick as scale, not as money', () => {
    expect(tickLabel(0)).toBe('0')
    expect(tickLabel(600)).toBe('600')
    expect(tickLabel(5000)).toBe('5k')
    expect(tickLabel(2500)).toBe('2.5k')
  })
})

describe('the month label', () => {
  // Mutation watched: `new Date(ym + '-01').toLocaleString('en', {month:'short'})`.
  // The reason it must not be a Date is the one `lib/format.ts` records: a
  // Postgres `date` has no time of day, and midnight UTC is the previous month
  // for anybody west of Greenwich — on a screen whose whole subject is which
  // month a franc landed in.
  it('slices the string and constructs no Date', () => {
    expect(monthLabel('2026-01')).toBe('Jan 26')
    expect(monthLabel('2026-12')).toBe('Dec 26')
    expect(monthLabel('2025-03')).toBe('Mar 25')
  })

  it('returns an unrecognised value unchanged rather than guessing', () => {
    expect(monthLabel('2026-13')).toBe('2026-13')
    expect(monthLabel('')).toBe('')
  })
})

describe('hasGaps', () => {
  // The seeded RI book is 2026-01, -02, -03: consecutive, no gap. Take February
  // out and there is one, and the chart says so rather than drawing three
  // months as though they were consecutive.
  //
  // Mutation watched: `flows.length < 3`. Red on the two-month gap case.
  it('sees a month missing between two that are served', () => {
    expect(hasGaps([flow('2026-01', '0', '0'), flow('2026-02', '0', '0'), flow('2026-03', '0', '0')])).toBe(false)
    expect(hasGaps([flow('2026-01', '0', '0'), flow('2026-03', '0', '0')])).toBe(true)
    expect(hasGaps([flow('2026-01', '0', '0')])).toBe(false)
    expect(hasGaps([])).toBe(false)
  })

  // Mutation watched: dropped the year term from `index()`. Red — December to
  // January reads as an eleven-month gap without it.
  it('counts across a year boundary', () => {
    expect(hasGaps([flow('2025-12', '0', '0'), flow('2026-01', '0', '0')])).toBe(false)
    expect(hasGaps([flow('2025-11', '0', '0'), flow('2026-01', '0', '0')])).toBe(true)
  })
})
