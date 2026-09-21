'use client'

// The workspace-creation write — `POST /api/workspaces`, the same route
// `bk billing workspace create` calls. Not a server action, deliberately: a
// server action here would be a capability the CLI could not reach and the
// parity guard could not see.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { useCreateWorkspace, toastError } from '@/lib/mutations'

export function CreateWorkspaceForm({ onCreated }: { onCreated?: (slug: string) => void }) {
  const [name, setName] = useState('')
  const router = useRouter()
  const createWorkspace = useCreateWorkspace()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const ws = await createWorkspace.mutateAsync({ name: name.trim() })
      toast.success(`Workspace "${ws.name}" created`)
      if (onCreated) {
        onCreated(ws.slug)
      } else {
        router.push(`/dashboard/${ws.slug}`)
        router.refresh()
      }
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="create-workspace-form">
      <div>
        <label htmlFor="ws-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Workspace name
        </label>
        <input
          id="ws-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme SA"
          maxLength={80}
          required
          data-testid="input-workspace-name"
          className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25"
        />
      </div>
      <button
        type="submit"
        disabled={createWorkspace.isPending || name.trim().length === 0}
        data-testid="submit-create-workspace"
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {createWorkspace.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Plus size={14} />
        )}
        Create workspace
      </button>
    </form>
  )
}
