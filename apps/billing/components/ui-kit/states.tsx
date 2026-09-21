'use client'

// Loading, empty and error — the three states every block has, answered the
// same way everywhere.
//
// An error is SHOWN, never swallowed into the empty state: rendering "no
// invoices" when the API is down is the most reassuring wrong answer this app
// could give. `ErrorState` prints the server's own sentence, its code and its
// suggestion — the line `bk` prints as `hint:`.

import { AlertCircle, RotateCw, type LucideIcon } from 'lucide-react'
import { WebError } from '@/lib/client'
import { cn } from '@/lib/utils'

/**
 * `` `bk billing invoice list` `` → a <code> chip; everything else passes
 * through. One delimiter, unnested — not markdown. An unbalanced backtick
 * renders as itself.
 */
export function ticks(text: string): React.ReactNode {
  const parts = text.split('`')
  if (parts.length === 1 || parts.length % 2 === 0) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
        {part}
      </code>
    ) : (
      part
    )
  )
}

export interface ErrorStateProps {
  /** Anything thrown. A `WebError` shows its message, `(status code)` and suggestion. */
  error: unknown
  /** Shows a Retry button. Pass a query's `refetch`. */
  retry?: () => void
  /** `data-testid`, default `error`. Pages keep their existing ids (`load-error`, `audit-error`). */
  testId?: string
  /** Tighter, for inline use inside a form or a table cell. */
  compact?: boolean
  className?: string
}

export function ErrorState({ error, retry, testId = 'error', compact, className }: ErrorStateProps) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  const web = error instanceof WebError ? error : null
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 text-sm',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        className
      )}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground">
          {message}
          {web && (
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
              ({web.status}
              {web.code ? ` ${web.code}` : ''})
            </span>
          )}
        </p>
        {web?.suggestion && <p className="mt-0.5 text-muted-foreground">{ticks(web.suggestion)}</p>}
      </div>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RotateCw size={12} />
          Retry
        </button>
      )}
    </div>
  )
}

export interface EmptyStateProps {
  title: React.ReactNode
  /** Backticks become <code> chips — name the `bk` command that fills it. */
  hint?: string
  icon?: LucideIcon
  /** A button or link — "New invoice". */
  action?: React.ReactNode
  testId?: string
  className?: string
}

export function EmptyState({ title, hint, icon: Icon, action, testId, className }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn('rounded-xl border border-dashed border-border px-4 py-10 text-center', className)}
    >
      {Icon && (
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon size={18} />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{ticks(hint)}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export interface LoadingStateProps {
  /** `rows` (a list), `tiles` (a stat strip), `detail` (a record page). Default `rows`. */
  variant?: 'rows' | 'tiles' | 'detail'
  /** How many rows/tiles. */
  count?: number
  className?: string
}

export function LoadingState({ variant = 'rows', count, className }: LoadingStateProps) {
  if (variant === 'tiles') {
    return (
      <div aria-busy="true" className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>
        {Array.from({ length: count ?? 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }
  if (variant === 'detail') {
    return (
      <div aria-busy="true" className={cn('space-y-4', className)}>
        <div className="h-8 w-1/3 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-40 animate-pulse rounded-xl bg-muted md:col-span-2" />
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        </div>
        <div className="h-56 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }
  return (
    <div aria-busy="true" className={cn('space-y-2', className)}>
      {Array.from({ length: count ?? 5 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}
