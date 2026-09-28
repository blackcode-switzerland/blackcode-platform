'use client'

// "Create workspace", in place — the shared `CreateWorkspaceModal` (since
// 2026-09-28), wired to this app's writes. Used by the sidebar switcher and the
// `/dashboard` chooser; `components/create-workspace-form.tsx` still serves the
// failure screen, which has no modal to open.
//
// Setting the new workspace active is best-effort: it exists either way, and
// the URL is what the pages read. A failure there only means the NEXT bare
// `/dashboard` opens somewhere else, so it is not worth an error on top of a
// success.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CreateWorkspaceModal } from '@blackcode/platform-ui/workspace/create-workspace-modal'
import { toastError, useCreateWorkspace, useSetActiveWorkspace } from '@/lib/mutations'

export function WorkspaceCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const create = useCreateWorkspace()
  const setActive = useSetActiveWorkspace()

  return (
    <CreateWorkspaceModal
      open={open}
      onClose={onClose}
      labels={{
        createDescription:
          'A separate tenant, with its own companies, invoices and team. Several issuing companies can live in one workspace.',
      }}
      onCreate={async (name) => {
        let ws
        try {
          ws = await create.mutateAsync({ name })
        } catch (e) {
          toastError(e)
          throw e
        }
        await setActive.mutateAsync({ slug: ws.slug }).catch(() => undefined)
        toast.success(`Created ${ws.name}`)
        router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
        router.refresh()
      }}
    />
  )
}
