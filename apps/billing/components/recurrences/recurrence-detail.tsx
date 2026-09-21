'use client'

// One series: where it stands, its invoices (voids included), generate,
// pause/resume, edit total/labels, audit history.
// `GET/PATCH …/recurrences/{seq}`, `POST …/recurrences/{seq}/generate`,
// `GET …/audit?subject=recurrence:{seq}`.

import { useState } from 'react'
import { Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@blackcode/platform-ui/ui/input'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { PageHeader, PageBody } from '@/components/shell'
import {
  DataTable,
  DateText,
  ErrorState,
  FormField,
  FormGrid,
  LoadingState,
  Money,
  Section,
  StatusBadge,
  type Column,
} from '@/components/ui-kit'
import { amountClassFor as amountClass, frequencyLabel } from '@/lib/ui-vocab'
import { useAudit, useMeta, useRecurrence } from '@/lib/queries'
import { useGenerateOccurrence, usePatchRecurrence, toastError, type RecurrencePatch } from '@/lib/mutations'
import { WebError } from '@/lib/client'
import type { AuditEntry, RecurrenceOccurrence } from '@/types'

export function RecurrenceDetail({ ws, seq }: { ws: string; seq: string }) {
  const rec = useRecurrence(ws, seq)
  const audit = useAudit(ws, { subject: `recurrence:${seq}`, limit: 100 })
  const meta = useMeta()
  const patch = usePatchRecurrence(ws)

  const [genOpen, setGenOpen] = useState(false)
  const [total, setTotal] = useState('')
  const [patchDone, setPatchDone] = useState<string | null>(null)

  const r = rec.data

  const doPatch = async (body: RecurrencePatch, successMsg: string) => {
    setPatchDone(null)
    try {
      await patch.mutateAsync({ seq, patch: body })
      toast.success(successMsg)
      setPatchDone(successMsg)
    } catch (e) {
      toastError(e)
    }
  }

  const editTotal = async () => {
    const n = Number(total.trim())
    if (!total.trim() || Number.isNaN(n)) return
    await doPatch({ occurrences_total: n }, 'Total saved')
  }

  const requestPause = () => void doPatch({ status: 'paused' }, 'Paused')
  const requestResume = () => void doPatch({ status: 'active' }, 'Resumed')

  const invoiceColumns: Column<RecurrenceOccurrence>[] = [
    { key: 'number', header: 'Number', cell: (i) => <span className="font-mono text-xs">{i.number}</span>, mobile: 'title' },
    { key: 'period', header: 'Period', cell: (i) => i.occurrence_period ?? '(template)' },
    { key: 'issue_date', header: 'Issued', cell: (i) => <DateText value={i.issue_date} /> },
    { key: 'status', header: 'Status', cell: (i) => <StatusBadge kind="invoice" status={i.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (i) => <Money amount={i.total} currency={i.currency} className={amountClass(i.status)} />,
      mobile: 'subtitle',
    },
  ]

  const auditColumns: Column<AuditEntry>[] = [
    { key: 'ts', header: 'When', cell: (a) => <DateText value={a.ts} withTime />, mobile: 'title' },
    { key: 'action', header: 'Action', cell: (a) => a.action },
    { key: 'field', header: 'Field', cell: (a) => a.field ?? '—' },
    { key: 'detail', header: 'Detail', cell: (a) => a.detail_en ?? `${a.from_value ?? ''} → ${a.to_value ?? ''}` },
  ]

  const pct = r && r.occurrences_total > 0 ? Math.min(100, Math.round((r.occurrences_done / r.occurrences_total) * 100)) : 0

  return (
    <>
      <PageHeader
        title={r ? `#${r.seq} ${r.label.en ?? r.label.fr ?? ''}`.trim() : `#${seq}`}
        titleTestId="page-title"
        meta={r ? <StatusBadge kind="recurrence" status={r.status} /> : undefined}
        breadcrumb={[{ label: 'Recurring series', href: `/dashboard/${ws}/recurrences` }]}
        actions={
          r ? (
            <>
              {r.status === 'active' && (
                <Button type="button" size="sm" variant="outline" data-testid="pause" onClick={requestPause}>
                  Pause
                </Button>
              )}
              {r.status === 'paused' && (
                <Button type="button" size="sm" variant="outline" data-testid="resume" onClick={requestResume}>
                  Resume
                </Button>
              )}
              {r.status !== 'completed' && (
                <Button type="button" size="sm" data-testid="generate-open" onClick={() => setGenOpen(true)}>
                  <Repeat size={14} /> Generate next
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <PageBody wide>
        <ErrorState error={rec.error} testId="load-error" retry={rec.refetch} />
        {rec.isPending && <LoadingState variant="detail" />}
        {r && (
          <div className="space-y-6">
            <Section testId="series-fields" padded={false} bodyClassName="p-5 sm:p-6">
              <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{r.label.en ?? r.label.fr ?? `Series #${r.seq}`}</h2>
                    <StatusBadge kind="recurrence" status={r.status} testId="field-status" />
                    {r.due && <StatusBadge label="Due" tone="primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground" data-testid="field-frequency">
                    {frequencyLabel(r.frequency)} · starting <DateText value={r.start_date} /> · Stops after {r.occurrences_total} occurrences
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="field-company">
                    Company: <span className="text-foreground">{r.company}</span>
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="field-template">
                    Template:{' '}
                    {r.template_number ? (
                      <a href={`/dashboard/${ws}/invoices/${r.template}`} className="font-mono text-xs text-primary hover:underline">
                        {r.template_number}
                      </a>
                    ) : (
                      '—'
                    )}
                  </p>
                  <div data-testid="field-next" className="text-sm">
                    {r.next_date ? (
                      <>
                        Next: <DateText value={r.next_date} /> (period {r.next_period})
                      </>
                    ) : (
                      'Complete — no further occurrences.'
                    )}
                  </div>
                </div>

                <div className="flex flex-col justify-center gap-1.5 sm:w-48">
                  <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span data-testid="field-done" className="font-mono tabular-nums text-foreground">
                      {r.occurrences_done}/{r.occurrences_total}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Invoices" padded={false} testId="series-invoices">
              <DataTable
                columns={invoiceColumns}
                rows={r.invoices ?? []}
                rowKey={(i) => i.seq}
                rowHref={(i) => `/dashboard/${ws}/invoices/${i.seq}`}
                rowTestId={(i) => `series-invoice-${i.number}`}
                rowMuted={(i) => i.status === 'void'}
                empty={<p className="px-5 py-6 text-sm text-muted-foreground">No occurrences generated yet.</p>}
              />
            </Section>

            <Section title="Occurrences">
              <ErrorState error={patch.error} />
              {patchDone && (
                <p data-testid="done" className="mb-3 text-sm text-success">
                  {patchDone}
                </p>
              )}
              {r.status !== 'completed' ? (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Edit total {meta.data?.limits.recurrence.occurrences_max ? `(max ${meta.data.limits.recurrence.occurrences_max})` : ''}
                  </p>
                  <FormGrid cols={2}>
                    <FormField label="Total" htmlFor="input-occurrences_total">
                      <Input
                        id="input-occurrences_total"
                        data-testid="input-occurrences_total"
                        value={total}
                        onChange={(e) => setTotal(e.target.value)}
                        placeholder={String(r.occurrences_total)}
                      />
                    </FormField>
                  </FormGrid>
                  <Button type="button" size="sm" variant="outline" data-testid="edit-total" disabled={patch.isPending} onClick={() => void editTotal()}>
                    Save total
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Completed — reached its cap. Final.</p>
              )}
            </Section>

            <Section title="History" padded={false}>
              <ErrorState error={audit.error} testId="audit-error" />
              <DataTable
                testId="audit"
                columns={auditColumns}
                rows={audit.data?.data ?? []}
                rowKey={(a) => a.seq}
                empty={<p className="px-5 py-6 text-sm text-muted-foreground">No history yet.</p>}
              />
            </Section>
          </div>
        )}
      </PageBody>

      {r && <GenerateModal ws={ws} seq={seq} r={r} open={genOpen} onClose={() => setGenOpen(false)} />}
    </>
  )
}

function GenerateModal({
  ws,
  seq,
  r,
  open,
  onClose,
}: {
  ws: string
  seq: string
  r: NonNullable<ReturnType<typeof useRecurrence>['data']>
  open: boolean
  onClose: () => void
}) {
  const generate = useGenerateOccurrence(ws)
  const [period, setPeriod] = useState('')
  const [message, setMessage] = useState('')

  const doGenerate = async () => {
    try {
      const res = await generate.mutateAsync({
        seq,
        // The period is sent as typed, never filled in from `next_period`: the
        // server refuses rather than guesses, and so does this form.
        body: { period: period.trim(), ...(message.trim() ? { message: message.trim() } : {}) },
      })
      const label = res.replacement ? `${res.invoice.number} (replacement)` : res.invoice.number
      toast.success(`Generated ${label}`)
      setPeriod('')
      setMessage('')
      onClose()
    } catch (e) {
      // 409 already_generated names the existing invoice in its own message —
      // render it as "already exists: <number>", linking to it via the
      // invoices list below rather than duplicating the lookup here.
      if (e instanceof WebError && e.code === 'already_generated') {
        toast.error(`Already exists: ${e.message}`, { description: 'See the invoices list below.' })
      } else {
        toastError(e)
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate next occurrence" description="Generating is not sending — this creates a draft.">
      <form
        data-testid="series-generate-form"
        onSubmit={(e) => {
          e.preventDefault()
          void doGenerate()
        }}
        className="space-y-4"
      >
        <FormGrid cols={2}>
          <FormField label="Period" htmlFor="input-period" hint={r.next_period ? `Series expects ${r.next_period}.` : undefined}>
            <Input id="input-period" data-testid="input-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={r.next_period ?? ''} />
          </FormField>
          <FormField label="Payment message" htmlFor="input-message" hint="Defaults to the template's.">
            <Input id="input-message" data-testid="input-message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </FormField>
        </FormGrid>
        <ErrorState error={generate.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="generate" disabled={generate.isPending}>
            {generate.isPending ? 'Generating…' : 'Generate draft'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
