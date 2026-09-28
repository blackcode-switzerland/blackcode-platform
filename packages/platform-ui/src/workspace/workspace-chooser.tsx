'use client'

// `/dashboard` for somebody in more than one workspace who has not chosen one
// yet — one list for every app (2026-09-28).
//
// Choosing goes through `onSelect`, which REMEMBERS the choice (POST
// /api/me/active-workspace) before navigating. apps/billing's chooser said
// "this choice is remembered" over plain links that remembered nothing; routing
// the click through the same callback as the switcher is what makes the
// sentence true.

import { useState } from 'react'
import { ChevronRight, Loader2, Plus } from 'lucide-react'
import { WorkspaceMark } from './workspace-mark'
import { withDefaults, type WorkspaceLabels } from './labels'
import { roleLine, type SwitcherWorkspace } from './workspace-switcher'

export function WorkspaceChooser({
  workspaces,
  onSelect,
  onCreate,
  labels,
}: {
  workspaces: SwitcherWorkspace[]
  onSelect: (ws: SwitcherWorkspace) => Promise<void>
  onCreate?: () => void
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const [pending, setPending] = useState<string | null>(null)

  async function choose(ws: SwitcherWorkspace) {
    setPending(ws.slug)
    try {
      await onSelect(ws)
    } catch {
      setPending(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16" data-testid="workspace-chooser">
      <h1 className="text-xl font-semibold tracking-tight">{L.chooserTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{L.chooserDescription}</p>
      <ul className="mt-6 space-y-2">
        {workspaces.map((ws) => (
          <li key={ws.id}>
            <button
              type="button"
              onClick={() => void choose(ws)}
              disabled={pending !== null}
              data-testid={`workspace-${ws.slug}`}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:opacity-60"
            >
              <WorkspaceMark name={ws.name} logoUrl={ws.logo_url} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{ws.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {roleLine(ws, L)} · <span className="font-mono">{ws.slug}</span>
                </span>
              </span>
              {pending === ws.slug ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          data-testid="new-workspace"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus size={15} />
          {L.createWorkspace}
        </button>
      )}
    </div>
  )
}
