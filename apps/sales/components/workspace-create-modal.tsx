'use client'

// The "create workspace" modal — reachable from the sidebar switcher.
//
// ── SALES' OWN, NOT A COPY OF `apps/issues/components/workspace-create-modal.tsx`
// ── ────────────────────────────────────────────────────────────────────────
// Two real differences, not a copy-paste with the serial numbers filed off:
//
//   1. No logo field. `sales.workspaces` has no `logo_url` column (see the
//      schema file at `salesWorkspaces` for why) — there is no field to send.
//   2. Sales density (D-4): roomier `py-3` fields and a `py-2` primary button,
//      matching this app's existing form conventions, not issues' tighter
//      `py-1.5`/`h-11`.
//
// ── WHY THIS CALLS `apiSend` DIRECTLY RATHER THAN GOING THROUGH `lib/mutations.ts`
// ── ────────────────────────────────────────────────────────────────────────
// Creating a workspace is TENANCY ADMINISTRATION, not a sales record write —
// the same class of thing `components/workspace-switcher.tsx` already carries
// an `ACCOUNT_WRITERS` entry for (switching which workspace you look at). A
// read-only display preference that could stop somebody creating a workspace
// they will own would make it a permission over their account rather than over
// the pipeline (D-7). `lib/read-only.test.ts` allows this file by name for
// exactly that reason.
//
// `POST /api/workspaces` — no trailing slash after "workspaces" — does not
// match that test's `WORKSPACE_PATH` regex (it requires either a trailing
// slash or a `wsPath(` call), so this file needs no `workspaceScoped`
// declaration; only the switcher/settings module writing
// `/api/workspaces/{ws}` does.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { apiSend } from '@/lib/client'

// NOT imported from `@/lib/limits` — that file's `WORKSPACE_NAME_MAX` re-export
// pulls the whole `@blackcode/platform-api` barrel (including its server-only
// `event-source.ts`, which imports the `pg` driver) into the CLIENT bundle the
// moment anything in this app imports it from a 'use client' component. This
// modal and `components/settings/workspace-settings.tsx` are the first two
// client components in this app to want a limit from that file, and hitting
// that landmine is what found it: `next build` failed with
// `Module not found: Can't resolve 'tls'`, traced through `lib/limits.ts` into
// `pg/lib/stream.js`. `apps/issues/components/workspace-create-modal.tsx` hits
// the same shape and hardcodes `80` for the same reason — the actual
// ENFORCEMENT is server-side, in `POST /api/workspaces`, which does import the
// real constant; this is UX polish (stop the keystroke early) and 80 is what it
// mirrors. If `lib/limits.ts` ever splits its platform re-exports into a
// client-safe subpath, both these hardcodes should go back to importing it.
const WORKSPACE_NAME_MAX = 80

interface CreatedWorkspace {
  id: number
  name: string
  slug: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the created workspace after it has been set active. */
  onCreated?: (ws: CreatedWorkspace) => void
}

export function WorkspaceCreateModal({ open, onClose, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Enter a workspace name')
      return
    }
    setLoading(true)
    try {
      const ws = await apiSend<CreatedWorkspace>('POST', '/api/workspaces', { name: trimmed })
      // Same two-step flow `apps/issues`' create modal uses: create, then set
      // active, so the workspace you just made is the one you land in rather
      // than the one you happened to be looking at before.
      await apiSend('POST', '/api/me/active-workspace', { workspace_id: ws.id })
      toast.success(`Created ${ws.name}`)
      await queryClient.invalidateQueries()
      setName('')
      onCreated?.(ws)
      onClose()
      router.push(`/dashboard/${ws.slug}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create workspace')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create workspace"
      description="A separate pipeline — its own prospects, meetings and team."
    >
      <form onSubmit={create} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={WORKSPACE_NAME_MAX}
            placeholder="Acme Sales"
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Create workspace
          </button>
        </div>
      </form>
    </Modal>
  )
}
