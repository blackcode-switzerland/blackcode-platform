'use client'

// The filter row above a listing: a set of small controls that wrap on a phone.

import { cn } from '@/lib/utils'

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>
}

/** Pushes what follows to the right edge (on one line; wraps naturally on a phone). */
export function ToolbarSpacer() {
  return <div className="flex-1" />
}

export interface SegmentOption<V extends string> {
  value: V
  label: React.ReactNode
  testId?: string
}

/**
 * A segmented control — status filters ("All / Draft / Sent / …"), the due
 * toggle. `value: ''` is the conventional "all".
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentOption<V>[]
  value: V
  onChange: (v: V) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] transition-colors',
              active ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
