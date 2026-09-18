// A series' calendar: which period a date bills, and when the next one falls.
//
// Pure, and date arithmetic on `YYYY-MM-DD` STRINGS — never a `Date`, whose
// time zone would move a date across midnight and so across a period
// (lib/derive/format.ts explains the same rule for display).
//
// ===========================================================================
// THE ONE TRAP: THE 31ST
// ===========================================================================
// A monthly series that starts on 31 January falls on 28 (or 29) February, and
// then on 31 March — NOT on 28 March and every 28th after that. So `nextDate`
// takes the series' ANCHOR day (the start date's day of the month) and clamps it
// to each month's length, rather than stepping from the previous, already
// clamped, date. `recurrence.test.ts` walks January 31 through to April.
//
// ===========================================================================
// THE NEXT DATE IS COMPUTED FROM THE STORED ONE, NOT FROM A COUNT
// ===========================================================================
// `start + done × step` would be simpler and would contradict real data: the
// mockup's Junod series has two occurrences done and its next date in Q4, a
// quarter after that formula says. A rule's `next_date` is a fact the rule
// carries; generating advances it by one step.

import type { RecurrenceFrequency, RecurrenceStatus } from '@/types'

const MONTHS_PER_STEP: Readonly<Record<RecurrenceFrequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 }

/** Split and check a `YYYY-MM-DD`. Throws on anything else: a malformed date here is a bug, not input. */
function parts(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${JSON.stringify(date)}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Is this a real calendar date? `2026-02-30` is not. */
export function isCalendarDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

/** The day of the month a series is anchored to: its start date's. */
export const anchorDay = (startDate: string): number => parts(startDate).d

/**
 * One step after `from`, on the series' anchor day where the month has it and
 * on the month's last day where it does not.
 */
export function nextDate(frequency: RecurrenceFrequency, from: string, anchor: number = anchorDay(from)): string {
  const { y, m } = parts(from)
  const total = y * 12 + (m - 1) + MONTHS_PER_STEP[frequency]
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(anchor, daysInMonth(ny, nm)))}`
}

/** The period a date bills: `2026-10`, `2026-Q4` or `2026`. */
export function periodKey(frequency: RecurrenceFrequency, date: string): string {
  const { y, m } = parts(date)
  switch (frequency) {
    case 'monthly':
      return `${y}-${pad(m)}`
    case 'quarterly':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    case 'yearly':
      return String(y)
  }
}

/** The shape a period takes for a frequency, for refusing a typo before it reaches a comparison. */
export const PERIOD_SHAPE: Readonly<Record<RecurrenceFrequency, RegExp>> = {
  monthly: /^\d{4}-(0[1-9]|1[0-2])$/,
  quarterly: /^\d{4}-Q[1-4]$/,
  yearly: /^\d{4}$/,
}

export const PERIOD_EXAMPLE: Readonly<Record<RecurrenceFrequency, string>> = {
  monthly: '2026-10',
  quarterly: '2026-Q4',
  yearly: '2026',
}

export interface RuleState {
  status: RecurrenceStatus
  occurrences_done: number
  occurrences_total: number
  next_date: string | null
}

/** I9: the counter has reached the cap. `completed` is derived from this, never set by hand. */
export const isComplete = (rule: Pick<RuleState, 'occurrences_done' | 'occurrences_total'>): boolean =>
  rule.occurrences_done >= rule.occurrences_total

/** Active, and its next date has arrived. `today` is a `YYYY-MM-DD` in Zurich. */
export const isDue = (rule: RuleState, today: string): boolean =>
  rule.status === 'active' && rule.next_date !== null && rule.next_date <= today

/**
 * The rule after one more occurrence: the counter up by one, and either the
 * next date one step on, or — at the cap — `completed` with no next date.
 */
export function advance(
  rule: RuleState & { frequency: RecurrenceFrequency; start_date: string }
): Pick<RuleState, 'status' | 'occurrences_done' | 'next_date'> {
  const done = rule.occurrences_done + 1
  if (done >= rule.occurrences_total) return { status: 'completed', occurrences_done: done, next_date: null }
  if (rule.next_date === null) throw new Error('an unfinished series has a next date (recurrence_completed_by_the_cap)')
  return { status: rule.status, occurrences_done: done, next_date: nextDate(rule.frequency, rule.next_date, anchorDay(rule.start_date)) }
}
