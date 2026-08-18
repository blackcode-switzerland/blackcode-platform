// The cross-book rollup: exact, honest about what it covers, and never a
// consolidation.
//
// ── WATCHED FAIL BEFORE BEING TRUSTED (2026-08-18) ────────────────────────
// The mutation is recorded beside each case. An assertion nobody has seen fail
// is not an assertion — CLAUDE.md's standing rule, and twenty-one findings.

import { describe, it, expect } from 'vitest'
import { rollup } from './rollup'
import type { OverviewBook } from './types'

const sa = (slug: string, actif: string, resultat: string, extra: Partial<OverviewBook> = {}): OverviewBook => ({
  slug,
  name: slug,
  legal_form: 'SA',
  exercice: 2026,
  bilan: { actif, passif: actif, balanced: true, resultat },
  ri: null,
  entries: 0,
  unrecognized: 0,
  staged: 0,
  ...extra,
})

const ri = (slug: string, resultat: string, extra: Partial<OverviewBook> = {}): OverviewBook => ({
  slug,
  name: slug,
  legal_form: 'RI',
  exercice: 2026,
  bilan: null,
  ri: { recettes: '0.00', depenses: '0.00', resultat },
  entries: 0,
  unrecognized: 0,
  staged: 0,
  ...extra,
})

describe('the rollup', () => {
  // Mutation watched: `books: 3` hardcoded. Red on the one-book and empty cases.
  // D-D: nothing in this app may assume three books.
  it('counts the books it was given, whatever that number is', () => {
    expect(rollup([]).books).toBe(0)
    expect(rollup([sa('a', '1.00', '0.00')]).books).toBe(1)
    expect(rollup([sa('a', '1.00', '0.00'), sa('b', '1.00', '0.00'), sa('c', '1.00', '0.00'), sa('d', '1.00', '0.00')]).books).toBe(4)
  })

  // ===========================================================================
  // THE EXACTNESS CASE — AND THE FIRST VERSION OF IT WAS INERT
  // ===========================================================================
  // It read:
  //
  //     it('adds amounts exactly, in centimes, never through a float', …)
  //       expect(rollup([sa('a','22333.03'), sa('b','2283.03')]).totalActif)
  //         .toBe('24616.06')
  //
  // and it passed against a `rollup` rewritten to accumulate in a JavaScript
  // `number` and format with `toFixed(2)` — the exact implementation it claimed
  // to forbid. So did a ten-book case built on `0.07` and `0.10`, the textbook
  // float-drift values. **Watched, on 2026-08-18, by making that mutation and
  // running the suite: 9 passed.**
  //
  // The reason is worth writing down, because it is a fact about this product
  // and not only about this file. `toFixed(2)` rounds the accumulated error
  // away, and for amounts of the size a set of books actually holds the error
  // never reaches half a rappen. Searched for a counterexample:
  //
  //   • 3 values, ceiling magnitude (999'999'999'999.99): 4M samples, none
  //   • 2–20 values, full numeric(14,2) range, mixed signs: 3M samples, none
  //   • 30 values at ceiling magnitude: disagreements, ~1 in 10^5
  //
  // So at any magnitude b/books will see, the float implementation and the exact
  // one are indistinguishable. The exact one is still the right one — it is
  // correct by construction rather than by luck of magnitude, and `lib/rollup.ts`
  // is the one place in the web surface that adds money — but a test that cannot
  // tell them apart must not claim it can.
  //
  // What follows is the smallest input found that DOES separate them: 22 amounts
  // near the top of `numeric(14,2)`, reduced from a 30-value random hit by
  // greedy deletion. No real workspace looks like this, and that is stated rather
  // than hidden — it is here to pin the IMPLEMENTATION, and it is the only
  // assertion in this file that does.
  it('is exact where a float accumulator is not', () => {
    const amounts = [
      '337041829142.77', '849040464376.25', '961180221364.47', '-249409505529.45',
      '677686285178.45', '670166416075.13', '759039300117.92', '801153259569.52',
      '435247829114.44', '617978998808.37', '407011767622.88', '986008509500.09',
      '-323362444061.55', '977049613790.98', '544573149086.32', '175746542384.39',
      '822440421105.78', '307452228495.38', '-59736699690.79', '-332889776561.02',
      '-482286619406.61', '-714576247992.35',
    ]
    const r = rollup(amounts.map((a, i) => sa(`b${i}`, a, '0.00')))
    // Summing these as JavaScript numbers and calling `.toFixed(2)` gives
    // 8166555542491.38 — one rappen too many.
    expect(r.totalActif).toBe('8166555542491.37')
  })

  // The ordinary-magnitude cases below check the sums are RIGHT. They do not
  // check they are exact — see above. Both properties matter and they are no
  // longer conflated into one assertion that only had the first.
  it('adds ordinary amounts correctly', () => {
    expect(rollup([sa('a', '22333.03', '0.00'), sa('b', '2283.03', '0.00')]).totalActif).toBe(
      '24616.06'
    )
    const books = Array.from({ length: 10 }, (_, i) => sa(`b${i}`, '0.07', '0.10'))
    expect(rollup(books).totalActif).toBe('0.70')
    expect(rollup(books).resultat).toBe('1.00')
  })

  it('keeps a negative result negative', () => {
    expect(rollup([sa('a', '0.00', '-10993.60'), sa('b', '0.00', '862.90')]).resultat).toBe('-10130.70')
  })

  // Mutation watched: counted `ri` books into `totalActif` via `b.ri.resultat`.
  // Red on `bilanBooks`/`riBooks`, which is the pair that makes the total
  // legible rather than merely correct.
  it('leaves simplified books out of total actif, and says how many that is', () => {
    const r = rollup([sa('a', '100.00', '10.00'), ri('r', '5.00')])
    expect(r.totalActif).toBe('100.00')
    expect(r.bilanBooks).toBe(1)
    expect(r.riBooks).toBe(1)
  })

  // A simplified book HAS a result, and it belongs in the combined one — the
  // page says in words that it is a cash result added to accrual profits.
  it('does include a simplified book in the combined result', () => {
    expect(rollup([sa('a', '100.00', '10.00'), ri('r', '5.00')]).resultat).toBe('15.00')
  })

  // Mutation watched: dropped the `exercice === null` branch. Red.
  // A book with no fiscal year contributes nothing, and a total that silently
  // omits a book is the most reassuring wrong answer this panel can give.
  it('counts books with no fiscal year, which contribute nothing', () => {
    const none: OverviewBook = {
      slug: 'new',
      name: 'new',
      legal_form: 'SA',
      exercice: null,
      bilan: null,
      ri: null,
      entries: 0,
      unrecognized: 0,
      staged: 0,
    }
    const r = rollup([sa('a', '100.00', '0.00'), none])
    expect(r.withoutExercice).toBe(1)
    expect(r.bilanBooks).toBe(1)
    expect(r.totalActif).toBe('100.00')
    expect(r.books).toBe(2)
  })

  it('sums the entry counts', () => {
    const r = rollup([
      sa('a', '0.00', '0.00', { entries: 11, unrecognized: 2, staged: 3 }),
      ri('r', '0.00', { entries: 6, unrecognized: 1, staged: 0 }),
    ])
    expect([r.entries, r.unrecognized, r.staged]).toEqual([17, 3, 3])
  })

  it('an empty workspace rolls up to zeroes, not to NaN or an em dash', () => {
    const r = rollup([])
    expect(r.totalActif).toBe('0.00')
    expect(r.resultat).toBe('0.00')
    expect(r.bilanBooks).toBe(0)
  })
})
