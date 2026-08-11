'use client'

// Shown when a signed-in user has zero workspaces. Reuses the shared workspace
// creation modal (rendered inline, always open) for consistency.

import Image from 'next/image'
import { WorkspaceCreateModal } from './workspace-create-modal'

export function OnboardingCreateWorkspace({ defaultName }: { defaultName: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-6 flex items-center gap-2.5">
        {/* rounded-md, like every other render of this mark in both apps — the
            radius is a constant 6px at every size, not a proportion. */}
        <Image src="/logo.png" alt="blackcode issues" width={32} height={32} className="rounded-md" />
        <span className="font-bold">blackcode issues</span>
      </div>
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        Welcome! Create your first workspace to start adding projects, tasks, and issues.
      </p>
      {/* Always-open modal; no close affordance since a workspace is required. */}
      <WorkspaceCreateModal open dismissible={false} onClose={() => {}} defaultName={defaultName} />
    </main>
  )
}
