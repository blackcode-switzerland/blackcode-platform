// The calendar arithmetic behind the overview leaderboard's period columns. No
// database, no imports — so it is unit-testable and safe to load on the client.
// All boundaries are UTC and a week starts on Monday.

export const DAY_MS = 24 * 60 * 60 * 1000

export const OVERVIEW_PERIOD_KEYS = [
  'range',
  'this_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'all_time',
] as const
export type OverviewPeriodKey = (typeof OVERVIEW_PERIOD_KEYS)[number]

export interface Bounds {
  from: Date | null
  to: Date | null
}

export const PERIOD_LABELS: Record<Exclude<OverviewPeriodKey, 'range'>, string> = {
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
  last_year: 'Last year',
  all_time: 'All time',
}

/** Monday 00:00 UTC of the week containing `d`. */
export function startOfUtcWeek(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
}

/** Inclusive [from, to] bounds of every leaderboard period. Pure — unit tested. */
export function periodBounds(now: Date, range: Bounds): Record<OverviewPeriodKey, Bounds> {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const ms = (t: number) => new Date(t - 1) // inclusive end = next start - 1ms
  return {
    range,
    this_week: { from: startOfUtcWeek(now), to: now },
    this_month: { from: new Date(Date.UTC(y, m, 1)), to: now },
    last_month: { from: new Date(Date.UTC(y, m - 1, 1)), to: ms(Date.UTC(y, m, 1)) },
    this_year: { from: new Date(Date.UTC(y, 0, 1)), to: now },
    last_year: { from: new Date(Date.UTC(y - 1, 0, 1)), to: ms(Date.UTC(y, 0, 1)) },
    all_time: { from: null, to: null },
  }
}

export function rangeLabel(from: Date | null, to: Date): string {
  if (!from) return 'All time'
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS)
  return `Last ${days} days`
}

