'use client'

// `/dashboard` for somebody in more than one workspace who has not chosen one
// yet: the shared chooser, wired to this app's writes and words. Choosing is
// remembered (`books.user_settings`), so it is asked once.

import { useState } from 'react'
import { WorkspaceChooser } from '@blackcode/platform-ui/workspace/workspace-chooser'
import type { SwitcherWorkspace } from '@blackcode/platform-ui/workspace/workspace-switcher'
import { CreateWorkspaceModal } from '@blackcode/platform-ui/workspace/create-workspace-modal'
import { useCreateAndOpenWorkspace, useOpenWorkspace } from './workspace-switcher'
import { useWorkspaceLabels } from './labels'

export function BooksWorkspaceChooser({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const labels = useWorkspaceLabels()
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()
  const createAndOpen = useCreateAndOpenWorkspace()
  return (
    <>
      <WorkspaceChooser workspaces={workspaces} onSelect={open} onCreate={() => setCreating(true)} labels={labels} />
      <CreateWorkspaceModal open={creating} onClose={() => setCreating(false)} onCreate={createAndOpen} labels={labels} />
    </>
  )
}
