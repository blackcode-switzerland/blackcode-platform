'use client'

// `/dashboard` for somebody in more than one workspace with no remembered
// choice: the shared chooser (2026-09-28). Choosing is REMEMBERED now — this
// page's old list said "this choice is remembered" over plain links that wrote
// nothing, and read a column this app never writes.

import { useState } from 'react'
import { WorkspaceChooser } from '@blackcode/platform-ui/workspace/workspace-chooser'
import { useOpenWorkspace, type SwitcherWorkspace } from '@/components/shell/workspace-switcher'
import { WorkspaceCreateModal } from '@/components/workspace-create-modal'

export function BillingWorkspaceChooser({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()
  return (
    <>
      <WorkspaceChooser workspaces={workspaces} onSelect={open} onCreate={() => setCreating(true)} />
      <WorkspaceCreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
