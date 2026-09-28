'use client'

// The sidebar's workspace switcher.
//
// Since 2026-09-28 this is the shared component from
// `@blackcode/platform-ui/workspace/workspace-switcher` — this app's own
// dropdown was the model for it, and all four apps now draw the same one. What
// stays here is the wiring: this app's writes and its router.
//
// A workspace is a TENANT; the issuing entities inside one are companies, and
// those are the company switcher's job (company-switcher.tsx), not this one's.
//
// Switching writes through `POST /api/me/active-workspace` — the route
// `bk billing workspace use` calls, stored in `billing.user_settings` since
// migration 0014 (it stored nothing before) — so the web and the CLI agree
// about where you are and the next `/dashboard` opens there.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  WorkspaceSwitcher as SharedSwitcher,
  type SwitcherWorkspace,
} from '@blackcode/platform-ui/workspace/workspace-switcher'
import { useSetActiveWorkspace, toastError } from '@/lib/mutations'
import { WorkspaceCreateModal } from '@/components/workspace-create-modal'

export type { SwitcherWorkspace }

/** Remember a workspace as active, then open it. Shared by the switcher and the chooser. */
export function useOpenWorkspace() {
  const router = useRouter()
  const setActive = useSetActiveWorkspace()
  return async (ws: SwitcherWorkspace) => {
    try {
      await setActive.mutateAsync({ slug: ws.slug })
    } catch (e) {
      toastError(e)
      throw e
    }
    router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
    router.refresh()
  }
}

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: SwitcherWorkspace[]
  /** The slug in the URL, or null on an account page with no workspace. */
  current: string | null
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()

  return (
    <div className="px-2.5 pt-2.5">
      <SharedSwitcher
        workspaces={workspaces}
        current={current}
        onSelect={open}
        onCreate={() => setCreating(true)}
        onManage={(ws) => router.push(`/dashboard/${encodeURIComponent(ws.slug)}/settings`)}
      />
      <WorkspaceCreateModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
