'use client'

// The workspace overview — `GET …/overview`. Replaces the minimal test UI
// (components/min) with the real screen: per-currency figures (never summed,
// invariant I8), what needs a human, what happened recently, and a good empty
// state for a fresh workspace (docs/frontend.md).

import Link from 'next/link'
import { FilePlus2, FileStack, History as HistoryIcon } from 'lucide-react'
import { PageHeader, PageBody, useCompanyParam } from '@/components/shell'
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Section,
  StatTile,
  StatusBadge,
  DateText,
  type Column,
} from '@/components/ui-kit'
import { useCompanies, useOverview } from '@/lib/queries'
import { amountClassFor, TONE_TEXT } from '@/lib/ui-vocab'
import { cn } from '@/lib/utils'
import type { AuditEntry, CurrencyTotal, Invoice } from '@/types'

export function OverviewPage({ ws }: { ws: string }) {
  const company = useCompanyParam()
  const overview = useOverview(ws, company)
  // Only to pick the empty state's CTA — not rendered as data of its own.
  const companies = useCompanies(ws)

  const data = overview.data
  const isEmpty = !!data && data.by_currency.length === 0 && data.needs_action.length === 0 && data.recent_invoices.length === 0

  return (
    <>
      <PageHeader title="Overview" companySwitcher titleTestId="page-title" />
      <PageBody className="space-y-6">
        {overview.isPending && <LoadingState variant="tiles" />}
        <ErrorState error={overview.error} retry={overview.refetch} testId="load-error" />

        {data && isEmpty && (
          <EmptyState
            testId="overview-empty"
            icon={FileStack}
            title="No invoices yet"
            hint={
              (companies.data?.length ?? 0) === 0
                ? 'Add the company that will issue invoices, then create the first one.'
                : 'Create the first invoice for this workspace.'
            }
            action={
              (companies.data?.length ?? 0) === 0 ? (
                <Link
                  href={`/dashboard/${ws}/companies`}
                  data-testid="overview-add-company"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FilePlus2 size={14} />
                  Add a company
                </Link>
              ) : (
                <Link
                  href={`/dashboard/${ws}/invoices`}
                  data-testid="overview-new-invoice"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FilePlus2 size={14} />
                  New invoice
                </Link>
              )
            }
          />
        )}

        {data && !isEmpty && (
          <>
            <div data-testid="overview-currencies" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <CurrencyTile
                label="Outstanding"
                testId="overview-outstanding"
                currencies={data.by_currency}
                field="outstanding"
                lineTestId={(c) => `overview-${c.currency}`}
                toneFor={(c) => (Number(c.overdue) > 0 ? 'warning' : undefined)}
                hintFor={(c) => `${c.count} invoice${c.count === 1 ? '' : 's'} sent`}
              />
              <CurrencyTile
                label="Overdue"
                testId="overview-overdue"
                currencies={data.by_currency}
                field="overdue"
                lineTestId={(c) => `overview-${c.currency}-overdue`}
                toneFor={(c) => (Number(c.overdue) > 0 ? 'warning' : undefined)}
              />
              <StatTile
                label="Drafts"
                value={String(data.needs_action.filter((i) => i.status === 'draft').length)}
                hint="Never sent"
                testId="overview-drafts"
              />
              <CurrencyTile
                label="Paid"
                testId="overview-paid"
                currencies={data.by_currency}
                field="paid"
                lineTestId={(c) => `overview-${c.currency}-paid`}
                toneFor={() => 'success'}
              />
            </div>

            <Section title="To handle" description="Overdue first, then drafts never sent." padded={false} testId="overview-to-handle">
              <DataTable<Invoice>
                testId="needs-action"
                columns={invoiceColumns()}
                rows={data.needs_action}
                rowKey={(i) => i.seq}
                rowHref={(i) => `/dashboard/${ws}/invoices/${i.number}`}
                rowTestId={(i) => `invoice-row-${i.number}`}
                empty={<EmptyState testId="needs-action-empty" title="Nothing needs attention" hint="Overdue and unsent invoices land here." />}
              />
            </Section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Recent invoices" padded={false} testId="overview-recent-invoices">
                {data.recent_invoices.length === 0 ? (
                  <EmptyState testId="recent-invoices-empty" title="No invoices yet" />
                ) : (
                  <ul data-testid="recent-invoices" className="divide-y divide-border">
                    {data.recent_invoices.map((i) => (
                      <li key={i.seq} data-testid={`recent-invoice-${i.number}`}>
                        <Link
                          href={`/dashboard/${ws}/invoices/${i.number}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50 sm:px-5"
                        >
                          <StatusBadge kind="invoice" status={i.status} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-sm">{i.number}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {i.client.name} · <DateText value={i.issue_date} />
                            </div>
                          </div>
                          <Money amount={i.totals.total} currency={i.currency} className={cn('shrink-0', amountClassFor(i.status))} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Recent changes" padded={false} testId="overview-recent-audit">
                {data.recent_audit.length === 0 ? (
                  <EmptyState testId="recent-audit-empty" title="Nothing has happened here yet" icon={HistoryIcon} className="border-0" />
                ) : (
                  <ul data-testid="recent-audit-list" className="divide-y divide-border">
                    {data.recent_audit.map((a) => {
                      const href = subjectHref(ws, a)
                      const who = actorLabel(a)
                      return (
                        <li key={a.seq} data-testid={`audit-row-${a.seq}`} className="px-4 py-2.5 text-sm sm:px-5">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <DateText value={a.ts} withTime />
                            <span>·</span>
                            <span className="truncate">{who}</span>
                          </div>
                          <div className="mt-0.5">
                            {href ? (
                              <Link href={href} className="font-medium hover:underline">
                                {a.subject_type} #{a.subject_seq}
                              </Link>
                            ) : (
                              <span className="font-medium">
                                {a.subject_type} #{a.subject_seq}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{auditLine(a)}</p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}

function invoiceColumns(): Column<Invoice>[] {
  return [
    {
      key: 'number',
      header: 'Number',
      cell: (i) => i.number,
      mobile: 'title',
    },
    {
      key: 'client',
      header: 'Client',
      cell: (i) => i.client.name,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => <StatusBadge kind="invoice" status={i.status} />,
      mobile: 'subtitle',
    },
    {
      key: 'due',
      header: 'Due',
      cell: (i) => <DateText value={i.due_date} />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (i) => <Money amount={i.totals.total} currency={i.currency} className={amountClassFor(i.status)} />,
      mobile: 'subtitle',
    },
  ]
}

/** Who did it, for the row's own line — kept apart from the summary so it isn't said twice. */
function actorLabel(a: AuditEntry): string {
  return a.actor.email ?? (a.actor.via === 'token' ? 'an agent token' : 'someone')
}

/** A best-effort sentence from an audit row when the server sent no rendered text. */
function auditLine(a: AuditEntry): string {
  if (a.detail_en) return a.detail_en
  if (a.field) return `changed ${a.field}${a.to_value ? ` to ${a.to_value}` : ''}`
  return a.action.replace(/_/g, ' ')
}

/** Where the row's subject links to — only the record types this app has a page for. */
function subjectHref(ws: string, a: AuditEntry): string | null {
  if (a.subject_type === 'invoice') return `/dashboard/${ws}/invoices/${a.subject_seq}`
  if (a.subject_type === 'recurrence') return `/dashboard/${ws}/recurrences/${a.subject_seq}`
  return null
}

/**
 * One tile, one figure per currency — never a sum across them (invariant I8).
 * Each line carries its own `data-testid` so a currency's own figure stays
 * addressable even inside a shared tile.
 */
function CurrencyTile({
  label,
  testId,
  currencies,
  field,
  lineTestId,
  toneFor,
  hintFor,
}: {
  label: string
  testId?: string
  currencies: CurrencyTotal[]
  field: 'outstanding' | 'overdue' | 'paid'
  lineTestId: (c: CurrencyTotal) => string
  toneFor?: (c: CurrencyTotal) => 'warning' | 'success' | undefined
  hintFor?: (c: CurrencyTotal) => string
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {currencies.length === 0 ? (
        <div className="mt-2 text-xl font-semibold tracking-tight text-muted-foreground">
          <Money amount={null} />
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {currencies.map((c) => {
            const tone = toneFor?.(c)
            return (
              <div key={c.currency} data-testid={lineTestId(c)} className="flex items-baseline justify-between gap-2">
                <Money
                  amount={c[field]}
                  currency={c.currency}
                  className={cn('text-base font-semibold tracking-tight', tone && TONE_TEXT[tone])}
                />
                {hintFor && <span className="shrink-0 text-[11px] text-muted-foreground">{hintFor(c)}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
