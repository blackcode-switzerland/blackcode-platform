'use client'

// Workspace settings — `/dashboard/{ws}/settings`. Info (read-only), members,
// and invitations (owner only).
//
// ── READ-ONLY, AND THAT IS A FACT ABOUT THIS APP'S ROUTES, NOT A CHOICE HERE ─
// Unlike apps/sales (D-3 reversal: name edit, transfer, delete), billing has no
// `PATCH` or `DELETE` on `/api/workspaces/{ws}` — only `GET`
// (`app/api/workspaces/[ws]/route.ts`). So this page shows the workspace's name,
// slug and the caller's role, and offers no edit control for any of them: adding
// one here with no route under it would be exactly the "capability gap with
// every suite green" CLAUDE.md warns about.
//
// ── INVITATIONS: THE CONTENT THAT MOVED HERE FROM /dashboard ─────────────────
// `app/dashboard/page.tsx` (workstream A) showed "Your team" / "Pending
// invitations" inline; that content now lives here, where the workspace is in
// the URL rather than guessed. Acceptance is not available in this app yet
// (no `/invitations/[token]` route), so this page also says so and gives the
// `bk` equivalents, matching what the old page already said.

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Mail, UserRound, X } from 'lucide-react'
import { APP_NAME } from '@/lib/app'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { useWorkspace, useMembers, useInvitations } from '@/lib/queries'
import { useCreateInvitation, useRevokeInvitation, toastError } from '@/lib/mutations'
import { Section, FieldList, EmptyState, ErrorState, LoadingState } from '@/components/ui-kit'

export function WorkspaceSettings({ ws, isOwner }: { ws: string; isOwner: boolean }) {
  const workspace = useWorkspace(ws)

  if (workspace.isPending) return <LoadingState variant="detail" />
  if (workspace.error) return <ErrorState error={workspace.error} retry={workspace.refetch} />

  return (
    <div className="space-y-6">
      <Section title="Workspace">
        <FieldList
          items={[
            { label: 'Name', value: workspace.data.workspace.name, testId: 'ws-name' },
            { label: 'Slug', value: <code className="font-mono text-xs">{workspace.data.workspace.slug}</code>, testId: 'ws-slug' },
            { label: 'Your role', value: workspace.data.role, testId: 'ws-role' },
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {APP_NAME} does not offer renaming, ownership transfer or deletion for a workspace from the
          browser yet — every field above is read-only here.
        </p>
      </Section>

      <MembersSection ws={ws} />

      {isOwner && <InvitationsSection ws={ws} />}
    </div>
  )
}

function MembersSection({ ws }: { ws: string }) {
  const members = useMembers(ws)

  return (
    <Section title="Members" testId="ws-members">
      {members.isPending ? (
        <LoadingState count={2} />
      ) : members.error ? (
        <ErrorState error={members.error} retry={members.refetch} />
      ) : (
        <ul className="divide-y divide-border">
          {members.data.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2.5" data-testid={`member-${m.user_id}`}>
              <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{m.name ?? m.email}</span>
                <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
              </span>
              <span className="shrink-0 text-xs capitalize text-muted-foreground">{m.role}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function InvitationsSection({ ws }: { ws: string }) {
  const invitations = useInvitations(ws, { enabled: true })
  const createInvitation = useCreateInvitation(ws)
  const revokeInvitation = useRevokeInvitation(ws)
  const { confirm } = useConfirm()
  const [email, setEmail] = useState('')
  const [lastLink, setLastLink] = useState<string | null>(null)

  async function onInvite() {
    const value = email.trim().toLowerCase()
    if (!value) return
    try {
      const result = await createInvitation.mutateAsync({ email: value })
      setEmail('')
      setLastLink(result.accept_url)
      toast.success(`Invitation created for ${value}`, {
        description: result.email_sent ? undefined : 'This app sends no invitation email — copy the link below and send it yourself.',
      })
    } catch (e) {
      toastError(e)
    }
  }

  async function onRevoke(id: number, revokeEmail: string) {
    const ok = await confirm({
      title: `Revoke the invitation to ${revokeEmail}?`,
      description: 'The link stops working immediately.',
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (!ok) return
    try {
      await revokeInvitation.mutateAsync({ id })
      toast.success('Invitation revoked')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Section
      title="Invitations"
      description="Acceptance isn't available in this app's browser yet — hand the link to whoever you invited."
      testId="ws-invitations"
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            type="email"
            data-testid="input-invite-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
          />
          <Button onClick={onInvite} disabled={!email.trim() || createInvitation.isPending} data-testid="send-invite">
            <Mail size={15} />
            {createInvitation.isPending ? 'Sending…' : 'Invite'}
          </Button>
        </div>

        {lastLink && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="last-invite-link">
              {lastLink}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(lastLink).then(
                  () => toast.success('Copied'),
                  () => toast.error('Could not copy — select the link and copy it by hand')
                )
              }}
            >
              <Copy size={13} />
              Copy
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Same as{' '}
          <code className="rounded bg-muted px-1 py-0.5">
            bk billing invite send &lt;email&gt;
          </code>
          . List pending invitations with{' '}
          <code className="rounded bg-muted px-1 py-0.5">bk billing invite list</code> and revoke one
          with <code className="rounded bg-muted px-1 py-0.5">bk billing invite revoke &lt;id&gt;</code>.
        </p>

        {invitations.isPending ? (
          <LoadingState count={2} />
        ) : invitations.error ? (
          <ErrorState error={invitations.error} retry={invitations.refetch} />
        ) : invitations.data.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            icon={UserRound}
            hint="Invite somebody above — the response carries the link, because this app sends no email."
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="invitation-list">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2.5" data-testid={`invitation-${inv.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{inv.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    invited by {inv.invited_by_name ?? inv.invited_by_email}
                  </span>
                </span>
                <button
                  onClick={() => onRevoke(inv.id, inv.email)}
                  aria-label={`Revoke invitation to ${inv.email}`}
                  data-testid={`revoke-invitation-${inv.id}`}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
