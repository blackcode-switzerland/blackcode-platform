'use client'

// Workspace settings — `/dashboard/{ws}/settings`. Name, members, invitations,
// and the danger zone (or, for a member, leave).
//
// ── THE SECTIONS ARE SHARED SINCE 2026-09-28 ────────────────────────────────
// This page was the model for `@blackcode/platform-ui/workspace/
// workspace-settings`, which all four apps now render; what stays here is the
// wiring — one route per control, each with its `bk billing …` spelling:
//
//   rename            PATCH  /api/workspaces/{ws}                workspace edit --name
//   make owner        POST   …/transfer                          workspace transfer --to <id>
//   remove / leave    DELETE …/members/{userId}                  member remove <id>
//   invite            POST   …/invitations  (+ candidates)       invite send | candidates
//   delete            DELETE /api/workspaces/{ws}                workspace delete <slug> --confirm <slug>
//
// ── THE SLUG IS NOT EDITABLE, AND DELETE IS USUALLY REFUSED ─────────────────
// The slug is in every URN this app has printed; the route answers 400
// `slug_immutable`. And a workspace that has ever had a company cannot be
// deleted — company, invoice, audit, series and imported-bill rows are kept for
// ten years (art. 958f CO) and the database refuses the cascade. The danger zone
// reads `GET …/companies?include_retired=1` to say so BEFORE anyone types the
// slug; the route's 409 `workspace_retained` is still the authority.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  WorkspaceDangerSection,
  WorkspaceGeneralSection,
  WorkspaceInvitationsSection,
  WorkspaceLeaveSection,
  WorkspaceMembersSection,
} from '@blackcode/platform-ui/workspace/workspace-settings'
import { APP_NAME } from '@/lib/app'
import { useCompanies, useInvitations, useInviteCandidates, useMembers, useWorkspace } from '@/lib/queries'
import {
  toastError,
  useCreateInvitation,
  useDeleteWorkspace,
  useRemoveMember,
  useRenameWorkspace,
  useRevokeInvitation,
  useTransferWorkspace,
} from '@/lib/mutations'
import { ErrorState, LoadingState } from '@/components/ui-kit'

function Cmd({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{children}</code>
}

/** Run a write; on failure show it and rethrow, so the shared section knows. */
async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    toastError(e)
    throw e
  }
}

export function WorkspaceSettings({ ws, isOwner, userId }: { ws: string; isOwner: boolean; userId: number }) {
  const router = useRouter()
  const workspace = useWorkspace(ws)
  const members = useMembers(ws)
  const invitations = useInvitations(ws, { enabled: isOwner })
  const candidates = useInviteCandidates(ws)
  const companies = useCompanies(ws, { include_retired: true })

  const rename = useRenameWorkspace(ws)
  const transfer = useTransferWorkspace(ws)
  const remove = useRemoveMember(ws)
  const createInvitation = useCreateInvitation(ws)
  const revokeInvitation = useRevokeInvitation(ws)
  const del = useDeleteWorkspace(ws)

  if (workspace.isPending) return <LoadingState variant="detail" />
  if (workspace.error) return <ErrorState error={workspace.error} retry={workspace.refetch} />

  const w = workspace.data.workspace
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy — select the link and copy it by hand')
    )

  // Every retained table needs a company to exist (invoice, series, imported
  // bill and audit rows all hang off one), so "has ever had a company" is the
  // whole question. Retired companies count: they are kept too.
  const refusal = companies.error
    ? null
    : companies.data === undefined
      ? undefined
      : companies.data.length > 0
        ? `This workspace can’t be deleted because it holds ${
            companies.data.length === 1 ? 'a company' : `${companies.data.length} companies`
          }. Companies, their invoices and the audit trail are kept for ten years (art. 958f CO), so nothing in ${APP_NAME} is ever hard-deleted. To stop using it, retire its companies, or make another member the owner.`
        : null

  return (
    <div className="space-y-6">
      <WorkspaceGeneralSection
        workspace={w}
        role={workspace.data.role}
        canEdit={isOwner}
        onRename={async (name) => {
          await attempt(() => rename.mutateAsync({ name }))
          toast.success('Workspace renamed')
          // The sidebar's switcher is loaded server-side.
          router.refresh()
        }}
      />

      <WorkspaceMembersSection
        members={members.data}
        error={members.error ? <ErrorState error={members.error} retry={members.refetch} /> : undefined}
        currentUserId={userId}
        ownerId={w.owner_id}
        isOwner={isOwner}
        labels={{ removeDescription: 'They lose access immediately. Invoices they created stay, and stay attributed to them.' }}
        onTransfer={async (m) => {
          await attempt(() => transfer.mutateAsync({ new_owner_user_id: m.user_id }))
          toast.success(`${m.name ?? m.email} is now the owner`)
          router.refresh()
        }}
        onRemove={async (m) => {
          await attempt(() => remove.mutateAsync({ userId: m.user_id }))
          toast.success(`${m.name ?? m.email} removed`)
        }}
        footer={
          <>
            Same as <Cmd>bk billing member list</Cmd>, <Cmd>bk billing member remove &lt;user_id&gt;</Cmd> and{' '}
            <Cmd>bk billing workspace transfer --to &lt;user_id&gt;</Cmd>.
          </>
        }
      />

      {isOwner && (
        <WorkspaceInvitationsSection
          invitations={invitations.data}
          error={invitations.error ? <ErrorState error={invitations.error} retry={invitations.refetch} /> : undefined}
          candidates={candidates.data}
          labels={{ colleagues: `People you already work with in ${APP_NAME}` }}
          onCopy={copy}
          onInvite={async (email) => {
            const result = await attempt(() => createInvitation.mutateAsync({ email }))
            if (result.email_sent) toast.success(`Invitation emailed to ${email}`)
            else
              toast.success(`Invitation created for ${email}`, {
                description: 'The email could not be sent from here — copy the link below and send it yourself.',
              })
            return result.accept_url
          }}
          onRevoke={async (inv) => {
            await attempt(() => revokeInvitation.mutateAsync({ id: inv.id }))
            toast.success('Invitation revoked')
          }}
          footer={
            <>
              Same as <Cmd>bk billing invite send &lt;email&gt;</Cmd>. The invitee accepts on the link, or with{' '}
              <Cmd>bk billing invite accept &lt;token&gt;</Cmd>.
            </>
          }
        />
      )}

      {isOwner ? (
        <WorkspaceDangerSection
          name={w.name}
          slug={w.slug}
          refusal={refusal}
          detail="Nothing has been issued from this workspace, so it can still be deleted — with its members and invitations."
          onDelete={async () => {
            await attempt(() => del.mutateAsync(undefined))
            toast.success(`${w.name} deleted`)
            router.push('/dashboard')
            router.refresh()
          }}
          footer={
            <>
              Same as <Cmd>bk billing workspace delete {w.slug} --confirm {w.slug}</Cmd>.
            </>
          }
        />
      ) : (
        <WorkspaceLeaveSection
          name={w.name}
          detail="Invoices you created stay in the workspace, attributed to you."
          onLeave={async () => {
            await attempt(() => remove.mutateAsync({ userId }))
            toast.success(`You left ${w.name}`)
            router.push('/dashboard')
            router.refresh()
          }}
          footer={
            <>
              Same as <Cmd>bk billing member remove {userId}</Cmd>.
            </>
          }
        />
      )}
    </div>
  )
}
