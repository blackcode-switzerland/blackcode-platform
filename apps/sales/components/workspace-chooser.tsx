'use client'

// `/dashboard` for somebody in more than one workspace with nothing remembered:
// the shared chooser (2026-09-28). Choosing now REMEMBERS — this page's old list
// said "this choice is remembered" over plain links that wrote nothing.
//
// No apiSend here: remembering goes through `useOpenWorkspace` in
// `workspace-switcher.tsx`, the module `lib/read-only.test.ts` already allows
// to write `POST /api/me/active-workspace`.

import { useState } from 'react'
import { WorkspaceChooser } from '@blackcode/platform-ui/workspace/workspace-chooser'
import { useOpenWorkspace, type SwitcherWorkspace } from './workspace-switcher'
import { WorkspaceCreateModal } from './workspace-create-modal'

export function SalesWorkspaceChooser({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()
  return (
    <>
      <WorkspaceChooser workspaces={workspaces} onSelect={open} onCreate={() => setCreating(true)} />
      <WorkspaceCreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
