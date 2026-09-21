'use client'

// Workspace settings — `/dashboard/{ws}/settings`. Name, members, invitations,
// and the danger zone.
//
// ── EVERY CONTROL HERE IS A ROUTE `bk` ALSO CALLS (phase 2, 2026-09-21) ──────
// Until phase 2 this page was read-only, because billing served only GET on
// `/api/workspaces/{ws}`. It now carries the same administration `apps/sales`
// has, one route per control, each with its `bk billing …` spelling:
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

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Crown, LogOut, Mail, Trash2, UserMinus, UserRound, X } from 'lucide-react'
import { APP_NAME } from '@/lib/app'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import {
  useCompanies,
  useInvitations,
  useInviteCandidates,
  useMembers,
  useWorkspace,
  type Member,
} from '@/lib/queries'
import {
  toastError,
  useCreateInvitation,
  useDeleteWorkspace,
  useRemoveMember,
  useRenameWorkspace,
  useRevokeInvitation,
  useTransferWorkspace,
} from '@/lib/mutations'
import { Section, FieldList, EmptyState, ErrorState, LoadingState } from '@/components/ui-kit'

/** `billing.workspaces.name` is varchar(80); the route enforces `WORKSPACE_NAME_MAX` (lib/limits.ts, server-only). */
const NAME_MAX = 80

export function WorkspaceSettings({ ws, isOwner, userId }: { ws: string; isOwner: boolean; userId: number }) {
  const workspace = useWorkspace(ws)

  if (workspace.isPending) return <LoadingState variant="detail" />
  if (workspace.error) return <ErrorState error={workspace.error} retry={workspace.refetch} />

  const w = workspace.data.workspace

  return (
    <div className="space-y-6">
      <Section title="Workspace">
        <FieldList
          items={[
            {
              label: 'Name',
              value: isOwner ? <RenameField ws={ws} current={w.name} /> : w.name,
              testId: 'ws-name',
            },
            {
              label: 'Slug',
              value: (
                <span>
                  <code className="font-mono text-xs">{w.slug}</code>
                  <span className="ml-2 text-xs text-muted-foreground">
                    fixed — it is part of every reference this workspace has printed
                  </span>
                </span>
              ),
              testId: 'ws-slug',
            },
            { label: 'Your role', value: <span className="capitalize">{workspace.data.role}</span>, testId: 'ws-role' },
          ]}
        />
      </Section>

      <MembersSection ws={ws} isOwner={isOwner} ownerId={w.owner_id} userId={userId} />

      {isOwner && <InvitationsSection ws={ws} />}

      {isOwner ? (
        <DeleteSection ws={ws} slug={w.slug} name={w.name} />
      ) : (
        <LeaveSection ws={ws} name={w.name} userId={userId} />
      )}
    </div>
  )
}

function RenameField({ ws, current }: { ws: string; current: string }) {
  const router = useRouter()
  const rename = useRenameWorkspace(ws)
  const [name, setName] = useState(current)
  const trimmed = name.trim()
  const dirty = trimmed !== current && trimmed.length > 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    try {
      await rename.mutateAsync({ name: trimmed })
      toast.success('Workspace renamed')
      // The sidebar's switcher is loaded server-side.
      router.refresh()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-md gap-2" data-testid="rename-workspace-form">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={NAME_MAX}
        aria-label="Workspace name"
        data-testid="input-rename-workspace"
      />
      <Button type="submit" variant="outline" disabled={!dirty || rename.isPending} data-testid="save-rename-workspace">
        {rename.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

function MembersSection({
  ws,
  isOwner,
  ownerId,
  userId,
}: {
  ws: string
  isOwner: boolean
  ownerId: number
  userId: number
}) {
  const members = useMembers(ws)
  const remove = useRemoveMember(ws)
  const transfer = useTransferWorkspace(ws)
  const router = useRouter()
  const { confirm } = useConfirm()

  async function onRemove(m: Member) {
    const who = m.name ?? m.email
    const ok = await confirm({
      title: `Remove ${who} from this workspace?`,
      description:
        'They lose access immediately. Invoices they created stay, and stay attributed to them.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync({ userId: m.user_id })
      toast.success(`${who} removed`)
    } catch (e) {
      toastError(e)
    }
  }

  async function onTransfer(m: Member) {
    const who = m.name ?? m.email
    const ok = await confirm({
      title: `Make ${who} the owner?`,
      description:
        'They take over invitations, member management and deletion. You stay in the workspace as a member, and only they can make you owner again.',
      confirmLabel: 'Transfer ownership',
      destructive: true,
    })
    if (!ok) return
    try {
      await transfer.mutateAsync({ new_owner_user_id: m.user_id })
      toast.success(`${who} is now the owner`)
      router.refresh()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Section title="Members" testId="ws-members">
      {members.isPending ? (
        <LoadingState count={2} />
      ) : members.error ? (
        <ErrorState error={members.error} retry={members.refetch} />
      ) : (
        <ul className="divide-y divide-border">
          {members.data.map((m) => {
            const isOwnerRow = m.user_id === ownerId
            const canManage = isOwner && !isOwnerRow
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-2.5" data-testid={`member-${m.user_id}`}>
                <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {m.name ?? m.email}
                    {m.user_id === userId && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">{m.role}</span>
                {canManage && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => onTransfer(m)}
                      disabled={transfer.isPending}
                      aria-label={`Make ${m.name ?? m.email} the owner`}
                      title="Make owner"
                      data-testid={`transfer-to-${m.user_id}`}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <Crown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(m)}
                      disabled={remove.isPending}
                      aria-label={`Remove ${m.name ?? m.email}`}
                      title="Remove from workspace"
                      data-testid={`remove-member-${m.user_id}`}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <UserMinus size={15} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Same as <code className="rounded bg-muted px-1 py-0.5">bk billing member list</code>,{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk billing member remove &lt;user_id&gt;</code> and{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk billing workspace transfer --to &lt;user_id&gt;</code>.
      </p>
    </Section>
  )
}

function InvitationsSection({ ws }: { ws: string }) {
  const invitations = useInvitations(ws, { enabled: true })
  const candidates = useInviteCandidates(ws)
  const createInvitation = useCreateInvitation(ws)
  const revokeInvitation = useRevokeInvitation(ws)
  const { confirm } = useConfirm()
  const [email, setEmail] = useState('')
  const [lastLink, setLastLink] = useState<string | null>(null)

  const colleagues = (candidates.data ?? []).filter((c) => !c.from_platform && !c.already_member && !c.invited)

  async function invite(address: string) {
    const value = address.trim().toLowerCase()
    if (!value) return
    try {
      const result = await createInvitation.mutateAsync({ email: value })
      setEmail('')
      setLastLink(result.accept_url)
      if (result.email_sent) {
        toast.success(`Invitation emailed to ${value}`)
      } else {
        toast.success(`Invitation created for ${value}`, {
          description: 'The email could not be sent from here — copy the link below and send it yourself.',
        })
      }
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
      description="Invitees get an email with a link; they accept it signed in as that address. The link is shown here too."
      testId="ws-invitations"
    >
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void invite(email)
          }}
        >
          <Input
            type="email"
            data-testid="input-invite-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            list="invite-candidates"
          />
          {/* Every candidate, a super admin's platform-wide ones included, as
              autocomplete only — never mixed into the "already work with" list. */}
          <datalist id="invite-candidates">
            {(candidates.data ?? [])
              .filter((c) => !c.already_member && !c.invited)
              .map((c) => (
                <option key={c.user_id} value={c.email}>
                  {c.name ?? c.email}
                </option>
              ))}
          </datalist>
          <Button type="submit" disabled={!email.trim() || createInvitation.isPending} data-testid="send-invite">
            <Mail size={15} />
            {createInvitation.isPending ? 'Sending…' : 'Invite'}
          </Button>
        </form>

        {colleagues.length > 0 && (
          <div data-testid="invite-candidates">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">People you already work with in {APP_NAME}</p>
            <ul className="flex flex-wrap gap-1.5">
              {colleagues.map((c) => (
                <li key={c.user_id}>
                  <button
                    type="button"
                    onClick={() => void invite(c.email)}
                    disabled={createInvitation.isPending}
                    data-testid={`invite-candidate-${c.user_id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    <MemberAvatar name={c.name} email={c.email} avatarUrl={c.avatar_url} size={16} />
                    {c.name ?? c.email}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
          Same as <code className="rounded bg-muted px-1 py-0.5">bk billing invite send &lt;email&gt;</code>. The
          invitee accepts on the link, or with{' '}
          <code className="rounded bg-muted px-1 py-0.5">bk billing invite accept &lt;token&gt;</code>.
        </p>

        {invitations.isPending ? (
          <LoadingState count={2} />
        ) : invitations.error ? (
          <ErrorState error={invitations.error} retry={invitations.refetch} />
        ) : invitations.data.length === 0 ? (
          <EmptyState title="No pending invitations" icon={UserRound} hint="Invite somebody above." />
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
                  type="button"
                  onClick={() => {
                    const link = `${window.location.origin}/invitations/${inv.token}`
                    navigator.clipboard.writeText(link).then(
                      () => toast.success('Invitation link copied'),
                      () => toast.error('Could not copy the link')
                    )
                  }}
                  aria-label={`Copy the invitation link for ${inv.email}`}
                  data-testid={`copy-invitation-${inv.id}`}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Copy size={15} />
                </button>
                <button
                  type="button"
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

/**
 * The owner's danger zone. Refused-with-reason, not hidden: an owner looking for
 * "delete" should learn why there is none for this workspace, not conclude the
 * control is missing.
 */
function DeleteSection({ ws, slug, name }: { ws: string; slug: string; name: string }) {
  const router = useRouter()
  const { prompt } = useConfirm()
  const remove = useDeleteWorkspace(ws)
  // Every retained table needs a company to exist (invoice, series, imported
  // bill and audit rows all hang off one), so "has ever had a company" is the
  // whole question. Retired companies count: they are kept too.
  const companies = useCompanies(ws, { include_retired: true })

  async function onDelete() {
    const typed = await prompt({
      title: `Delete ${name}?`,
      description: `This permanently deletes the workspace, its members and its invitations. Type ${slug} to confirm.`,
      confirmLabel: 'Delete workspace',
      destructive: true,
      inputLabel: 'Workspace slug',
      placeholder: slug,
      requireMatch: slug,
    })
    if (typed === null) return
    try {
      await remove.mutateAsync(undefined)
      toast.success(`${name} deleted`)
      router.push('/dashboard')
      router.refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const held = companies.data ? companies.data.length > 0 : null

  return (
    <Section title="Danger zone" testId="ws-danger-zone">
      {companies.isPending ? (
        <LoadingState count={1} />
      ) : companies.error ? (
        <ErrorState error={companies.error} retry={companies.refetch} />
      ) : held ? (
        <p className="text-sm text-muted-foreground" data-testid="ws-delete-refused">
          This workspace can&rsquo;t be deleted because it holds{' '}
          {companies.data.length === 1 ? 'a company' : `${companies.data.length} companies`}. Companies, their
          invoices and the audit trail are kept for ten years (art. 958f CO), so nothing in {APP_NAME} is ever
          hard-deleted. To stop using it, retire its companies, or make another member the owner.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-sm text-muted-foreground">
            Nothing has been issued from this workspace, so it can still be deleted — with its members and
            invitations. Same as{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              bk billing workspace delete {slug} --confirm {slug}
            </code>
            .
          </p>
          <Button variant="destructive" onClick={onDelete} disabled={remove.isPending} data-testid="delete-workspace">
            <Trash2 size={15} />
            Delete workspace
          </Button>
        </div>
      )}
    </Section>
  )
}

/** A member's way out — the same route the owner uses to remove them. */
function LeaveSection({ ws, name, userId }: { ws: string; name: string; userId: number }) {
  const router = useRouter()
  const { confirm } = useConfirm()
  const remove = useRemoveMember(ws)

  async function onLeave() {
    const ok = await confirm({
      title: `Leave ${name}?`,
      description: 'You lose access immediately. The owner can invite you back.',
      confirmLabel: 'Leave workspace',
      destructive: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync({ userId })
      toast.success(`You left ${name}`)
      router.push('/dashboard')
      router.refresh()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Section title="Leave workspace" testId="ws-leave">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-sm text-muted-foreground">
          Invoices you created stay in the workspace, attributed to you. Same as{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">bk billing member remove {userId}</code>.
        </p>
        <Button variant="outline" onClick={onLeave} disabled={remove.isPending} data-testid="leave-workspace">
          <LogOut size={15} />
          Leave workspace
        </Button>
      </div>
    </Section>
  )
}
