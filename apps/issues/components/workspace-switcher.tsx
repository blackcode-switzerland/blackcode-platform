'use client'

// The sidebar's workspace switcher — the shared one from
// `@blackcode/platform-ui/workspace/workspace-switcher` since 2026-09-28, which
// all four apps render.
//
// Until then this was a LINK to `/dashboard/workspaces`, a list page, where the
// other three apps had a dropdown; the list page is now the shared chooser and
// administration lives at `/dashboard/{ws}/settings`, as everywhere else.
//
// The current workspace is the one in the URL (`useActiveWorkspace`), and
// switching remembers the choice through `POST /api/me/active-workspace` — the
// route `bk issues workspace use` calls — before it navigates.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  WorkspaceSwitcher as SharedSwitcher,
  type SwitcherWorkspace,
} from '@blackcode/platform-ui/workspace/workspace-switcher'
import { CreateWorkspaceModal } from '@/components/workspace-create-modal'
import { useActiveWorkspace } from '@/components/listings/use-active-workspace'

export type { SwitcherWorkspace }

async function fetchWorkspaces(): Promise<SwitcherWorkspace[]> {
  const res = await fetch('/api/workspaces')
  if (!res.ok) throw new Error('Could not load your workspaces')
  return (await res.json()).data
}

/** The same list every caller of `['me-workspaces']` shares. */
export function useMyWorkspaces() {
  return useQuery({ queryKey: ['me-workspaces'], queryFn: fetchWorkspaces })
}

/** Remember a workspace as active, then open it. Shared by the switcher and the chooser. */
export function useOpenWorkspace() {
  const router = useRouter()
  const queryClient = useQueryClient()
  return async (ws: SwitcherWorkspace) => {
    const res = await fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: ws.slug }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(`Could not switch to ${ws.name}`, { description: body.error })
      throw new Error(body.error ?? 'switch failed')
    }
    await queryClient.invalidateQueries()
    router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
  }
}

export function WorkspaceSwitcher() {
  const router = useRouter()
  const { data: workspaces } = useMyWorkspaces()
  const { data: active } = useActiveWorkspace()
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()

  return (
    <>
      <SharedSwitcher
        workspaces={workspaces ?? []}
        current={active?.slug ?? null}
        onSelect={open}
        onCreate={() => setCreating(true)}
        onManage={(ws) => router.push(`/dashboard/${encodeURIComponent(ws.slug)}/settings`)}
      />
      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
