'use client'

// `/dashboard/workspaces` — every workspace you belong to, as the shared
// chooser (since 2026-09-28). It was this app's own list page, the one the
// sidebar switcher linked to; the switcher is a dropdown now, as in every app,
// and this page is what "choose a workspace" looks like everywhere.
//
// `?new=1` opens the create modal over it (the old `/dashboard/workspaces/new`
// page redirects here).

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { WorkspaceChooser } from '@blackcode/platform-ui/workspace/workspace-chooser'
import { useMyWorkspaces, useOpenWorkspace } from '@/components/workspace-switcher'
import { CreateWorkspaceModal } from '@/components/workspace-create-modal'

export function WorkspacesView() {
  const params = useSearchParams()
  const { data: workspaces } = useMyWorkspaces()
  const [creating, setCreating] = useState(params?.get('new') === '1')
  const open = useOpenWorkspace()

  return (
    <>
      {workspaces && (
        <WorkspaceChooser
          workspaces={workspaces}
          onSelect={open}
          onCreate={() => setCreating(true)}
          labels={{ chooserTitle: 'Workspaces', chooserDescription: 'Every workspace you belong to. Open one, or create another.' }}
        />
      )}
      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
