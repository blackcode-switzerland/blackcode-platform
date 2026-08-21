// What this file is for: the money display path must never construct a float.
//
// It was written after the review on 2026-08-17 found that it did — `money()` was
// `group(amount(value))` and `amount()` is `Number(value)`, so every rendered
// franc round-tripped through float64. The fault was latent (lossless for every
// value `numeric(14,2)` can hold) and would have gone live with the first VAT
// figure carrying a third decimal.
//
// Two of the suites below matter more than the rest:
//
//   1. `nothing here changes what a reader already sees` — a randomised
//      comparison against the OLD implementation over the full `numeric(14,2)`
//      range. The fix had to remove the float without restyling one character,
//      and that is not a claim to make by reading.
//   2. `the decimal cases the float got wrong` — the values that motivated it.
//      Each is a case where `Number()` + `toFixed()` disagrees with what a person
//      doing it on paper writes.
//
// Every assertion here was watched fail before being kept: `MINUS` flipped to
// U+2212, `GROUP` to U+2019, half-away-from-zero to half-down, and the string
// guard loosened to accept `1e3`. Each mutation reddened its own case and left
// the others green.

import { describe, expect, it } from 'vitest'
import { confidence, date, group, money, percent } from './format'

/**
 * The implementation as it stood in commit `24a6dd4`, kept only so the fix can be
 * proved output-preserving. **Not a fixture to copy** — it is the bug.
 */
function moneyBeforeTheFix(value: string | number | null | undefined, currency = 'CHF'): string {
  const n = value === null || value === undefined || value === '' ? null : Number(value)
  if (n === null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${currency} ${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${frac}`
}

describe('money', () => {
  it('writes an amount the way the mockup writes it', () => {
    expect(money('1234.50')).toBe("CHF 1'234.50")
    expect(money('0.00')).toBe('CHF 0.00')
    expect(money('63700')).toBe("CHF 63'700.00")
    expect(money('112333.03')).toBe("CHF 112'333.03")
    expect(money('999999999999.99')).toBe("CHF 999'999'999'999.99")
  })

  it('keeps two decimals, because a bilan balances to the rappen', () => {
    expect(money('4200')).toBe("CHF 4'200.00")
    expect(money('4200.5')).toBe("CHF 4'200.50")
  })

  it('renders a negative as it does today', () => {
    // Today's spelling, not the mockup's. The divergence is F2 in the review and
    // is an open specification decision; this asserts what we currently ship so
    // that answering it is a deliberate edit and not a silent drift.
    expect(money('-1234.50')).toBe("CHF -1'234.50")
    expect(money('-0.01')).toBe('CHF -0.01')
  })

  it('never prints a signed zero', () => {
    expect(money('-0.00')).toBe('CHF 0.00')
    expect(money('-0.001')).toBe('CHF 0.00')
    expect(money('-0.004')).toBe('CHF 0.00')
  })

  it('shows an absent amount as absent, never as zero', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(money('')).toBe('—')
  })

  it('takes a currency other than CHF', () => {
    expect(money('1234.50', 'EUR')).toBe("EUR 1'234.50")
  })
})

describe('the decimal cases the float got wrong', () => {
  // Each of these is a real disagreement between decimal rounding and
  // `Number()` + `toFixed(2)`. A VAT computation is where a third decimal
  // actually arrives.
  // ── THIS LIST IS SHORTER THAN THE FIRST DRAFT, AND THE SUITE IS WHY ───────
  // It began with `1234.565` and `8.005` in it, taken from the review. Both are
  // cases where the float rounds UP — and so does decimal rounding, so neither
  // distinguishes the fix from the bug. The `disagreements` assertion below
  // failed and named them. They are gone.
  //
  // (The review's point about `8.005` still stands and is a different one: it
  // rounds up where `0.145` rounds down, from the same input shape. That is the
  // inconsistency, not a wrong answer. See the header of `format.ts`.)
  const cases: Array<[string, string, string]> = [
    // wire value      correct (half away from zero)   what the float produced
    ['0.145', 'CHF 0.15', 'CHF 0.14'],
    ['1.005', 'CHF 1.01', 'CHF 1.00'],
    ['2.675', 'CHF 2.68', 'CHF 2.67'],
    ['1.115', 'CHF 1.12', 'CHF 1.11'],
    ['4.345', 'CHF 4.35', 'CHF 4.34'],
    ['12345.675', "CHF 12'345.68", "CHF 12'345.67"],
  ]

  it.each(cases)('%s renders %s', (wire, correct) => {
    expect(money(wire)).toBe(correct)
  })

  it('and the old implementation really did disagree (so these cases are real)', () => {
    const disagreements = cases.filter(([wire]) => money(wire) !== moneyBeforeTheFix(wire))
    // Asserting the INPUTS are meaningful — a case list where the two agree would
    // pass this file while proving nothing.
    expect(disagreements.length, 'no case here distinguishes the fix from the bug').toBe(
      cases.length
    )
  })

  it('carries across a nine, all the way up', () => {
    expect(money('9.999')).toBe('CHF 10.00')
    expect(money('999.995')).toBe("CHF 1'000.00")
    expect(money('99999.999')).toBe("CHF 100'000.00")
  })

  it('refuses scientific notation instead of believing it', () => {
    // `Number('1e3')` is 1000, so the old path rendered `CHF 1'000.00` for a
    // string no bookkeeping route can legitimately serve.
    expect(moneyBeforeTheFix('1e3')).toBe("CHF 1'000.00")
    expect(money('1e3')).toBe('—')
    expect(money('0x10')).toBe('—')
    expect(money('Infinity')).toBe('—')
    expect(money('12.34.56')).toBe('—')
    expect(money('abc')).toBe('—')
  })
})

describe('nothing here changes what a reader already sees', () => {
  // The constraint on the fix: remove the float, restyle nothing. Compared
  // against the old implementation over the range the column type can hold.
  function sample(seed: number): string {
    // A fixed LCG, so a failure is reproducible and the suite is not flaky.
    let s = seed
    const next = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const negative = next() < 0.5
    const int = Math.floor(next() * 1_000_000_000_000)
    const frac = String(Math.floor(next() * 100)).padStart(2, '0')
    return `${negative ? '-' : ''}${int}.${frac}`
  }

  it('agrees with the old implementation on 20 000 values across numeric(14,2)', () => {
    const mismatches: string[] = []
    for (let i = 1; i <= 20_000; i += 1) {
      const v = sample(i)
      if (money(v) !== moneyBeforeTheFix(v)) mismatches.push(v)
    }
    expect(mismatches.slice(0, 5), `${mismatches.length} values render differently`).toEqual([])
  })

  it('agrees on the boundaries and the awkward shapes', () => {
    for (const v of [
      '0',
      '0.00',
      '0.01',
      '-0.01',
      '1000',
      '999.99',
      '1000.00',
      '999999999999.99',
      '-999999999999.99',
      '1234567890.12',
    ]) {
      expect(money(v), v).toBe(moneyBeforeTheFix(v))
    }
  })
})

describe('group', () => {
  it('groups a number that view arithmetic produced', () => {
    expect(group(1234.5)).toBe("1'234.50")
    expect(group(-1234.5)).toBe("-1'234.50")
    expect(group(0)).toBe('0.00')
  })

  it('does not print a signed zero either', () => {
    expect(group(-0.001)).toBe('0.00')
  })

  it('gives an em dash for a value that is not a number', () => {
    expect(group(Number.NaN)).toBe('—')
    expect(group(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('date', () => {
  it('writes the Swiss order and touches no Date', () => {
    expect(date('2026-01-05')).toBe('05.01.2026')
    expect(date('2026-01-05T00:00:00Z')).toBe('05.01.2026')
  })

  it('is absent for an absent date', () => {
    expect(date(null)).toBe('—')
    expect(date(undefined)).toBe('—')
    expect(date('')).toBe('—')
  })
})

describe('percent', () => {
  it('writes a VAT rate', () => {
    expect(percent(8.1)).toBe('8.1%')
    expect(percent(0)).toBe('0%')
    expect(percent(2.6)).toBe('2.6%')
  })

  it('is absent for an absent rate', () => {
    expect(percent(null)).toBe('—')
    expect(percent(undefined)).toBe('—')
  })

  // ── THE WIRE FORM, ADDED 2026-08-18 ──────────────────────────────────────
  // `entry.tva.rate` is `numeric(4,2)` and arrives as `"8.10"`, not `8.1`
  // (verified against `GET …/entries`). `lib/types.ts` declared it as a `number`
  // and was corrected; `percent()` handles the string HERE so no call site has
  // to reach for `Number()`.
  //
  // Mutation watched: removed the string branch, leaving `percent(rate as number)`.
  // Red — `"8.10"` rendered `8.10%` instead of `8.1%`, and `"0.00"` rendered
  // `0.00%` instead of `0%`.
  it('takes the numeric string the wire actually sends', () => {
    expect(percent('8.10')).toBe('8.1%')
    expect(percent('2.60')).toBe('2.6%')
    expect(percent('0.00')).toBe('0%')
    expect(percent('3.80')).toBe('3.8%')
  })

  it('trims only trailing zeros, never a significant digit', () => {
    expect(percent('10.00')).toBe('10%')
    expect(percent('8.05')).toBe('8.05%')
    expect(percent('100')).toBe('100%')
  })

  // A rate this function does not recognise must look ABSENT. Rendering `0%`
  // for a malformed value is a legally different claim from "no rate recorded":
  // 0% VAT is a real rate (an exempt supply), and no rate is no answer.
  it('refuses anything that is not a plain decimal, rather than printing 0%', () => {
    expect(percent('')).toBe('—')
    expect(percent('eight')).toBe('—')
    expect(percent('8,1')).toBe('—')
    expect(percent('1e1')).toBe('—')
  })
})

// ===========================================================================
// AN ABSENT CONFIDENCE AND A ZERO CONFIDENCE ARE DIFFERENT CLAIMS
// ===========================================================================
// `PieceExtraction.confidence` is optional. The pièces inbox prints it on every
// row, so this function decides — for every document in the workspace — whether
// "nobody scored this" looks the same as "the extractor trusts none of it".
// They must not. `percent()` states the same rule for a VAT rate one suite up,
// and the reason is the same: a screen that renders an unknown as a zero has
// invented a judgment on the display path.
//
// ── MUTATIONS WATCHED, 2026-08-21 ────────────────────────────────────────
//   a) `if (value === null || value === undefined) return '0%'`
//        → "an absent confidence is an em dash" red on undefined AND on null.
//   b) the `value < 0 || value > 1` guard removed
//        → "a value outside 0…1 is not a confidence" red (1.5 rendered 150%).
//   c) `Math.round` → `Math.floor`
//        → "it rounds to whole percent" red on 0.965.
describe('confidence — the absent one is not a zero', () => {
  it('an absent confidence is an em dash', () => {
    expect(confidence(undefined)).toBe('—')
    expect(confidence(null)).toBe('—')
  })

  it('a REPORTED zero is 0%, because the extractor said so', () => {
    // The pair that matters. If this and the case above ever render the same
    // string, the inbox is claiming the pipeline distrusts every document
    // nobody scored.
    expect(confidence(0)).toBe('0%')
    expect(confidence(0)).not.toBe(confidence(undefined))
  })

  it('rounds to whole percent', () => {
    expect(confidence(0.96)).toBe('96%')
    expect(confidence(0.965)).toBe('97%')
    expect(confidence(1)).toBe('100%')
  })

  it('a value outside 0…1 is not a confidence this app knows how to print', () => {
    expect(confidence(1.5)).toBe('—')
    expect(confidence(-0.2)).toBe('—')
    expect(confidence(NaN)).toBe('—')
  })
})
