'use client'

// Workspace settings — `/dashboard/{ws}/settings`: the workspace, its members
// and invitations, and the danger zone (or, for a member, leave).
//
// ── THE SECTIONS ARE SHARED SINCE 2026-09-28 ────────────────────────────────
// `@blackcode/platform-ui/workspace/workspace-settings` — the same sections all
// four apps render. Members and invitations used to be a separate page
// (`/dashboard/{ws}/members`, which now redirects here); they are sections of
// this one, as in apps/billing and apps/books. What changed on the way:
//
//   - removing a member and revoking an invitation ASK FIRST (they did not);
//   - a member can LEAVE (there was no way out short of asking the owner) —
//     the route now accepts a member removing themselves, as apps/billing's does;
//   - delete asks for the SLUG, typed, like every app (this page asked for the
//     name);
//   - the slug is shown, read-only, with why it is fixed.
//
// ---------------------------------------------------------------------------
// TWO KINDS OF WRITE LIVE HERE, AND THEY ARE GATED DIFFERENTLY — ON PURPOSE
// ---------------------------------------------------------------------------
// TENANCY — rename, transfer, delete, leave — calls `apiSend` directly and is
// NOT behind `useCanWrite()`. `lib/read-only.test.ts` declares this file in
// `ACCOUNT_WRITERS` with `workspaceScoped` set: a read-only display preference
// that could stop an owner renaming or deleting their own workspace, or a
// member leaving one, would be a permission over the account (D-7).
//
// MEMBERSHIP RECORDS — remove somebody else, invite, revoke — are
// `sales.workspace_members` / `sales.invitations` rows and go through
// `lib/mutations.ts` behind `useCanWrite()`. In read-only mode those
// affordances are hidden and `READ_ONLY_NOTE` says why, the way every other
// write affordance in this app behaves.
//
// NO LOGO — `sales.workspaces` has no `logo_url` column (yet).
//
// NO `bk sales …` HINTS under the sections, unlike apps/billing and apps/books:
// in this app ordinary UI copy names no CLI command (`lib/ui-commands.test.ts`).

import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SettingsSection,
  WorkspaceDangerSection,
  WorkspaceGeneralSection,
  WorkspaceInvitationsSection,
  WorkspaceLeaveSection,
  WorkspaceMembersSection,
} from '@blackcode/platform-ui/workspace/workspace-settings'
import { apiGet, apiSend, wsPath } from '@/lib/client'
import { useInviteMember, useRemoveMember, useRevokeInvitation } from '@/lib/mutations'
import { useCanWrite, READ_ONLY_NOTE } from '@/lib/ui-mode'
import { BlockSkeleton, ErrorState } from '@/components/states'

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  role: string
  deleted_at: string | null
}

interface WorkspaceDetail {
  workspace: { id: number; name: string; slug: string; owner_id: number }
  role: 'owner' | 'member'
  members: Member[]
}

interface Invitation {
  id: number
  email: string
  token: string
  invited_by_name: string | null
  invited_by_email: string | null
  expires_at: string
}

interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  from_platform: boolean
}

export function WorkspaceSettings({ ws, isOwner, meId }: { ws: string; isOwner: boolean; meId: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const canWrite = useCanWrite(ws)

  const detail = useQuery({
    queryKey: ['workspace-detail', ws],
    queryFn: () => apiGet<WorkspaceDetail>(wsPath(ws, '')),
  })
  // Both lists answer `{ data, next_cursor }` — unwrap, never cast (see
  // `workspace-settings-envelope.test.ts` for what casting it cost).
  const invitations = useQuery({
    queryKey: ['invitations', ws],
    enabled: isOwner,
    queryFn: async () => (await apiGet<{ data: Invitation[] }>(wsPath(ws, '/invitations'))).data,
  })
  const candidates = useQuery({
    queryKey: ['invite-candidates', ws],
    enabled: isOwner,
    queryFn: async () => (await apiGet<{ data: InviteCandidate[] }>(wsPath(ws, '/invite-candidates'))).data,
  })

  const invite = useInviteMember(ws)
  const revoke = useRevokeInvitation(ws)
  const removeMember = useRemoveMember(ws)

  /** A tenancy write: toast the failure and rethrow, so the shared section knows. */
  const tenancy = <T,>(fn: () => Promise<T>) =>
    fn().catch((e: Error) => {
      toast.error(e.message)
      throw e
    })

  const rename = useMutation({ mutationFn: (name: string) => apiSend('PATCH', wsPath(ws, ''), { name }) })
  const transfer = useMutation({
    mutationFn: (userId: number) => apiSend('POST', wsPath(ws, '/transfer'), { new_owner_user_id: userId }),
  })
  const del = useMutation({ mutationFn: () => apiSend('DELETE', wsPath(ws, '')) })
  const leave = useMutation({ mutationFn: () => apiSend('DELETE', wsPath(ws, `/members/${meId}`)) })

  if (detail.isPending) return <BlockSkeleton rows={3} />
  if (detail.isError) return <ErrorState error={detail.error} />
  if (!detail.data) return null

  const { workspace: w, members } = detail.data
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success('Invite link copied'),
      () => toast.error('Could not copy — select the link and copy it by hand')
    )

  return (
    <div className="space-y-6">
      <WorkspaceGeneralSection
        workspace={w}
        role={detail.data.role}
        canEdit={isOwner}
        onRename={async (name) => {
          await tenancy(() => rename.mutateAsync(name))
          toast.success('Workspace updated')
          await queryClient.invalidateQueries()
          router.refresh()
        }}
      />

      <WorkspaceMembersSection
        members={members}
        currentUserId={meId}
        ownerId={w.owner_id}
        isOwner={isOwner && canWrite}
        labels={{
          removeDescription:
            'They lose access to this pipeline immediately. Their account is shared across blackcode apps and stays open.',
        }}
        onTransfer={async (m) => {
          await tenancy(() => transfer.mutateAsync(m.user_id))
          toast.success(`${m.name ?? m.email} is now the owner`)
          await queryClient.invalidateQueries()
          router.refresh()
        }}
        onRemove={async (m) => {
          await removeMember.mutateAsync({ userId: m.user_id, email: m.email })
          await queryClient.invalidateQueries({ queryKey: ['workspace-detail', ws] })
        }}
      />

      {isOwner &&
        (canWrite ? (
          <WorkspaceInvitationsSection
            invitations={invitations.data}
            error={invitations.isError ? <ErrorState error={invitations.error} /> : undefined}
            candidates={candidates.data}
            labels={{ colleagues: 'People you already work with in b/sales' }}
            onCopy={copy}
            // `useInviteMember` toasts whether the email actually went.
            onInvite={async (email) => (await invite.mutateAsync({ email }))?.accept_url ?? null}
            onRevoke={async (inv) => {
              await revoke.mutateAsync({ id: inv.id })
            }}
          />
        ) : (
          <SettingsSection title="Invitations">
            <p className="text-sm text-muted-foreground">{READ_ONLY_NOTE}</p>
          </SettingsSection>
        ))}

      {isOwner ? (
        <WorkspaceDangerSection
          name={w.name}
          slug={w.slug}
          refusal={null}
          detail="This permanently deletes the workspace and everything in it — prospects, meetings, communications and documents. It cannot be undone."
          onDelete={async () => {
            await tenancy(() => del.mutateAsync())
            toast.success('Workspace deleted')
            await queryClient.invalidateQueries()
            // Same destination `/dashboard` resolves to with no active workspace
            // — it re-derives where to go from the memberships that are left.
            router.push('/dashboard')
            router.refresh()
          }}
        />
      ) : (
        <WorkspaceLeaveSection
          name={w.name}
          detail="What you logged stays in the pipeline, attributed to you. The owner can invite you back."
          onLeave={async () => {
            await tenancy(() => leave.mutateAsync())
            toast.success(`You left ${w.name}`)
            router.push('/dashboard')
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
