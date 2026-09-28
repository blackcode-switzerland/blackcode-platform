'use client'

// "New invoice" — the platform create pattern (CLAUDE.md): a minimal draft is
// POSTed and the browser is routed to the detail page with `?new=1`, where
// every field — client, lines, currency, reference type, document language,
// dates, message — is edited in place through the routes the detail page
// already calls (`PATCH …/invoices/{ref}`, the lines replace). `insertInvoice`
// requires only `company`; everything else defaults from the company or an
// empty value, so nothing is collected here that the detail page cannot set
// afterwards.
//
// `InvoiceListPage` skips this dialog entirely when the company is already
// known — the header's `?company=` filter, or the workspace's one company —
// and creates straight away. This only opens when the caller must be asked
// which company, and it asks ONLY that.

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { Button } from '@blackcode/platform-ui/ui/button'
import { FormField, Select } from '@/components/ui-kit'
import { useCompanies } from '@/lib/queries'
import { useCreateInvoice, toastError } from '@/lib/mutations'

export function CreateInvoiceDialog({ ws, open, onClose }: { ws: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const companies = useCompanies(ws, {}, { enabled: open })
  const create = useCreateInvoice(ws)

  const [company, setCompany] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset on each open so a previous pick never leaks into the next.
  useEffect(() => {
    if (!open) return
    setCompany('')
    setError(null)
  }, [open])

  const companyList = companies.data ?? []

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!company) {
      setError('Pick an issuing company.')
      return
    }
    try {
      const invoice = await create.mutateAsync({ company })
      onClose()
      router.push(`/dashboard/${ws}/invoices/${invoice.seq}?new=1`)
    } catch (err) {
      toastError(err)
      setError(err instanceof Error ? err.message : 'Could not create the draft.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New invoice"
      description="Pick the issuing company — everything else is edited on the invoice itself."
      widthClass="max-w-sm"
    >
      <form data-testid="invoice-form" onSubmit={submit} className="space-y-4">
        <FormField label="Company" htmlFor="input-company" required>
          <Select
            id="input-company"
            data-testid="input-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoFocus
          >
            <option value="">Select a company…</option>
            {companyList.length === 0 && !companies.isPending && <option value="" disabled>No companies yet</option>}
            {companyList.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
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
          <Button type="submit" data-testid="invoice-create" disabled={create.isPending || companyList.length === 0}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
