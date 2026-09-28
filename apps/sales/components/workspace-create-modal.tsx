'use client'

// The "create workspace" modal — reachable from the sidebar switcher.
//
// The modal itself is the shared `CreateWorkspaceModal` since 2026-09-28 — one
// for every app; this file is its wiring, and sales' own description.
//
// ── WHY THIS CALLS `apiSend` DIRECTLY RATHER THAN GOING THROUGH `lib/mutations.ts`
// ── ────────────────────────────────────────────────────────────────────────
// Creating a workspace is TENANCY ADMINISTRATION, not a sales record write —
// the same class of thing `components/workspace-switcher.tsx` already carries
// an `ACCOUNT_WRITERS` entry for (switching which workspace you look at). A
// read-only display preference that could stop somebody creating a workspace
// they will own would make it a permission over their account rather than over
// the pipeline (D-7). `lib/read-only.test.ts` allows this file by name for
// exactly that reason.
//
// `POST /api/workspaces` — no trailing slash after "workspaces" — does not
// match that test's `WORKSPACE_PATH` regex (it requires either a trailing
// slash or a `wsPath(` call), so this file needs no `workspaceScoped`
// declaration; only the switcher/settings module writing
// `/api/workspaces/{ws}` does.

import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CreateWorkspaceModal } from '@blackcode/platform-ui/workspace/create-workspace-modal'
import { apiSend } from '@/lib/client'

// The 80-character name limit is the shared modal's (`WORKSPACE_NAME_MAX` in
// platform-ui) — the same number every app's route enforces.

interface CreatedWorkspace {
  id: number
  name: string
  slug: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the created workspace after it has been set active. */
  onCreated?: (ws: CreatedWorkspace) => void
}

export function WorkspaceCreateModal({ open, onClose, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return (
    <CreateWorkspaceModal
      open={open}
      onClose={onClose}
      labels={{
        createDescription: 'A separate pipeline — its own prospects, meetings and team.',
        namePlaceholder: 'Acme Sales',
      }}
      onCreate={async (name) => {
        try {
          const ws = await apiSend<CreatedWorkspace>('POST', '/api/workspaces', { name })
          await apiSend('POST', '/api/me/active-workspace', { workspace_id: ws.id })
          toast.success(`Created ${ws.name}`)
          await queryClient.invalidateQueries()
          onCreated?.(ws)
          router.push(`/dashboard/${ws.slug}`)
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not create workspace')
          throw err
        }
      }}
    />
  )
}
