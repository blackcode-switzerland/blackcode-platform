'use client'

// "Make recurring…" — turns this invoice into a series' template.
// `occurrences_total` is required: there is no "forever" (phase 4 decision).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'
import { FormField, FormGrid, Select } from '@/components/ui-kit'
import { FREQUENCY_OPTIONS } from '@/lib/ui-vocab'
import { useCreateRecurrence, toastError } from '@/lib/mutations'
import type { Invoice, RecurrenceFrequency } from '@/types'

export function MakeRecurringModal({
  ws,
  invoice,
  open,
  onClose,
}: {
  ws: string
  invoice: Invoice
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const create = useCreateRecurrence(ws)

  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly')
  const [startDate, setStartDate] = useState<string | null>(invoice.issue_date)
  const [occurrencesTotal, setOccurrencesTotal] = useState('12')
  const [labelEn, setLabelEn] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFrequency('monthly')
    setStartDate(invoice.issue_date)
    setOccurrencesTotal('12')
    setLabelEn('')
    setError(null)
  }, [open, invoice.issue_date])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = Number(occurrencesTotal)
    if (!startDate) {
      setError('A start date is required.')
      return
    }
    if (!Number.isInteger(n) || n < 1) {
      setError('The number of occurrences must be a whole number of at least 1 — there is no "forever".')
      return
    }
    try {
      const recurrence = await create.mutateAsync({
        template: invoice.number,
        frequency,
        start_date: startDate,
        occurrences_total: n,
        label_en: labelEn.trim() || null,
      })
      onClose()
      router.push(`/dashboard/${ws}/recurrences/${recurrence.seq}`)
    } catch (err) {
      toastError(err)
      setError(err instanceof Error ? err.message : 'Could not create the series.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Make ${invoice.number} recurring`} widthClass="max-w-md">
      <form data-testid="make-recurring-form" onSubmit={submit} className="space-y-4">
        <FormGrid cols={2}>
          <FormField label="Frequency" htmlFor="input-frequency" required>
            <Select id="input-frequency" data-testid="input-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}>
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Occurrences" htmlFor="input-occurrences_total" required hint="No open-ended series">
            <Input
              id="input-occurrences_total"
              data-testid="input-occurrences_total"
              type="number"
              min={1}
              value={occurrencesTotal}
              onChange={(e) => setOccurrencesTotal(e.target.value)}
            />
          </FormField>
        </FormGrid>
        <FormField label="Start date" required>
          <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" />
        </FormField>
        <FormField label="Label (optional)" htmlFor="input-label_en">
          <Input id="input-label_en" data-testid="input-label_en" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
        </FormField>

        {error && (
          <p role="alert" data-testid="error" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="make-recurring-submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create series'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
