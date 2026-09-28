'use client'

// "Create workspace" — the shared `CreateWorkspaceModal` since 2026-09-28, one
// for every app; this file is issues' wiring. Opened from the sidebar switcher,
// the `/dashboard/workspaces` chooser, and (not dismissible) the zero-workspace
// onboarding screen.
//
// A name only. The logo field it used to carry moved to the workspace's
// settings (General → Logo), where every app with a logo sets it — so creating
// a workspace is one field everywhere. The API still accepts `logo_url` on
// create, for `bk issues workspace create`.

import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CreateWorkspaceModal as SharedModal } from '@blackcode/platform-ui/workspace/create-workspace-modal'

interface CreatedWorkspace {
  id: number
  name: string
  slug: string
}

interface Props {
  open: boolean
  onClose: () => void
  defaultName?: string
  onCreated?: (ws: CreatedWorkspace) => void
  /** False for the first workspace, which must exist before anything else can. */
  dismissible?: boolean
}

export function CreateWorkspaceModal({ open, onClose, defaultName = '', onCreated, dismissible = true }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return (
    <SharedModal
      open={open}
      onClose={onClose}
      defaultName={defaultName}
      dismissible={dismissible}
      labels={{
        createDescription: 'A workspace holds your projects, tasks, issues, and team.',
        namePlaceholder: 'Acme Inc.',
      }}
      onCreate={async (name) => {
        const res = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          toast.error(j.error ?? 'Could not create workspace')
          throw new Error(j.error ?? 'create failed')
        }
        const ws: CreatedWorkspace = await res.json()
        await fetch('/api/me/active-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: ws.id }),
        })
        toast.success(`Created ${ws.name}`)
        await queryClient.invalidateQueries()
        onCreated?.(ws)
        router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
        router.refresh()
      }}
    />
  )
}

/** The old name, kept for the onboarding screen's import. */
export const WorkspaceCreateModal = CreateWorkspaceModal
