'use client'

// Companies: the issuing entities of a workspace. List + create.
// `GET/POST …/companies`. Replaces the minimal test UI — every field of the
// old page is kept (plus the full set the routes support), and every
// data-testid on an equivalent element is preserved for the Playwright walk.

import { useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { DataTable, EmptyState, ErrorState, LoadingState, type Column } from '@/components/ui-kit'
import { PageHeader, PageBody } from '@/components/shell'
import { useCompanies, useWorkspace } from '@/lib/queries'
import { useCreateCompany, toastError } from '@/lib/mutations'
import { CompanyFormFields, toCreateBody, useCompanyForm } from './company-form'
import { formatIban } from './format'
import type { Company } from '@/types'

export function CompaniesPage({ ws }: { ws: string }) {
  const companies = useCompanies(ws)
  const workspace = useWorkspace(ws)
  const isOwner = workspace.data?.role === 'owner'
  const [open, setOpen] = useState(false)

  const columns: Column<Company>[] = [
    { key: 'seq', header: '#', cell: (c) => c.seq, mobile: 'hide' },
    { key: 'name', header: 'Name', cell: (c) => c.name, mobile: 'title' },
    { key: 'slug', header: 'Slug', cell: (c) => <span className="font-mono text-xs text-muted-foreground">{c.slug}</span>, mobile: 'hide' },
    { key: 'legal_name', header: 'Legal name', cell: (c) => c.legal_name, mobile: 'subtitle' },
    { key: 'city', header: 'City', cell: (c) => c.address.city ?? '—' },
    { key: 'iban', header: 'IBAN', cell: (c) => <span className="font-mono text-xs">{formatIban(c.iban)}</span>, mobile: 'hide' },
    { key: 'qr_iban', header: 'QR-IBAN', cell: (c) => <span className="font-mono text-xs">{formatIban(c.qr_iban)}</span>, mobile: 'hide' },
    { key: 'vat', header: 'VAT', cell: (c) => (c.vat_registered ? 'Registered' : 'Not registered') },
    { key: 'next_seq', header: 'Next no.', cell: (c) => c.next_seq, align: 'right', mobile: 'hide' },
  ]

  return (
    <>
      <PageHeader
        title="Companies"
        titleTestId="page-title"
        actions={
          <Button size="sm" data-testid="company-create-open" onClick={() => setOpen(true)}>
            <Plus size={14} /> New company
          </Button>
        }
      />
      <PageBody wide>
        <ErrorState error={companies.error} testId="load-error" retry={companies.refetch} />
        {companies.isPending && <LoadingState variant="rows" />}
        {companies.data && (
          <DataTable
            testId="companies"
            columns={columns}
            rows={companies.data}
            rowKey={(c) => c.seq}
            rowHref={(c) => `/dashboard/${ws}/companies/${c.slug}`}
            rowTestId={(c) => `company-${c.slug}`}
            rowMuted={(c) => !!c.retired_at}
            empty={
              <EmptyState
                icon={Building2}
                title="No companies yet"
                hint="A company is the entity whose name, address and bank account appear on a bill."
                action={
                  <Button size="sm" onClick={() => setOpen(true)}>
                    <Plus size={14} /> New company
                  </Button>
                }
              />
            }
          />
        )}
      </PageBody>

      <CreateCompanyDialog ws={ws} open={open} onClose={() => setOpen(false)} isOwner={isOwner} />
    </>
  )
}

function CreateCompanyDialog({
  ws,
  open,
  onClose,
  isOwner,
}: {
  ws: string
  open: boolean
  onClose: () => void
  isOwner: boolean
}) {
  const { form, set, reset } = useCompanyForm()
  const create = useCreateCompany(ws)
  const [done, setDone] = useState<string | null>(null)

  const submit = async () => {
    setDone(null)
    try {
      const c = await create.mutateAsync(toCreateBody(form))
      toast.success(`Company ${c.name} created`)
      setDone(`created company ${c.slug}`)
      reset()
      onClose()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New company" widthClass="max-w-3xl">
      <form
        data-testid="company-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-6"
      >
        <CompanyFormFields form={form} set={set} mode="create" isOwner={isOwner} />
        <ErrorState error={create.error} />
        {done && <p data-testid="done" className="text-sm text-success">{done}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="company-create" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create company'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
