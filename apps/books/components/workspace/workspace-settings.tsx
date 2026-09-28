'use client'

// Workspace settings — `/dashboard/{ws}/settings`. On screen since 2026-09-28,
// when decision D-C (no workspace, no members, no invitations on screen) was
// reversed so all four blackcode apps manage workspaces the same way.
//
// The sections are the shared ones (`@blackcode/platform-ui/workspace/
// workspace-settings`); this file wires each to a route `bk books` also calls:
//
//   rename            PATCH  /api/workspaces/{ws}           workspace edit --name
//   make owner        POST   …/transfer                     workspace transfer --to <id>
//   remove / leave    DELETE …/members/{userId}             member remove <id>
//   invite / revoke   POST / DELETE …/invitations           invite send | revoke
//   delete            DELETE /api/workspaces/{ws}           workspace delete <slug> --confirm <slug>
//
// Every write goes through `lib/mutations.ts` (the read-only guard's rule), and
// the words come from `lib/dictionary/workspace.ts`.
//
// ── DELETE IS USUALLY REFUSED, AND THE PAGE SAYS SO FIRST ──────────────────
// A workspace that has held books cannot be deleted (art. 958f CO; the route's
// 409 `workspace_retained` is the authority, and `deleteWorkspace` explains why
// the check is made in code). The danger zone reads the book list to say so
// BEFORE anybody types the slug. A workspace with no book but some other record
// (a source, a piece) still shows the button, and the route's refusal — shown
// as a toast — is then the answer.

import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  WorkspaceDangerSection,
  WorkspaceGeneralSection,
  WorkspaceInvitationsSection,
  WorkspaceLeaveSection,
  WorkspaceMembersSection,
} from '@blackcode/platform-ui/workspace/workspace-settings'
import { useEntities, useInvitations, useInviteCandidates, useWorkspaceDetail } from '@/lib/hooks'
import {
  useCreateInvitation,
  useDeleteWorkspace,
  useRemoveMember,
  useRenameWorkspace,
  useRevokeInvitation,
  useTransferWorkspace,
} from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import { date } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { WORKSPACE_CLI } from '@/lib/workspace-cli'
import { ErrorState } from '@/components/states'
import { useWorkspaceLabels } from './labels'

function Cmd({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
}

/** A sentence with `{cmd}`-style holes, each filled by a <Cmd>. */
function WithCommands({ text, commands }: { text: string; commands: Record<string, string> }) {
  const parts = text.split(/(\{[a-z]+\})/g)
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{([a-z]+)\}$/.exec(p)
        return m && commands[m[1]] ? <Cmd key={i}>{commands[m[1]]}</Cmd> : <span key={i}>{p}</span>
      })}
    </>
  )
}

export function BooksWorkspaceSettings({ ws, userId }: { ws: string; userId: number }) {
  const t = useT()
  const L = useWorkspaceLabels()
  const router = useRouter()
  const queryClient = useQueryClient()

  const detail = useWorkspaceDetail(ws)
  const isOwner = detail.data?.role === 'owner'
  const invitations = useInvitations(ws, isOwner)
  const candidates = useInviteCandidates(ws, isOwner)
  const books = useEntities(ws)

  const rename = useRenameWorkspace(ws)
  const transfer = useTransferWorkspace(ws)
  const removeMember = useRemoveMember(ws)
  const invite = useCreateInvitation(ws)
  const revoke = useRevokeInvitation(ws)
  const del = useDeleteWorkspace(ws)

  const refresh = async () => {
    await queryClient.invalidateQueries(booksCacheFilter())
    // The sidebar's switcher list is loaded on the server.
    router.refresh()
  }

  /** Throw the failure after showing it, so the shared component knows it did not work. */
  function check<T>(res: { ok: true; data: T } | { ok: false; message: string; error: Error }): T {
    if (!res.ok) {
      toast.error(res.message)
      throw res.error
    }
    return res.data
  }

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(t('ws.toastCopied')),
      () => toast.error(t('ws.toastCopyFailed'))
    )

  if (detail.error) return <ErrorState error={detail.error} />
  if (!detail.data) return null

  const w = detail.data.workspace
  const self = detail.data.members.find((m) => m.user_id === userId)

  return (
    <div className="space-y-6" data-testid="workspace-settings">
      <WorkspaceGeneralSection
        workspace={w}
        role={detail.data.role}
        canEdit={isOwner}
        labels={L}
        onRename={async (name) => {
          check(await rename.run({ name }))
          toast.success(t('ws.toastRenamed'))
          await refresh()
        }}
      />

      <WorkspaceMembersSection
        members={detail.data.members}
        currentUserId={userId}
        ownerId={w.owner_id}
        isOwner={isOwner}
        labels={L}
        onTransfer={async (m) => {
          check(await transfer.run({ new_owner_user_id: m.user_id }))
          toast.success(t('ws.toastTransferred', { who: m.name ?? m.email }))
          await refresh()
        }}
        onRemove={async (m) => {
          check(await removeMember.run(undefined, `/api/workspaces/${ws}/members/${m.user_id}`))
          toast.success(t('ws.toastRemoved', { who: m.name ?? m.email }))
          await refresh()
        }}
        footer={
          <WithCommands
            text={t('ws.cliMembers')}
            commands={{
              list: WORKSPACE_CLI.memberList,
              remove: WORKSPACE_CLI.memberRemove,
              transfer: WORKSPACE_CLI.transfer,
            }}
          />
        }
      />

      {isOwner && (
        <WorkspaceInvitationsSection
          invitations={invitations.data}
          error={invitations.error ? <ErrorState error={invitations.error} /> : undefined}
          candidates={candidates.data}
          labels={L}
          formatDate={(d) => date(typeof d === 'string' ? d : d.toISOString())}
          onCopy={copy}
          onInvite={async (email) => {
            const made = check(await invite.run({ email }))
            if (made.email_sent) toast.success(t('ws.toastInvited', { email }))
            else toast.success(t('ws.toastInviteCreated', { email }), { description: t('ws.toastInviteCopy') })
            await queryClient.invalidateQueries(booksCacheFilter())
            return made.accept_url
          }}
          onRevoke={async (inv) => {
            check(await revoke.run(undefined, `/api/workspaces/${ws}/invitations/${inv.id}`))
            toast.success(t('ws.toastRevoked'))
            await queryClient.invalidateQueries(booksCacheFilter())
          }}
          footer={
            <WithCommands
              text={t('ws.cliInvite')}
              commands={{ send: WORKSPACE_CLI.inviteSend, accept: WORKSPACE_CLI.inviteAccept }}
            />
          }
        />
      )}

      {isOwner ? (
        <WorkspaceDangerSection
          name={w.name}
          slug={w.slug}
          labels={L}
          refusal={books.data === undefined ? undefined : books.data.length > 0 ? t('ws.refused') : null}
          onDelete={async () => {
            check(await del.run())
            toast.success(t('ws.toastDeleted', { name: w.name }))
            router.push('/dashboard')
            router.refresh()
          }}
          footer={
            <WithCommands text={t('ws.cliDelete')} commands={{ cmd: WORKSPACE_CLI.delete(w.slug) }} />
          }
        />
      ) : (
        self && (
          <WorkspaceLeaveSection
            name={w.name}
            labels={L}
            onLeave={async () => {
              check(await removeMember.run(undefined, `/api/workspaces/${ws}/members/${userId}`))
              toast.success(t('ws.toastLeft', { name: w.name }))
              router.push('/dashboard')
              router.refresh()
            }}
            footer={<WithCommands text={t('ws.cliLeave')} commands={{ cmd: WORKSPACE_CLI.leave(userId) }} />}
          />
        )
      )}
    </div>
  )
}
