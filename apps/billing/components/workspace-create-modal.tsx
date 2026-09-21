'use client'

// The "create workspace" modal, opened from the sidebar's workspace switcher
// (phase 2, 2026-09-21) — modelled on `apps/sales`' modal of the same name,
// never imported from it.
//
// It wraps the SAME `CreateWorkspaceForm` the `/dashboard?new=1` screen
// renders, so the write is one component calling `POST /api/workspaces` (what
// `bk billing workspace create` calls) — two forms for one route is two places
// for the validation to drift. `?new=1` still works for a direct link.
//
// After creating: remember it as the active workspace (`POST
// /api/me/active-workspace`, what `bk billing workspace use` writes), then land
// there. `router.refresh()` because the switcher's list is loaded server-side.

import { useRouter } from 'next/navigation'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'
import { useSetActiveWorkspace } from '@/lib/mutations'

export function WorkspaceCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const setActive = useSetActiveWorkspace()

  async function onCreated(slug: string) {
    // Best-effort: the workspace exists either way, and the URL is what the
    // pages read. A failure here only means the NEXT bare `/dashboard` opens
    // somewhere else, so it is not worth an error on top of a success.
    await setActive.mutateAsync({ slug }).catch(() => undefined)
    onClose()
    router.push(`/dashboard/${encodeURIComponent(slug)}`)
    router.refresh()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create workspace"
      description="A separate tenant, with its own companies, invoices and team. Several issuing companies can live in one workspace."
    >
      <CreateWorkspaceForm onCreated={onCreated} />
    </Modal>
  )
}
