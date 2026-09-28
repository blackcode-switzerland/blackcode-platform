'use client'

// The sidebar's workspace switcher and its "Create workspace" modal — the
// shared components from `@blackcode/platform-ui/workspace/*`, wired to this
// app's gated writes (`lib/mutations.ts`) and its words (`./labels`).
//
// Switching remembers the choice (`POST /api/me/active-workspace`, the route
// `bk books workspace use` calls, stored in `books.user_settings`) before it
// navigates, so the next `/dashboard` opens where you were.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { WorkspaceSwitcher, type SwitcherWorkspace } from '@blackcode/platform-ui/workspace/workspace-switcher'
import { CreateWorkspaceModal } from '@blackcode/platform-ui/workspace/create-workspace-modal'
import { useCreateWorkspace, useSetActiveWorkspace } from '@/lib/mutations'
import { useT } from '@/lib/i18n'
import { useWorkspaceLabels } from './labels'

export type { SwitcherWorkspace }

/** Create a workspace, make it the active one, and open it. Shared by the switcher and the chooser. */
export function useCreateAndOpenWorkspace() {
  const router = useRouter()
  const t = useT()
  const create = useCreateWorkspace()
  const setActive = useSetActiveWorkspace()
  return async (name: string) => {
    const made = await create.run({ name })
    if (!made.ok) {
      toast.error(made.message)
      throw made.error
    }
    await setActive.run({ slug: made.data.slug })
    toast.success(t('ws.toastCreated', { name: made.data.name }))
    router.push(`/dashboard/${encodeURIComponent(made.data.slug)}`)
    router.refresh()
  }
}

/** Remember a workspace as active, then open it. Shared by the switcher and the chooser. */
export function useOpenWorkspace() {
  const router = useRouter()
  const t = useT()
  const setActive = useSetActiveWorkspace()
  return async (ws: SwitcherWorkspace) => {
    const res = await setActive.run({ slug: ws.slug })
    if (!res.ok) {
      toast.error(t('ws.toastSwitchFailed', { name: ws.name }), { description: res.message })
      throw res.error
    }
    router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
    router.refresh()
  }
}

export function BooksWorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: SwitcherWorkspace[]
  current: string | null
}) {
  const router = useRouter()
  const labels = useWorkspaceLabels()
  const [creating, setCreating] = useState(false)
  const createAndOpen = useCreateAndOpenWorkspace()
  const open = useOpenWorkspace()

  return (
    <>
      <WorkspaceSwitcher
        workspaces={workspaces}
        current={current}
        onSelect={open}
        onCreate={() => setCreating(true)}
        onManage={(ws) => router.push(`/dashboard/${encodeURIComponent(ws.slug)}/settings`)}
        labels={labels}
      />
      <CreateWorkspaceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={createAndOpen}
        labels={labels}
      />
    </>
  )
}
