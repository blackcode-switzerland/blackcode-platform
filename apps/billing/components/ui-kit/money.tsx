// An amount, exactly as the API gave it.
//
// The server sends money as a decimal STRING (`"3240.00"`) in a named currency.
// This renders that string — it does not parse, round, re-format or add. There
// is no `sum` helper here on purpose: adding CHF to EUR produces a number that
// is not money in any currency (invariant I8), and adding within one currency
// is the server's job (`totals`, `by_currency`).
//
// The one thing it does to the string is DISPLAY-ONLY digit grouping with the
// Swiss apostrophe (`15'209.80`): the digits are untouched, so what a person
// reads is still exactly what the API returned.

import { cn } from '@/lib/utils'

export interface MoneyProps {
  /** The API's decimal string. Null/undefined renders `fallback`. */
  amount: string | null | undefined
  /** ISO code, e.g. `CHF`. Omit to show the bare amount (a column headed by its currency). */
  currency?: string | null
  /** Shown instead of an absent amount. Default `—`. */
  fallback?: React.ReactNode
  /** e.g. `amountClassFor(status)` from lib/ui-vocab to strike a void amount through. */
  className?: string
  testId?: string
}

/** `15209.80` → `15’209.80`. Anything not a plain decimal is returned as given. */
export function groupDigits(amount: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(amount)
  if (!m) return amount
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '’') + (m[3] ?? '')
}

export function Money({ amount, currency, fallback = '—', className, testId }: MoneyProps) {
  if (amount === null || amount === undefined || amount === '') {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>
  }
  return (
    <span data-testid={testId} className={cn('whitespace-nowrap font-mono tabular-nums', className)}>
      {currency && <span className="mr-1 text-[0.85em] text-muted-foreground">{currency}</span>}
      {groupDigits(amount)}
    </span>
  )
}
