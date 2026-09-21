'use client'

// Invoices — list, filter, create. Replaces the minimal test UI's
// `app/dashboard/[ws]/invoices/page.tsx`: same filters (status, company) plus
// currency and external_ref (the route already supports them), same create
// flow, same testids where the element is still the same kind of control.
//
// The company filter moved into the shared header switcher (`?company=`,
// `PageHeader companySwitcher`) — every company-scoped page uses the same
// control now, so there is no second, page-local company `<select>` (the old
// `filter-company` testid). `CompanySwitcher` carries `data-testid="company-switcher"`.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, Plus, Receipt } from 'lucide-react'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { PageHeader, PageBody, useCompanyParam } from '@/components/shell'
import { DataTable, EmptyState, ErrorState, LoadingState, Money, DateText, StatusBadge, Select, Toolbar } from '@/components/ui-kit'
import { useCompanies, useInvoices } from '@/lib/queries'
import { INVOICE_STATUS_OPTIONS, amountClassFor } from '@/lib/ui-vocab'
import type { Invoice } from '@/types'
import { CreateInvoiceDialog } from './create-invoice-dialog'

export function InvoiceListPage({ ws }: { ws: string }) {
  const company = useCompanyParam()
  const [status, setStatus] = useState('')
  const [currency, setCurrency] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [cursor, setCursor] = useState<string | number | null>(null)
  const [rows, setRows] = useState<Invoice[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  // An invoice needs an issuing company. With none, "New invoice" would open a
  // form with nothing to pick — send the person to create the company instead.
  const companies = useCompanies(ws)
  const noCompany = companies.data !== undefined && companies.data.length === 0

  // A cursor belongs to the previous filter set — starting over resets it.
  useEffect(() => setCursor(null), [status, currency, externalRef, company])

  const q = useInvoices(ws, {
    company,
    status: status || undefined,
    currency: currency || undefined,
    external_ref: externalRef || undefined,
    limit: 50,
    cursor,
  })

  useEffect(() => {
    if (!q.data) return
    setRows((prev) => (cursor === null ? q.data.data : [...prev, ...q.data.data]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])

  return (
    <>
      <PageHeader
        title="Invoices"
        titleTestId="page-title"
        companySwitcher
        actions={
          <Button size="sm" data-testid="invoice-create-open" onClick={() => setCreateOpen(true)} disabled={noCompany}>
            <Plus size={14} />
            New invoice
          </Button>
        }
      />
      <PageBody wide>
        <Toolbar>
          <Select data-testid="filter-status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
            <option value="">All statuses</option>
            {INVOICE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input
            data-testid="filter-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="Currency"
            className="h-8 w-28"
          />
          <Input
            data-testid="filter-external_ref"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="External ref…"
            className="h-8 w-44"
          />
        </Toolbar>

        {q.isPending ? (
          <LoadingState variant="rows" count={6} />
        ) : q.error ? (
          <ErrorState error={q.error} retry={q.refetch} testId="load-error" />
        ) : (
          <>
            <DataTable<Invoice>
              testId="invoices"
              rows={rows}
              rowKey={(i) => i.seq}
              rowHref={(i) => `/dashboard/${ws}/invoices/${i.seq}`}
              rowTestId={(i) => `invoice-row-${i.number}`}
              rowMuted={(i) => i.status === 'void'}
              empty={
                noCompany ? (
                  <EmptyState
                    testId="invoices-empty"
                    title="Add a company first"
                    hint="Every invoice is issued by one of your companies — its name, address and bank account go on the bill."
                    icon={Building2}
                    action={
                      <Button size="sm" asChild>
                        <Link href={`/dashboard/${ws}/companies`}>
                          <Plus size={14} />
                          Add a company
                        </Link>
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    testId="invoices-empty"
                    title="No invoices yet"
                    hint="Create the first one — it starts as a draft you can edit until it is sent."
                    icon={Receipt}
                    action={
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus size={14} />
                        New invoice
                      </Button>
                    }
                  />
                )
              }
              columns={[
                {
                  key: 'number',
                  header: 'Number',
                  mobile: 'title',
                  cell: (i) => (
                    <span data-testid={`invoice-link-${i.number}`} className="font-mono tabular-nums">
                      {i.number}
                    </span>
                  ),
                },
                { key: 'company', header: 'Company', cell: (i) => i.company, className: 'text-muted-foreground' },
                { key: 'client', header: 'Client', cell: (i) => i.client.name },
                { key: 'issued', header: 'Issued', cell: (i) => <DateText value={i.issue_date} /> },
                {
                  key: 'status',
                  header: 'Status',
                  mobile: 'subtitle',
                  cell: (i) => <StatusBadge kind="invoice" status={i.status} testId={`invoice-status-${i.number}`} />,
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  mobile: 'subtitle',
                  cell: (i) => <Money amount={i.totals.total} currency={i.currency} className={amountClassFor(i.status)} />,
                },
                {
                  key: 'series',
                  header: 'Series',
                  cell: (i) =>
                    i.recurrence ? (
                      <span className="text-xs text-muted-foreground">
                        ↻ #{i.recurrence} {i.occurrence_period ?? 'template'}
                      </span>
                    ) : null,
                  className: 'hidden lg:table-cell',
                },
              ]}
            />
            {q.data?.next_cursor != null && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setCursor(q.data!.next_cursor)} disabled={q.isFetching}>
                  {q.isFetching ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </PageBody>

      <CreateInvoiceDialog ws={ws} open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
