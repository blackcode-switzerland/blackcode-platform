'use client'

// "New invoice" — a clean create dialog with every field the minimal test UI's
// form had (`app/dashboard/[ws]/invoices/page.tsx`, pre-rebuild), plus the
// structured line editor. POST then navigate to the detail page, same as
// before (`router.push('/dashboard/<ws>/invoices/<seq>')`).

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'
import { FormField, FormGrid, Select, Textarea } from '@/components/ui-kit'
import { useCompanies } from '@/lib/queries'
import { useCreateInvoice, toastError } from '@/lib/mutations'
import { DOCUMENT_LANGUAGES, REFERENCE_TYPES } from '@/lib/vocabularies'
import { EMPTY_LINE, LineItemsEditor } from './line-items-editor'
import type { CreateInvoiceLineBody, DocumentLanguage, ReferenceType, StructuredAddress } from '@/types'

const EMPTY_ADDRESS: StructuredAddress = { name: '', street: null, building: null, postal_code: null, city: null, country: 'CH' }

export function CreateInvoiceDialog({ ws, open, onClose }: { ws: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const companies = useCompanies(ws, {}, { enabled: open })
  const create = useCreateInvoice(ws)

  const [company, setCompany] = useState('')
  const [client, setClient] = useState<StructuredAddress>(EMPTY_ADDRESS)
  const [currency, setCurrency] = useState('')
  const [refType, setRefType] = useState('')
  const [language, setLanguage] = useState('')
  const [issueDate, setIssueDate] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<CreateInvoiceLineBody[]>([{ ...EMPTY_LINE, description: 'Work' }])
  const [error, setError] = useState<string | null>(null)

  // Reset on each open so a previous draft never leaks into the next.
  useEffect(() => {
    if (!open) return
    setCompany('')
    setClient(EMPTY_ADDRESS)
    setCurrency('')
    setRefType('')
    setLanguage('')
    setIssueDate(null)
    setDueDate(null)
    setMessage('')
    setItems([{ ...EMPTY_LINE, description: 'Work' }])
    setError(null)
  }, [open])

  const companyList = companies.data ?? []
  const effectiveCompany = company || companyList[0]?.slug || ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!effectiveCompany) {
      setError('Pick an issuing company.')
      return
    }
    if (!client.name.trim()) {
      setError('The client needs a name.')
      return
    }
    try {
      const invoice = await create.mutateAsync({
        company: effectiveCompany,
        client: { ...client, name: client.name.trim() },
        items,
        currency: currency || undefined,
        ref_type: (refType || undefined) as ReferenceType | undefined,
        language: (language || undefined) as DocumentLanguage | undefined,
        issue_date: issueDate ?? undefined,
        due_date: dueDate ?? undefined,
        message: message.trim() || null,
      })
      onClose()
      router.push(`/dashboard/${ws}/invoices/${invoice.seq}?new=1`)
    } catch (err) {
      toastError(err)
      setError(err instanceof Error ? err.message : 'Could not create the draft.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New invoice" widthClass="max-w-2xl">
      <form data-testid="invoice-form" onSubmit={submit} className="space-y-5">
        <FormGrid cols={2}>
          <FormField label="Company" htmlFor="input-company" required>
            <Select
              id="input-company"
              data-testid="input-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            >
              {companyList.length === 0 && <option value="">No companies yet</option>}
              {companyList.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Currency" htmlFor="input-currency" hint="Company default when left blank">
            <Input id="input-currency" data-testid="input-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="company default" />
          </FormField>
          <FormField label="Reference type" htmlFor="input-ref_type" hint="Company default when left blank">
            <Select id="input-ref_type" data-testid="input-ref_type" value={refType} onChange={(e) => setRefType(e.target.value)}>
              <option value="">company default</option>
              {REFERENCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Document language" htmlFor="input-language" hint="Company default when left blank">
            <Select id="input-language" data-testid="input-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">company default</option>
              {DOCUMENT_LANGUAGES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Issue date" hint="Today when left blank">
            <DatePicker value={issueDate} onChange={setIssueDate} placeholder="Today" />
          </FormField>
          <FormField label="Due date" hint="Company's payment terms when left blank">
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Payment terms" />
          </FormField>
        </FormGrid>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-medium text-foreground">Client</legend>
          <FormGrid cols={2}>
            <FormField label="Name" htmlFor="input-client_name" required>
              <Input id="input-client_name" data-testid="input-client_name" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
            </FormField>
            <FormField label="Street" htmlFor="input-client_street">
              <Input id="input-client_street" data-testid="input-client_street" value={client.street ?? ''} onChange={(e) => setClient({ ...client, street: e.target.value || null })} />
            </FormField>
            <FormField label="Building" htmlFor="input-client_building">
              <Input id="input-client_building" data-testid="input-client_building" value={client.building ?? ''} onChange={(e) => setClient({ ...client, building: e.target.value || null })} />
            </FormField>
            <FormField label="Postal code" htmlFor="input-client_postal_code">
              <Input id="input-client_postal_code" data-testid="input-client_postal_code" value={client.postal_code ?? ''} onChange={(e) => setClient({ ...client, postal_code: e.target.value || null })} />
            </FormField>
            <FormField label="City" htmlFor="input-client_city">
              <Input id="input-client_city" data-testid="input-client_city" value={client.city ?? ''} onChange={(e) => setClient({ ...client, city: e.target.value || null })} />
            </FormField>
            <FormField label="Country" htmlFor="input-client_country" hint="ISO 3166-1 alpha-2">
              <Input id="input-client_country" data-testid="input-client_country" value={client.country ?? ''} onChange={(e) => setClient({ ...client, country: e.target.value.toUpperCase() || null })} maxLength={2} />
            </FormField>
          </FormGrid>
        </fieldset>

        <FormField label="Payment message" htmlFor="input-message">
          <Textarea id="input-message" data-testid="input-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-foreground">Lines</legend>
          <LineItemsEditor items={items} onChange={setItems} />
        </fieldset>

        {error && (
          <p role="alert" data-testid="error" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="invoice-create" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
