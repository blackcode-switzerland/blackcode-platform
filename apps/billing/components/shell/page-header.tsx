'use client'

// The top of every workspace page: a sticky h-12 bar with the page's title,
// an optional way back, the company switcher when the page is company-scoped,
// and the page's actions.
//
// Below `lg` it also carries the hamburger that opens the shell's drawer, and
// registers itself with the shell so the shell drops its fallback mobile bar
// (billing-shell.tsx says why the shell has no header of its own).
//
// Actions wrap onto a second row on a phone rather than overflowing: the bar
// grows past h-12 there instead of hiding a button.

import { useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MenuButton, useShell } from './billing-shell'
import { CompanySwitcher } from './company-switcher'

export interface Crumb {
  label: React.ReactNode
  href?: string
}

export interface PageHeaderProps {
  /** The page's name, or the record's (an invoice number). */
  title: React.ReactNode
  /** Small text after the title — a status badge, a count. */
  meta?: React.ReactNode
  /** Crumbs BEFORE the title, e.g. `[{ label: 'Invoices', href }]`. The last crumb doubles as the mobile "back". */
  breadcrumb?: Crumb[]
  /** A plain back link, when a breadcrumb is more than the page needs. */
  back?: { href: string; label?: string }
  /** Render the company switcher (`?company=`) — for company-scoped pages. */
  companySwitcher?: boolean
  /** Buttons at the right. */
  actions?: React.ReactNode
  /** `data-testid` on the title element. */
  titleTestId?: string
  className?: string
}

export function PageHeader({
  title,
  meta,
  breadcrumb,
  back,
  companySwitcher,
  actions,
  titleTestId,
  className,
}: PageHeaderProps) {
  const shell = useShell()
  useEffect(() => shell?.registerHeader(), [shell])

  const backHref = back?.href ?? [...(breadcrumb ?? [])].reverse().find((c) => c.href)?.href

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur sm:px-6 lg:px-8',
        className
      )}
    >
      {shell && <MenuButton onClick={shell.openMenu} />}

      {/* min-w keeps the title legible on a phone: the actions wrap under it
          instead of squeezing it to one letter. */}
      <div className="flex min-w-[45%] flex-1 items-center gap-2 sm:min-w-0">
        {backHref && (
          <Link
            href={backHref}
            aria-label={back?.label ?? 'Back'}
            data-testid="page-back"
            className="-ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
          >
            <ChevronLeft size={16} />
          </Link>
        )}
        {back && !breadcrumb && (
          <Link
            href={back.href}
            className="hidden items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            <ChevronLeft size={14} />
            {back.label ?? 'Back'}
          </Link>
        )}
        {breadcrumb?.map((c, i) => (
          <span key={i} className="hidden min-w-0 items-center gap-2 text-[13px] text-muted-foreground sm:flex">
            {c.href ? (
              <Link href={c.href} className="truncate transition-colors hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="truncate">{c.label}</span>
            )}
            <ChevronRight size={13} className="shrink-0 opacity-60" />
          </span>
        ))}
        <h1 className="truncate text-sm font-medium text-foreground" data-testid={titleTestId}>
          {title}
        </h1>
        {meta && <div className="flex shrink-0 items-center gap-2">{meta}</div>}
      </div>

      {(companySwitcher || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {companySwitcher && <CompanySwitcher />}
          {actions}
        </div>
      )}
    </header>
  )
}

/**
 * The content column under a PageHeader: consistent gutters and max width.
 * `wide` for listings that want the full row.
 */
export function PageBody({
  children,
  wide,
  className,
}: {
  children: React.ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8', wide ? 'max-w-none' : 'max-w-6xl', className)}>
      {children}
    </div>
  )
}
