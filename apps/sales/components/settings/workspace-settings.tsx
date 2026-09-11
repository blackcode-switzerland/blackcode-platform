'use client'

// Workspace settings — `sales.workspaces`. New 2026-09-11 with the D-3
// reversal: rename (name only), transfer ownership, delete.
//
// ---------------------------------------------------------------------------
// THIS IS TENANCY ADMINISTRATION, NOT A SALES RECORD — SO IT BYPASSES
// `lib/mutations.ts` ON PURPOSE
// ---------------------------------------------------------------------------
// Every mutation in this file calls `apiSend` directly, the same way
// `components/workspace-switcher.tsx` calls `POST /api/me/active-workspace`
// directly. `lib/read-only.test.ts` gates this file the same way: it is
// declared in `ACCOUNT_WRITERS` with `workspaceScoped` set, because renaming,
// transferring or deleting the workspace itself is exactly the class of thing
// `ui_mode` exists to gate for a sales RECORD (a prospect, a meeting) and
// exactly the class of thing D-7 says it must NOT gate for the account/tenancy
// layer. A read-only display preference that could stop an owner renaming or
// deleting their own workspace would be a permission over the account, not a
// preference about the pipeline.
//
// ---------------------------------------------------------------------------
// NO LOGO, NO STORAGE LINK — UNLIKE `apps/issues/components/workspace-settings-view.tsx`
// ---------------------------------------------------------------------------
// `sales.workspaces` has no `logo_url` column (see the schema file) and this
// app mounts no `/storage` route (`cli/internal/commands/sales/appverbs.go`'s
// header explains why) — both sections are simply absent rather than disabled,
// the same rule this app applies everywhere a capability does not exist.
//
// ---------------------------------------------------------------------------
// SLUG IS NOT SHOWN AS AN EDITABLE FIELD
// ---------------------------------------------------------------------------
// It is immutable server-side (`PATCH` 400s `slug_immutable`) — see
// `app/api/workspaces/[ws]/route.ts` and `lib/db/queries/workspaces.ts`'s
// `updateWorkspace` for the full reasoning (sales.events.subject_urn has no
// rename cascade, unlike issues' platform.entities projection). Rendering a
// disabled slug field here would invite a bug report about a field that was
// never going to work; the slug simply is not offered.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Save, Trash2 } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { apiGet, apiSend, wsPath } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'

// NOT imported from `@/lib/limits` — see the identical constant and comment in
// `components/workspace-create-modal.tsx` for why: that file's barrel import of
// `@blackcode/platform-api` pulls the `pg` driver into the client bundle, and
// this is the other of the two client components in this app that hit it.
// Server-side enforcement (`PATCH /api/workspaces/{ws}`) imports the real
// constant; this is UX polish only.
const WORKSPACE_NAME_MAX = 80
import { Section } from './profile-settings'

interface Workspace {
  id: number
  name: string
  slug: string
  owner_id: number
}

interface Member {
  user_id: number
  email: string
  name: string | null
  role: string
}

interface WorkspaceDetail {
  workspace: Workspace
  role: 'owner' | 'member'
  members: Member[]
}

export function WorkspaceSettings({ ws, isOwner }: { ws: string; isOwner: boolean }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()

  const detail = useQuery({
    queryKey: ['workspace-detail', ws],
    queryFn: () => apiGet<WorkspaceDetail>(wsPath(ws, '')),
  })

  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Seeded ONCE, same reason `ProfileSettings` seeds once: re-seeding on every
  // render of fresh data would overwrite what somebody is typing the moment a
  // background refetch lands.
  useEffect(() => {
    if (detail.data && !loaded) {
      setName(detail.data.workspace.name)
      setSavedName(detail.data.workspace.name)
      setLoaded(true)
    }
  }, [detail.data, loaded])

  const isDirty = name.trim() !== savedName

  const save = useMutation({
    mutationFn: async (newName: string) =>
      apiSend<Workspace>('PATCH', wsPath(ws, ''), { name: newName }),
    onSuccess: (updated) => {
      toast.success('Workspace updated')
      setSavedName(updated.name)
      queryClient.invalidateQueries({ queryKey: ['workspace-detail', ws] })
      queryClient.invalidateQueries()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const transfer = useMutation({
    mutationFn: async (newOwnerUserId: number) =>
      apiSend('POST', wsPath(ws, '/transfer'), { new_owner_user_id: newOwnerUserId }),
    onSuccess: () => {
      toast.success('Ownership transferred')
      queryClient.invalidateQueries()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => apiSend('DELETE', wsPath(ws, '')),
    onSuccess: () => {
      toast.success('Workspace deleted')
      queryClient.invalidateQueries()
      // Same destination `/dashboard` resolves to with no active workspace —
      // it re-derives where to go from the memberships that are left.
      router.push('/dashboard')
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (detail.isPending) return <BlockSkeleton rows={3} />
  if (detail.isError) return <ErrorState error={detail.error} />
  if (!detail.data) return null

  const { workspace, members } = detail.data
  const otherMembers = members.filter((m) => m.user_id !== workspace.owner_id)

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <Section title={workspace.name} note={`You are a member of ${workspace.name}.`}>
          <p className="text-sm text-muted-foreground">
            Only the owner can rename this workspace, transfer ownership, or delete it.
          </p>
        </Section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Section title="Workspace" note={`You own ${workspace.name}.`}>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={WORKSPACE_NAME_MAX}
              className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary"
            />
          </div>
          {isDirty && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={save.isPending || !name.trim()}
                onClick={() => save.mutate(name.trim())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save size={14} />
                Save changes
              </button>
            </div>
          )}
        </div>
      </Section>

      {otherMembers.length > 0 && (
        <Section
          title="Transfer ownership"
          note="The current owner becomes a regular member after the transfer."
        >
          <select
            onChange={async (e) => {
              const v = parseInt(e.target.value, 10)
              e.currentTarget.value = ''
              if (Number.isNaN(v)) return
              const target = otherMembers.find((m) => m.user_id === v)
              if (
                !(await confirm({
                  title: 'Transfer ownership?',
                  description: `${target?.name ?? target?.email ?? 'This member'} becomes the owner. This cannot be undone without their cooperation.`,
                  destructive: true,
                  confirmLabel: 'Transfer',
                }))
              )
                return
              transfer.mutate(v)
            }}
            defaultValue=""
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Pick a new owner…
            </option>
            {otherMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </Section>
      )}

      <Section title="Danger zone">
        <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle size={14} />
              Delete workspace
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Permanently deletes {workspace.name} and everything in it — prospects, meetings,
              communications, products, templates, documents. This cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              const typed = await prompt({
                title: 'Delete workspace?',
                description: 'This permanently deletes the workspace and all its data.',
                inputLabel: `Type "${workspace.name}" to confirm`,
                placeholder: workspace.name,
                requireMatch: workspace.name,
                destructive: true,
                confirmLabel: 'Delete workspace',
              })
              if (typed === workspace.name) remove.mutate()
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </Section>
    </div>
  )
}
