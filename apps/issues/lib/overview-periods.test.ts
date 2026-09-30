import { describe, expect, it } from 'vitest'
import { OVERVIEW_PERIOD_KEYS, periodBounds, startOfUtcWeek } from './overview-periods'

// Wednesday 2026-09-30 12:00 UTC.
const NOW = new Date('2026-09-30T12:00:00Z')
const iso = (d: Date | null) => d?.toISOString() ?? null

describe('overview periods', () => {
  it('starts the week on Monday, in UTC', () => {
    expect(iso(startOfUtcWeek(NOW))).toBe('2026-09-28T00:00:00.000Z')
    // A Sunday belongs to the week that STARTED six days earlier…
    expect(iso(startOfUtcWeek(new Date('2026-10-04T23:59:59Z')))).toBe('2026-09-28T00:00:00.000Z')
    // …and a Monday 00:00 starts its own.
    expect(iso(startOfUtcWeek(new Date('2026-10-05T00:00:00Z')))).toBe('2026-10-05T00:00:00.000Z')
  })

  it('gives every calendar period exact inclusive bounds', () => {
    const b = periodBounds(NOW, { from: new Date('2026-08-31T12:00:00Z'), to: NOW })
    const got = Object.fromEntries(OVERVIEW_PERIOD_KEYS.map((k) => [k, [iso(b[k].from), iso(b[k].to)]]))
    expect(got).toEqual({
      range: ['2026-08-31T12:00:00.000Z', '2026-09-30T12:00:00.000Z'],
      this_week: ['2026-09-28T00:00:00.000Z', '2026-09-30T12:00:00.000Z'],
      this_month: ['2026-09-01T00:00:00.000Z', '2026-09-30T12:00:00.000Z'],
      last_month: ['2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z'],
      this_year: ['2026-01-01T00:00:00.000Z', '2026-09-30T12:00:00.000Z'],
      last_year: ['2025-01-01T00:00:00.000Z', '2025-12-31T23:59:59.999Z'],
      all_time: [null, null],
    })
  })

  it('rolls "last month" across a year boundary', () => {
    const b = periodBounds(new Date('2026-01-15T00:00:00Z'), { from: null, to: null })
    expect(iso(b.last_month.from)).toBe('2025-12-01T00:00:00.000Z')
    expect(iso(b.last_month.to)).toBe('2025-12-31T23:59:59.999Z')
  })

  it('never lets last_month overlap this_month', () => {
    const b = periodBounds(NOW, { from: null, to: null })
    expect(b.last_month.to!.getTime()).toBeLessThan(b.this_month.from!.getTime())
  })
})
