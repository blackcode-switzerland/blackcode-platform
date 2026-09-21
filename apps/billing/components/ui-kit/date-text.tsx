// A date for a person to read, with the machine value in the tooltip.
//
// Date-only strings (`2026-09-21`) are calendar dates, not instants: they are
// formatted in UTC so no timezone can move them a day. Timestamps are shown in
// Europe/Zurich, the timezone the server reasons in ("due" is Zurich's today).
// Both use a fixed locale and zone, so server and client render the same text.

import { cn } from '@/lib/utils'

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DATETIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Zurich',
})

/** `2026-09-21` → `21 Sep 2026`; a timestamp → date (+ time with `withTime`). Unparseable → as given. */
export function formatDate(value: string, withTime = false): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return DATE.format(new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])))
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  if (withTime) return DATETIME.format(d)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' }).format(d)
}

export interface DateTextProps {
  /** `YYYY-MM-DD` or an ISO timestamp. */
  value: string | null | undefined
  /** Show the time too (timestamps only). */
  withTime?: boolean
  /** Shown when there is no date. Default `—`. */
  fallback?: React.ReactNode
  className?: string
  testId?: string
}

export function DateText({ value, withTime, fallback = '—', className, testId }: DateTextProps) {
  if (!value) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>
  return (
    <time dateTime={value} title={value} data-testid={testId} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatDate(value, withTime)}
    </time>
  )
}
