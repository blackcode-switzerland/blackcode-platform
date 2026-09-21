'use client'

// Recurring series: list (status + due filter) and create. `GET/POST …/recurrences`.
// Replaces the minimal test UI; every field/filter/testid of the old page is
// kept, plus company/status filters the route already supports.

import { useState } from 'react'
import { Plus, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@blackcode/platform-ui/ui/input'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { PageHeader, PageBody, useCompanyParam } from '@/components/shell'
import {
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  LoadingState,
  Select,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
  Segmented,
  type Column,
} from '@/components/ui-kit'
import { useRecurrences } from '@/lib/queries'
import { useCreateRecurrence, toastError } from '@/lib/mutations'
import { RECURRENCE_STATUS_OPTIONS, FREQUENCY_OPTIONS, DUE_TONE } from '@/lib/ui-vocab'
import type { CreateRecurrenceBody, Recurrence, RecurrenceFrequency } from '@/types'

type DueFilter = '' | 'due'
type StatusFilter = '' | 'active' | 'paused' | 'completed'

export function RecurrencesPage({ ws }: { ws: string }) {
  const company = useCompanyParam()
  const [due, setDue] = useState<DueFilter>('')
  const [status, setStatus] = useState<StatusFilter>('')
  const series = useRecurrences(ws, {
    company,
    status: status || undefined,
    due: due === 'due' ? true : undefined,
  })
  const [open, setOpen] = useState(false)
  const filtered = Boolean(due || status)

  const columns: Column<Recurrence>[] = [
    { key: 'seq', header: '#', cell: (r) => r.seq, mobile: 'hide' },
    { key: 'label', header: 'Label', cell: (r) => r.label.en ?? r.label.fr ?? '—', mobile: 'title' },
    { key: 'company', header: 'Company', cell: (r) => r.company },
    { key: 'template', header: 'Template', cell: (r) => r.template_number ?? '—' },
    { key: 'frequency', header: 'Frequency', cell: (r) => FREQUENCY_OPTIONS.find((f) => f.value === r.frequency)?.label ?? r.frequency },
    { key: 'progress', header: 'Progress', cell: (r) => `${r.occurrences_done}/${r.occurrences_total}`, mobile: 'subtitle' },
    {
      key: 'next',
      header: 'Next',
      cell: (r) => (r.next_date ? <DateText value={r.next_date} /> : 'complete'),
    },
    { key: 'period', header: 'Period', cell: (r) => r.next_period ?? '—', mobile: 'hide' },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge kind="recurrence" status={r.status} />
          {r.due && <StatusBadge label="Due" tone={DUE_TONE} />}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Recurring series"
        titleTestId="page-title"
        companySwitcher
        actions={
          <Button size="sm" data-testid="series-create-open" onClick={() => setOpen(true)}>
            <Plus size={14} /> New series
          </Button>
        }
      />
      <PageBody wide>
        <Toolbar>
          <Segmented<DueFilter>
            ariaLabel="Due filter"
            value={due}
            onChange={setDue}
            options={[
              { value: '', label: 'All' },
              { value: 'due', label: 'Due', testId: 'filter-due' },
            ]}
          />
          <Segmented<StatusFilter>
            ariaLabel="Status filter"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              ...RECURRENCE_STATUS_OPTIONS.map((o) => ({ value: o.value as StatusFilter, label: o.label })),
            ]}
          />
          <ToolbarSpacer />
        </Toolbar>

        <ErrorState error={series.error} testId="load-error" retry={series.refetch} />
        {series.isPending && <LoadingState variant="rows" />}
        {series.data && (
          <DataTable
            testId="series"
            columns={columns}
            rows={series.data.data}
            rowKey={(r) => r.seq}
            rowHref={(r) => `/dashboard/${ws}/recurrences/${r.seq}`}
            rowTestId={(r) => `series-row-${r.seq}`}
            empty={
              <EmptyState
                icon={Repeat}
                testId="series-empty"
                title={filtered ? 'No series match these filters' : 'No series yet'}
                hint={due === 'due' ? undefined : 'A series is a finite rule — no invoice is ever generated on its own.'}
              />
            }
          />
        )}
      </PageBody>

      <CreateRecurrenceDialog ws={ws} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function CreateRecurrenceDialog({ ws, open, onClose }: { ws: string; open: boolean; onClose: () => void }) {
  const create = useCreateRecurrence(ws)
  const [form, setForm] = useState({
    template: '',
    frequency: 'monthly' as RecurrenceFrequency,
    start_date: '',
    occurrences_total: '',
    label_en: '',
    label_fr: '',
  })
  const [done, setDone] = useState<string | null>(null)

  const submit = async () => {
    setDone(null)
    const body: CreateRecurrenceBody = {
      template: form.template.trim(),
      frequency: form.frequency,
      start_date: form.start_date.trim(),
      // Sent as typed, including empty: the server's own "occurrences_required"
      // refusal is part of what a person filling the form should see.
      occurrences_total: form.occurrences_total.trim() === '' ? (undefined as unknown as number) : Number(form.occurrences_total),
      label_en: form.label_en.trim() || null,
      label_fr: form.label_fr.trim() || null,
    }
    try {
      const r = await create.mutateAsync(body)
      toast.success(`Series #${r.seq} created`)
      setDone(`created series #${r.seq}`)
      onClose()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New series" description='&quot;Make recurring…&quot; — there is no open-ended series.'>
      <form
        data-testid="series-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-4"
      >
        <FormField label="Template invoice" htmlFor="input-template" required hint="#number or printed number.">
          <Input
            id="input-template"
            data-testid="input-template"
            value={form.template}
            onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
            placeholder="#number or printed number"
          />
        </FormField>
        <FormGrid cols={2}>
          <FormField label="Frequency" htmlFor="input-frequency" required>
            <Select
              id="input-frequency"
              data-testid="input-frequency"
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFrequency }))}
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Start date" htmlFor="input-start_date" required hint="YYYY-MM-DD — its day of month is the series' anchor.">
            <Input
              id="input-start_date"
              data-testid="input-start_date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </FormField>
        </FormGrid>
        <FormField label="Occurrences (required)" htmlFor="input-occurrences_total" required hint="There is no default and no &quot;leave it open&quot;.">
          <Input
            id="input-occurrences_total"
            data-testid="input-occurrences_total"
            value={form.occurrences_total}
            onChange={(e) => setForm((f) => ({ ...f, occurrences_total: e.target.value }))}
            placeholder="12"
          />
        </FormField>
        <FormGrid cols={2}>
          <FormField label="Label (EN)" htmlFor="input-label_en">
            <Input
              id="input-label_en"
              data-testid="input-label_en"
              value={form.label_en}
              onChange={(e) => setForm((f) => ({ ...f, label_en: e.target.value }))}
            />
          </FormField>
          <FormField label="Label (FR)" htmlFor="input-label_fr">
            <Input
              id="input-label_fr"
              data-testid="input-label_fr"
              value={form.label_fr}
              onChange={(e) => setForm((f) => ({ ...f, label_fr: e.target.value }))}
            />
          </FormField>
        </FormGrid>
        <ErrorState error={create.error} />
        {done && (
          <p data-testid="done" className="text-sm text-success">
            {done}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="series-create" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create series'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
