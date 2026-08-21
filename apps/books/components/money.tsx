// `<Money>` — the only way an amount reaches the screen.
//
// ===========================================================================
// IT TAKES A STRING, AND THE PROP TYPE IS THE GUARD
// ===========================================================================
// An amount is `numeric(14,2)` in Postgres and `"1234.50"` on the wire. Typing
// this prop as `number` would make every call site parse, and a float cannot
// hold every `numeric(14,2)` — `0.1 + 0.2` is the canonical demonstration and a
// balance sheet balances to the rappen. So `value` is `string | null` and there
// is no numeric overload, deliberately: the compiler is what stops somebody
// passing `Number(x)`.
//
// `lib/format.ts` does the rendering — ASCII apostrophe grouping, two decimals,
// both deliberate and both load-bearing for the phase-1 acceptance test, which
// compares this app's output string for string against the mockup. Do not "fix"
// either. Read that file's header before touching anything here.
//
// ── NEGATIVES ARE TINTED, NOT BADGED ───────────────────────────────────────
// A minus sign is one narrow glyph and it is missed. The colour is what makes a
// negative legible in a column. It is deliberately NOT a filled red badge: a
// negative in a bookkeeping system is an ordinary fact — a credit balance, a
// loss, a reversal — and dressing one as an error is how a reader stops
// believing the ones that are.
//
// ── WHAT `null` RENDERS ────────────────────────────────────────────────────
// An em dash, from `money()`. "There is no amount" and "the amount is zero" are
// different facts and a zero shown for an absent value is a lie the reader
// cannot detect. A zero LINE on a statement is a different thing again and is
// always rendered — see `<StatementTable>`.

import { money } from '@/lib/format'
import { amount } from '@/lib/format'

export function Money({
  value,
  currency = 'CHF',
  /** Drop the `CHF` when a column header or tile label already carries it. */
  bare = false,
  className = '',
}: {
  value: string | null | undefined
  currency?: string
  bare?: boolean
  className?: string
}) {
  const n = amount(value)
  const negative = n !== null && n < 0
  const text = bare && n !== null ? money(value, '').trim() : money(value, currency)

  return (
    <span
      className={
        // `figure` is mono + tabular and sets NO size — the `.num` cell this
        // often sits inside owns that, and setting both compounds. Added
        // 2026-08-21 with the Plex Mono pairing; `tabular-nums` alone was doing
        // half the job, aligning the digits of a face that still read as prose.
        'figure ' + (negative ? 'text-destructive ' : '') + className
      }
      // The machine-readable original, unformatted and unrounded. An agent
      // reading the DOM — and the phase-1 parity check — gets the wire value
      // rather than the presentation of it.
      data-amount={value ?? undefined}
    >
      {text}
    </span>
  )
}
