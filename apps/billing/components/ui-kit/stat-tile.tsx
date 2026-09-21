// A figure a person opened the page to see — outstanding, overdue, paid.
//
// `value` is a ReactNode, in practice a `<Money>`, and deliberately not a
// number: a number here invites `Number(amount)` at the call site, and a float
// cannot hold a decimal string. One tile per currency — never a sum across
// currencies (invariant I8).

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { TONE_TEXT, type Tone } from '@/lib/ui-vocab'
import { cn } from '@/lib/utils'

export interface StatTileProps {
  label: React.ReactNode
  value: React.ReactNode
  /** A second line — a count, "3 invoices", the currency. */
  hint?: React.ReactNode
  /** Colours the value (e.g. `warning` for overdue). Default neutral foreground. */
  tone?: Tone
  /** Makes the whole tile a link. */
  href?: string
  icon?: LucideIcon
  testId?: string
  className?: string
}

export function StatTile({ label, value, hint, tone, href, icon: Icon, testId, className }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon size={15} className="text-muted-foreground" />}
      </div>
      <div className={cn('mt-2 text-xl font-semibold tracking-tight', tone && tone !== 'neutral' ? TONE_TEXT[tone] : 'text-foreground')}>
        {value}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  )
  const cls = cn('block rounded-xl border border-border bg-card p-4 text-card-foreground', className)
  if (href) {
    return (
      <Link href={href} data-testid={testId} className={cn(cls, 'transition-colors hover:border-primary/40 hover:bg-accent/40')}>
        {body}
      </Link>
    )
  }
  return (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  )
}

/** Auto-fitting row of tiles — no empty cell when the count varies (one per currency). */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3', className)}>{children}</div>
}
