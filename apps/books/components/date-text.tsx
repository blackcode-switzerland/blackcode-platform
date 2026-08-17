// `<DateText>` — an ISO date in, `05.01.2026` out.
//
// ===========================================================================
// THERE IS NO `Date` IN THIS FILE, AND THAT IS THE WHOLE POINT
// ===========================================================================
// A booking date is a Postgres `date`: a day, with no time and no timezone. It
// crosses the wire as `"2026-01-05"`. `new Date("2026-01-05")` parses that as
// midnight **UTC**, and `toLocaleDateString()` then renders it in the reader's
// zone — so anybody west of Greenwich sees `04.01.2026`.
//
// That is not a cosmetic bug in an accounting system. A booking on 01.01 read as
// 31.12 is an entry in the wrong EXERCICE, which is the wrong balance sheet, the
// wrong tax year, and a difference a fiduciary has to explain.
//
// `lib/format.ts`'s `date()` slices the string instead. No parsing, no zone, no
// ICU. It cannot be wrong by a day because it never computes a day.
//
// If you ever genuinely need date arithmetic — "how many days stale is this
// source?" — do it on the SERVER, in SQL, over `date`, where the type has the
// same meaning it does in the law.

import { date as formatDate } from '@/lib/format'

export function DateText({
  value,
  className = '',
}: {
  /** The wire form, `"2026-01-05"`. Null renders an em dash. */
  value: string | null | undefined
  className?: string
}) {
  return (
    // `<time>` with the ISO value in `dateTime`: the machine gets the wire form,
    // the reader gets the Swiss one, and neither is a re-parse of the other.
    <time dateTime={value ?? undefined} className={'tabular-nums ' + className}>
      {formatDate(value)}
    </time>
  )
}
