'use client'

// One company: every field, editable. `GET/PATCH …/companies/{slug}`.
// New page (companies/[slug]/page.tsx) — the old minimal UI had no detail
// view, only the list; this is the plan's "create with dialog and edit page".

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { Button } from '@blackcode/platform-ui/ui/button'
import { PageHeader, PageBody } from '@/components/shell'
import { ErrorState, LoadingState, StatusBadge } from '@/components/ui-kit'
import { useCompany, useWorkspace } from '@/lib/queries'
import { usePatchCompany, toastError } from '@/lib/mutations'
import { CompanyFormFields, stateFromCompany, toEditPatch, useCompanyForm } from './company-form'
import type { Company } from '@/types'

export function CompanyDetail({ ws, slug }: { ws: string; slug: string }) {
  const company = useCompany(ws, slug)
  const workspace = useWorkspace(ws)
  const isOwner = workspace.data?.role === 'owner'

  return (
    <>
      <PageHeader
        title={company.data ? company.data.name : slug}
        titleTestId="page-title"
        meta={company.data?.retired_at ? <StatusBadge label="Retired" tone="neutral" /> : undefined}
        breadcrumb={[{ label: 'Companies', href: `/dashboard/${ws}/companies` }]}
      />
      <PageBody wide>
        <ErrorState error={company.error} testId="load-error" retry={company.refetch} />
        {company.isPending && <LoadingState variant="detail" />}
        {/* Keyed on the slug + whether it is loaded, so the form's own state is
            seeded once from the loaded row and then left to the person editing —
            a refetch after save must not throw away what they just typed. */}
        {company.data && <CompanyEditForm key={slug} ws={ws} c={company.data} isOwner={isOwner} />}
      </PageBody>
    </>
  )
}

function CompanyEditForm({ ws, c, isOwner }: { ws: string; c: Company; isOwner: boolean }) {
  const patch = usePatchCompany(ws)
  const { confirm } = useConfirm()
  const { form, set } = useCompanyForm(stateFromCompany(c))
  const [done, setDone] = useState<string | null>(null)

  const save = async () => {
    setDone(null)
    try {
      await patch.mutateAsync({ slug: c.slug, patch: toEditPatch(form, isOwner) })
      toast.success('Company saved')
      setDone('saved')
    } catch (e) {
      toastError(e)
    }
  }

  const retire = async () => {
    const ok = await confirm({
      title: `Retire ${c.name}?`,
      description: 'It issues no new invoices and keeps rendering its old ones. Not undoable from here.',
      confirmLabel: 'Retire',
      destructive: true,
    })
    if (!ok) return
    try {
      await patch.mutateAsync({ slug: c.slug, patch: { retired_at: new Date().toISOString() } })
      toast.success(`${c.name} retired`)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <form
      data-testid="company-edit-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="space-y-6"
    >
      <CompanyFormFields form={form} set={set} mode="edit" isOwner={isOwner} />
      <ErrorState error={patch.error} />
      {done && (
        <p data-testid="done" className="text-sm text-success">
          {done}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Link href={`/dashboard/${ws}/companies`} className="mr-auto text-sm text-muted-foreground hover:text-foreground">
          ← back
        </Link>
        {!c.retired_at && (
          <Button type="button" variant="outline" data-testid="company-retire" onClick={() => void retire()}>
            Retire
          </Button>
        )}
        <Button type="submit" data-testid="company-save" disabled={patch.isPending}>
          {patch.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
