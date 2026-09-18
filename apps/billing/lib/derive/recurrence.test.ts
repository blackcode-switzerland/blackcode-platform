// The series calendar. Pure; see recurrence.ts for the two decisions it encodes.
//
// WATCHED FAILING, 2026-09-18 — each restored:
//   - `nextDate` anchored on the clamped date it steps from, not the series' day
//       → the 31st, the 29 February and "advances … on the anchor day" cases red
//   - `advance` without the anchor (stepping from `next_date`'s own day)
//       → "advances by one step, on the anchor day" red, and the 31st case in
//         recurrences.integration.test.ts
//   - the quarter written `Math.ceil(m / 3) + 1`
//       → all five quarterly periodKey cases red
//   - `advance` completing at `done > total` instead of `>=`
//       → "completes at the cap" red, and the integration cap case

import { describe, expect, it } from 'vitest'
import { advance, isCalendarDate, isComplete, isDue, nextDate, PERIOD_EXAMPLE, PERIOD_SHAPE, periodKey } from './recurrence'

describe('nextDate', () => {
  it('a monthly series from 31 January: end of February, then back to the 31st in March', () => {
    const anchor = 31
    const feb = nextDate('monthly', '2026-01-31', anchor)
    const mar = nextDate('monthly', feb, anchor)
    const apr = nextDate('monthly', mar, anchor)
    expect([feb, mar, apr]).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('a leap year gives the 29th', () => {
    expect(nextDate('monthly', '2028-01-31', 31)).toBe('2028-02-29')
  })

  it('quarterly and yearly steps, across a year end', () => {
    expect(nextDate('quarterly', '2026-10-05')).toBe('2027-01-05')
    expect(nextDate('yearly', '2026-07-06')).toBe('2027-07-06')
    expect(nextDate('monthly', '2026-12-15')).toBe('2027-01-15')
  })

  it('a yearly series from 29 February lands on the 28th, and back on the 29th in a leap year', () => {
    const a = nextDate('yearly', '2028-02-29', 29)
    expect(a).toBe('2029-02-28')
    expect(nextDate('yearly', nextDate('yearly', nextDate('yearly', a, 29), 29), 29)).toBe('2032-02-29')
  })
})

describe('periodKey', () => {
  it.each([
    ['monthly', '2026-10-05', '2026-10'],
    ['monthly', '2026-01-31', '2026-01'],
    ['quarterly', '2026-01-01', '2026-Q1'],
    ['quarterly', '2026-03-31', '2026-Q1'],
    ['quarterly', '2026-04-01', '2026-Q2'],
    ['quarterly', '2026-10-05', '2026-Q4'],
    ['quarterly', '2026-12-31', '2026-Q4'],
    ['yearly', '2027-07-06', '2027'],
  ] as const)('%s %s → %s', (f, date, key) => {
    expect(periodKey(f, date)).toBe(key)
    expect(PERIOD_SHAPE[f].test(key)).toBe(true)
  })

  it('each frequency’s example has its own shape and no other’s', () => {
    for (const f of ['monthly', 'quarterly', 'yearly'] as const) {
      for (const g of ['monthly', 'quarterly', 'yearly'] as const) {
        expect(PERIOD_SHAPE[f].test(PERIOD_EXAMPLE[g]), `${f} vs ${g}`).toBe(f === g)
      }
    }
  })
})

describe('the rule', () => {
  const rule = {
    status: 'active' as const,
    frequency: 'quarterly' as const,
    start_date: '2026-01-31',
    occurrences_total: 3,
    occurrences_done: 1,
    next_date: '2026-04-30',
  }

  it('advances by one step, on the anchor day', () => {
    expect(advance(rule)).toEqual({ status: 'active', occurrences_done: 2, next_date: '2026-07-31' })
  })

  it('completes at the cap, with no next date', () => {
    expect(advance({ ...rule, occurrences_done: 2 })).toEqual({ status: 'completed', occurrences_done: 3, next_date: null })
    expect(isComplete({ occurrences_done: 3, occurrences_total: 3 })).toBe(true)
    expect(isComplete({ occurrences_done: 2, occurrences_total: 3 })).toBe(false)
  })

  it('is due when active and its date has arrived — not before, not when paused', () => {
    expect(isDue(rule, '2026-04-30')).toBe(true)
    expect(isDue(rule, '2026-04-29')).toBe(false)
    expect(isDue({ ...rule, status: 'paused' }, '2026-12-31')).toBe(false)
    expect(isDue({ ...rule, status: 'completed', next_date: null }, '2026-12-31')).toBe(false)
  })
})

describe('isCalendarDate', () => {
  it('refuses the dates a regex accepts', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-4-01')).toBe(false)
  })
})
