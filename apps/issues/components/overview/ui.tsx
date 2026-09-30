'use client'

// Small presentational pieces shared by the Overview sections.

import type { ReactNode } from 'react'

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h2>
}

/** The one card treatment on this page. */
export function Panel({
  title,
  subtitle,
  action,
  count,
  className,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  count?: number
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`rounded-lg border border-border bg-card ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SectionLabel>{title}</SectionLabel>
            {count != null ? (
              <span className="rounded-full bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-foreground">
                {count}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-5 pt-1 text-[13px] text-muted-foreground">{children}</p>
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-secondary/60 ${className ?? ''}`} />
}

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0'
