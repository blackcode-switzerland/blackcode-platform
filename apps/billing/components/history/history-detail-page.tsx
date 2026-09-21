'use client'

// One imported bill — `GET …/history/{seq}`. Read-only: no PATCH, no DELETE
// (migration 0010 refuses both at the database, even to the owner).

import { FileWarning } from 'lucide-react'
import { PageHeader, PageBody } from '@/components/shell'
import { DateText, ErrorState, FieldList, LoadingState, Money, Section, StatusBadge } from '@/components/ui-kit'
import { useHistoryEntry } from '@/lib/queries'
import { historySourceLabel } from '@/lib/ui-vocab'

export function HistoryDetailPage({ ws, seq }: { ws: string; seq: string }) {
  const entry = useHistoryEntry(ws, seq)
  const h = entry.data

  return (
    <>
      <PageHeader
        title={h ? h.number : `#${seq}`}
        meta={h && <StatusBadge kind="history" status={h.status} />}
        breadcrumb={[{ label: 'Imported history', href: `/dashboard/${ws}/history` }]}
        titleTestId="page-title"
      />
      <PageBody className="space-y-4">
        {entry.isPending && <LoadingState variant="detail" />}
        <ErrorState error={entry.error} retry={entry.refetch} testId="load-error" />

        {h && (
          <>
            {h.import_flag && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 px-4 py-3 text-sm" data-testid="history-flag">
                <FileWarning size={16} className="mt-0.5 shrink-0 text-warning" />
                <p>{h.import_flag.en}</p>
              </div>
            )}

            <Section title="This bill" testId="history-detail">
              <FieldList
                items={[
                  { label: 'Number', value: h.number, testId: 'field-number' },
                  { label: 'Client', value: h.client_name, testId: 'field-client' },
                  { label: 'Issuing company', value: h.company, testId: 'field-company' },
                  { label: 'Issue date', value: <DateText value={h.issue_date} />, testId: 'field-issue-date' },
                  { label: 'Total', value: <Money amount={h.total} currency={h.currency} />, testId: 'field-total' },
                  { label: 'Status', value: <StatusBadge kind="history" status={h.status} />, testId: 'field-status' },
                  { label: 'PDF', value: h.drive_path ?? 'none — the export had no PDF', testId: 'field-pdf' },
                ]}
              />
            </Section>

            <Section title="Import record" testId="history-import-record">
              <FieldList
                items={[
                  { label: 'Source', value: historySourceLabel(h.source), testId: 'field-source' },
                  { label: 'Source reference', value: <code className="font-mono text-xs">{h.source_ref}</code>, testId: 'field-source-ref' },
                  { label: 'Imported', value: <DateText value={h.imported_at} withTime />, testId: 'field-imported-at' },
                  {
                    label: 'Imported by',
                    value: h.imported_by.email ?? 'account removed since',
                    testId: 'field-imported-by',
                  },
                ]}
              />
            </Section>
          </>
        )}
      </PageBody>
    </>
  )
}
