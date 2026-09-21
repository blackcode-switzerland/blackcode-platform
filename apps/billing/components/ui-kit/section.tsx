// A titled card — the block every detail page and the overview are built from.

import { cn } from '@/lib/utils'

export interface SectionProps {
  title?: React.ReactNode
  /** One line under the title. */
  description?: React.ReactNode
  /** Right of the title — a button, a link, a count. */
  actions?: React.ReactNode
  children: React.ReactNode
  /** false for edge-to-edge content (a DataTable): no body padding. Default true. */
  padded?: boolean
  testId?: string
  className?: string
  bodyClassName?: string
}

export function Section({
  title,
  description,
  actions,
  children,
  padded = true,
  testId,
  className,
  bodyClassName,
}: SectionProps) {
  return (
    <section
      data-testid={testId}
      className={cn('overflow-hidden rounded-xl border border-border bg-card text-card-foreground', className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(padded && 'px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * Label/value rows inside a Section — an invoice's fields, a series' state.
 * Stacks on a phone, two columns from `sm`.
 */
export function FieldList({
  items,
  className,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; testId?: string; hidden?: boolean }>
  className?: string
}) {
  return (
    <dl className={cn('divide-y divide-border', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i, n) => (
          <div key={n} className="grid gap-0.5 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-xs text-muted-foreground sm:pt-0.5">{i.label}</dt>
            <dd className="min-w-0 break-words text-sm" data-testid={i.testId}>
              {i.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}
