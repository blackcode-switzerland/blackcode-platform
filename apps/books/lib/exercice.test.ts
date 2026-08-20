// "A closed year is distinguishable from an open one" — asserted at the place
// the fact was being lost.
//
// ===========================================================================
// THE FACT WAS NOT MISSING FROM THE WIRE. IT WAS DROPPED IN THE REDUCER.
// ===========================================================================
// `GET …/exercices` has served `status` since phase 1. `lib/scope.ts` reduced
// the list to `number[]`, so every screen in the product rendered a filed
// exercice and a live one identically — and `bk books exercice close` now exists
// with no reopen, ever. That is a legally meaningful distinction rendered as
// nothing, and it is the shape of failure `HANDOFF.md` §7 lists five times: the
// backend can say something new and the screens cannot hear it.
//
// ── EVERY CASE HERE WAS WATCHED TO GO RED (2026-08-20) ────────────────────
// The mutation is beside each one.

import { describe, it, expect } from 'vitest'
import { exerciceOptions, statusOf } from './exercice'
import type { ExerciceStatusRow } from './exercice'
import type { ExerciceRow } from './hooks'

/**
 * The hook's row is assignable to this module's.
 *
 * ── AT COMPILE TIME, BECAUSE THIS IS WHERE THE TWO COULD DRIFT ────────────
 * `useExercices` declares the wire shape; this module declares what it reads.
 * If the route ever renames `status`, or widens it to a third value, that is a
 * type error at `npm run typecheck` — one of the four gates — rather than a
 * `status` of `undefined` folding every year into `null` and quietly reporting
 * that nothing can be told about any of them.
 *
 * Mutation watched (2026-08-20), FIRST attempt: widened
 * `ExerciceStatusRow.status` — i.e. THIS module's declaration — to add
 * `'draft'`. Typecheck went red, but inside `lib/exercice.ts` itself, not here.
 * That mutation moves the thing this line reads from, so it cannot isolate it.
 *
 * The two that DO, and both are the real drift: widening `ExerciceRow.status` in
 * `lib/hooks.ts` to `'open' | 'closed' | 'draft'` (red here, naming the property
 * and both unions), and RENAMING it to `state` (red here and in `lib/scope.ts`).
 * Those are the shapes a route change actually arrives in. Restored.
 */
const _rowIsAssignable: ExerciceStatusRow = null as unknown as ExerciceRow
void _rowIsAssignable

const row = (year: number, status: 'open' | 'closed'): ExerciceStatusRow => ({ year, status })

describe('the fiscal years carry whether they are closed', () => {
  // Mutation watched: `byYear.set(row.year, row.status)` → `byYear.set(row.year,
  // 'open')`, i.e. the status hardcoded. RED, naming 2025.
  //
  // Second mutation watched — the REGRESSION this module exists to prevent:
  // `exerciceOptions` reduced to `[...new Set(rows.map(r => r.year))].sort()
  // .map(year => ({ year, status: 'open' }))`, which is what `lib/scope.ts` did
  // before today expressed in this signature. RED on the same assertion.
  it('a closed year comes back closed and an open one open', () => {
    const out = exerciceOptions([row(2026, 'open'), row(2025, 'closed')])
    expect(out).toEqual([
      { year: 2026, status: 'open' },
      { year: 2025, status: 'closed' },
    ])
  })

  // Mutation watched: `.sort((a, b) => b.year - a.year)` deleted. RED.
  // The caller's default takes the FIRST element, and `lib/scope.ts` records
  // what happened last time that assumption was wrong: the app opened on a
  // closed exercice and would have shown every screen a year of finished books.
  it('newest first', () => {
    expect(exerciceOptions([row(2024, 'closed'), row(2026, 'open'), row(2025, 'closed')]).map((o) => o.year))
      .toEqual([2026, 2025, 2024])
  })

  // Mutation watched: the `if (!byYear.has(...))` guard removed, so the LAST row
  // for a year wins instead of the first. Green on this case — the count is
  // still 1 — and red on the disagreement case below. Recorded because it is a
  // reminder that this case only checks the COUNT.
  it('one option per year, however many books served a row for it', () => {
    const out = exerciceOptions([row(2026, 'open'), row(2026, 'open'), row(2026, 'open')])
    expect(out).toEqual([{ year: 2026, status: 'open' }])
  })

  // ── THE ONE A BROWSER WILL NOT SHOW YOU ─────────────────────────────────
  //
  // Three books' 2026 rows fold into one option and they need not agree. Taking
  // the first row's status would be a legal claim about somebody's books read
  // off an array order.
  //
  // Mutation watched: `else if (byYear.get(...) !== row.status) byYear.set(...,
  // null)` deleted, so the first row wins. RED, printing `'open'` against
  // `null`. That is the mutation that matters: it is invisible on the seeded
  // database, where every book's 2026 is open, and it is exactly what a
  // "simplify this" edit produces.
  it('a year whose rows disagree has NO status, which is not "open"', () => {
    const out = exerciceOptions([row(2026, 'open'), row(2026, 'closed')])
    expect(out).toEqual([{ year: 2026, status: null }])

    // And the order of the two rows does not decide it, in either direction.
    expect(exerciceOptions([row(2026, 'closed'), row(2026, 'open')])).toEqual([
      { year: 2026, status: null },
    ])
  })

  it('no rows is no options, and that is not an error', () => {
    expect(exerciceOptions([])).toEqual([])
    expect(exerciceOptions(undefined)).toEqual([])
  })
})

describe('the status of the year in scope', () => {
  const OPTIONS = exerciceOptions([row(2026, 'open'), row(2025, 'closed')])

  // Anti-vacuous: `statusOf` returns `null` for everything if the list is empty,
  // which would satisfy the two `null` cases below in silence.
  it('found something to look in', () => {
    expect(OPTIONS.length).toBe(2)
  })

  // Mutation watched: `options.find((o) => o.year === year)` → `options[0]`,
  // i.e. the newest year's status used for whichever year is in scope. RED on
  // 2025, which is the case that matters — a reader looking at a filed year
  // while the newest one is open.
  it('reads the status of the year asked for, not of the first one', () => {
    expect(statusOf(OPTIONS, 2026)).toBe('open')
    expect(statusOf(OPTIONS, 2025)).toBe('closed')
  })

  // Mutation watched: `?? null` → `?? 'open'`. RED on both. Those are the two
  // states a screen is in before the years arrive and when the URL names a year
  // the book does not have, and calling either of them "open" is the wrong half
  // of this mistake to make.
  it('a year that is not in the list, and no year at all, are both unknown', () => {
    expect(statusOf(OPTIONS, 1066)).toBeNull()
    expect(statusOf(OPTIONS, null)).toBeNull()
  })
})
