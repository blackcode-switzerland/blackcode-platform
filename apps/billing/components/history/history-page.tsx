'use client'

// The imported archive — bills from before this app existed (phase 5).
// `GET …/history` to list, `POST …/history` to import (all-or-nothing, paste
// JSON). Read-only otherwise: no PATCH, no DELETE (docs/frontend.md,
// app/api/workspaces/[ws]/history/[seq]/route.ts).

import { useMemo, useState } from 'react'
import { Archive, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, PageBody, useCompanyParam } from '@/components/shell'
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Section,
  Select,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
  type Column,
} from '@/components/ui-kit'
import { useHistory } from '@/lib/queries'
import { useImportHistory, toastError } from '@/lib/mutations'
import { HISTORY_SOURCE_OPTIONS, historySourceLabel } from '@/lib/ui-vocab'
import type { HistoryEntry, ImportHistoryRow } from '@/types'
import { ImportHistoryModal } from './import-history-modal'

const YEAR_OPTIONS = Array.from({ length: new Date().getFullYear() - 2015 + 1 }, (_, i) => String(new Date().getFullYear() - i))

export function HistoryPage({ ws }: { ws: string }) {
  const company = useCompanyParam()
  const [source, setSource] = useState('')
  const [year, setYear] = useState('')
  const [currency, setCurrency] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const filters = useMemo(
    () => ({
      company,
      source: source || undefined,
      currency: currency || undefined,
      year: year || undefined,
      flagged: flagged || undefined,
      limit: 200,
    }),
    [company, source, currency, year, flagged]
  )
  const rows = useHistory(ws, filters)
  const importHistory = useImportHistory(ws)

  const doImport = async (parsed: unknown) => {
    try {
      // Pasted JSON, unchecked here on purpose — the server is the validator
      // and refuses an unknown key or a wrong type with the row it is on.
      const r = await importHistory.mutateAsync({ rows: parsed as ImportHistoryRow[] })
      toast.success(`Imported ${r.imported}${r.flagged ? `, ${r.flagged} flagged` : ''}${r.without_pdf ? `, ${r.without_pdf} without a PDF` : ''}`)
      setImportOpen(false)
    } catch (e) {
      toastError(e, 'Could not import')
      throw e
    }
  }

  return (
    <>
      <PageHeader
        title="Imported history"
        meta={<span className="text-xs text-muted-foreground">Read-only archive</span>}
        companySwitcher
        titleTestId="page-title"
        actions={
          <button
            type="button"
            data-testid="history-import-open"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Upload size={14} />
            Import…
          </button>
        }
      />
      <PageBody wide className="space-y-4">
        <Toolbar>
          <Select
            aria-label="Source"
            data-testid="filter-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-auto"
          >
            <option value="">All sources</option>
            {HISTORY_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Year" data-testid="filter-year" value={year} onChange={(e) => setYear(e.target.value)} className="w-auto">
            <option value="">All years</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Currency"
            data-testid="filter-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-auto"
          >
            <option value="">All currencies</option>
            <option value="CHF">CHF</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              data-testid="filter-flagged"
              checked={flagged}
              onChange={(e) => setFlagged(e.target.checked)}
              className="size-3.5 rounded border-input"
            />
            Flagged only
          </label>
          <ToolbarSpacer />
          <span className="text-xs text-muted-foreground" data-testid="history-count">
            {rows.data ? `${rows.data.data.length} row${rows.data.data.length === 1 ? '' : 's'}` : ''}
          </span>
        </Toolbar>

        {rows.isPending && <LoadingState />}
        <ErrorState error={rows.error} retry={rows.refetch} testId="load-error" />

        {rows.data && (
          <Section padded={false} testId="history-section">
            <DataTable<HistoryEntry>
              testId="history"
              columns={historyColumns()}
              rows={rows.data.data}
              rowKey={(h) => h.seq}
              rowHref={(h) => `/dashboard/${ws}/history/${h.seq}`}
              rowTestId={(h) => `history-row-${h.seq}`}
              rowMuted={(h) => h.status === 'void'}
              empty={
                <EmptyState
                  testId="history-empty"
                  icon={Archive}
                  title="Nothing imported"
                  hint={rows.data.data.length === 0 && !source && !year && !currency && !flagged ? 'Import bills from Zoho Books or Invoicely to see them here.' : 'No row matches these filters.'}
                />
              }
            />
          </Section>
        )}
      </PageBody>

      <ImportHistoryModal open={importOpen} onClose={() => setImportOpen(false)} onSubmit={doImport} busy={importHistory.isPending} />
    </>
  )
}

function historyColumns(): Column<HistoryEntry>[] {
  return [
    { key: 'number', header: 'Number', cell: (h) => h.number, mobile: 'title' },
    { key: 'client', header: 'Client', cell: (h) => h.client_name },
    { key: 'company', header: 'Company', cell: (h) => h.company, className: 'hidden sm:table-cell' },
    {
      key: 'source',
      header: 'Source',
      cell: (h) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {historySourceLabel(h.source)}
          {h.import_flag && <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-warning" title={h.import_flag.en}>flagged</span>}
        </span>
      ),
      mobile: 'subtitle',
    },
    { key: 'status', header: 'Status', cell: (h) => <StatusBadge kind="history" status={h.status} /> },
    { key: 'issued', header: 'Issued', cell: (h) => h.issue_date },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (h) => <Money amount={h.total} currency={h.currency} className={h.status === 'void' ? 'line-through text-muted-foreground' : ''} />,
      mobile: 'subtitle',
    },
  ]
}
