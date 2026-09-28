'use client'

// "Create workspace" — one modal for every app (2026-09-28).
//
// A name and nothing else: the slug is derived by the server (and never
// changes afterwards), and a logo is set in the workspace's settings once it
// exists. `onCreate` is the app's — it POSTs /api/workspaces, remembers the new
// workspace as active, shows its own toast and navigates. Throw to keep the
// modal open; the error is the app's to show.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../ui/modal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { withDefaults, type WorkspaceLabels } from './labels'

/** Every app's `workspaces.name` is varchar(80), and each route enforces it. */
export const WORKSPACE_NAME_MAX = 80

export function CreateWorkspaceModal({
  open,
  onClose,
  onCreate,
  defaultName = '',
  dismissible = true,
  labels,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
  defaultName?: string
  /** False for a first workspace that must exist before anything else can. */
  dismissible?: boolean
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setName(defaultName)
  }, [open, defaultName])

  const trimmed = name.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onCreate(trimmed)
      onClose()
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={L.createTitle} description={L.createDescription} dismissible={dismissible}>
      <form onSubmit={submit} className="space-y-4 p-5" data-testid="create-workspace-form">
        <div className="space-y-1.5">
          <label htmlFor="create-workspace-name" className="block text-xs font-medium text-muted-foreground">
            {L.nameLabel}
          </label>
          <Input
            id="create-workspace-name"
            autoFocus
            required
            maxLength={WORKSPACE_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={L.namePlaceholder}
            data-testid="input-workspace-name"
          />
        </div>
        <div className="flex justify-end gap-2">
          {dismissible && (
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {L.cancel}
            </Button>
          )}
          <Button type="submit" disabled={!trimmed || busy} data-testid="submit-create-workspace">
            {busy && <Loader2 className="animate-spin" />}
            {busy ? L.creating : L.createWorkspace}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
