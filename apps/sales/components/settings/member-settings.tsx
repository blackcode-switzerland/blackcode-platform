'use client'

// Members — `sales.workspace_members` and `sales.invitations`.
//
// ---------------------------------------------------------------------------
// THIS IS THE SCREEN THE MULTI-APP REFACTOR EXISTS FOR
// ---------------------------------------------------------------------------
// Before 2026-08-10 there was no way to put a person into b/sales from b/sales:
// membership lived in `platform.workspace_members`, so somebody had to be
// invited into an ISSUES workspace and then granted the sales app inside it.
// That is what made this product an add-on rather than an app. Everything on
// this page reads and writes THIS app's tables.
//
// ---------------------------------------------------------------------------
// THE WORD "WORKSPACE" DOES NOT APPEAR, AND THAT IS PLAN.md §1
// ---------------------------------------------------------------------------
// A sales user has exactly one and never picks it, so the page says "b/sales"
// and "your team". The workspace slug is still in the URL and in every API path
// — what is hidden is the offer to choose, not the concept.
//
// ---------------------------------------------------------------------------
// NO ROLE EDITOR, DELIBERATELY
// ---------------------------------------------------------------------------
// Roles are SHOWN and not editable. Neither app has ever had a change-role
// route, on either tenancy — adding one here would be a new platform capability
// (a route, a `bk member role` command, a guide topic, a changelog entry) landed
// inside the phase whose job is moving tenancy. It is a one-route addition
// whenever somebody wants it; inventing it here would make this phase's diff
// impossible to read.
//
// ---------------------------------------------------------------------------
// COLOUR
// ---------------------------------------------------------------------------
// None is typed here. Everything is a Tailwind token from the shared theme, so
// `lib/palette.test.ts` has nothing to find — D-4 is that every colour in this
// app is decided in `lib/pipeline.ts`, and a members list needs none of them.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Trash2, UserPlus, X } from 'lucide-react'
import { apiGet, wsPath } from '@/lib/client'
import { useInviteMember, useRemoveMember, useRevokeInvitation } from '@/lib/mutations'
import { BlockSkeleton, ErrorState } from '@/components/states'
import { Section } from './profile-settings'

interface Member {
  user_id: number
  role: string
  joined_at: string
  email: string
  name: string | null
  avatar_url: string | null
  deleted_at: string | null
}

interface Invitation {
  id: number
  email: string
  role: string
  token: string
  status: string
  expires_at: string
  created_at: string
  invited_by_name: string | null
  invited_by_email: string
}

interface SentInvitation {
  invitation: Invitation
  invitee_has_account: boolean
  email_sent: boolean
  accept_url: string
}

export function MemberSettings({ ws, isOwner, meId }: { ws: string; isOwner: boolean; meId: number }) {
  const [email, setEmail] = useState('')
  const [lastSent, setLastSent] = useState<SentInvitation | null>(null)

  const members = useQuery({
    queryKey: ['members', ws],
    queryFn: () => apiGet<Member[]>(wsPath(ws, '/members')),
  })

  // Only an owner may read this — the route is owner-gated, so asking as a
  // member would render an error where there is nothing wrong. `enabled` is the
  // honest expression of "this question is not mine to ask".
  const invitations = useQuery({
    queryKey: ['invitations', ws],
    enabled: isOwner,
    queryFn: async () =>
      (await apiGet<{ data: Invitation[] }>(wsPath(ws, '/invitations'))) as unknown as Invitation[],
  })

  // Every one of these is a RECORD write and goes through `lib/mutations.ts`,
  // which is the only module allowed to send `apiSend` at an `/api/workspaces/…`
  // path — `lib/read-only.test.ts` asserts it. The first version of this file
  // called `apiSend` directly and that guard caught it, correctly: membership
  // became a sales row on 2026-08-10 and stopped being an account operation.
  const invite = useInviteMember(ws)
  const revoke = useRevokeInvitation(ws)
  const remove = useRemoveMember(ws)

  return (
    <div className="space-y-6">
      <Section
        title="Your team"
        note="Everyone here can see this pipeline. Accounts are shared across blackcode apps — removing somebody from b/sales does not close their account."
      >
        {members.isPending && <BlockSkeleton />}
        {members.isError && <ErrorState error={members.error} />}
        {members.data && (
          <ul className="divide-y divide-border">
            {members.data.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <Avatar name={m.name} email={m.email} url={m.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {m.name ?? m.email}
                    {m.user_id === meId && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                    )}
                    {/* A soft-deleted account is still a member row. Saying so
                        beats a member count that disagrees with the list. */}
                    {m.deleted_at && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        (account closed)
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                  {m.role}
                </span>
                {isOwner && m.role !== 'owner' && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.email}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ userId: m.user_id, email: m.email })}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isOwner && (
        <Section
          title="Invite somebody"
          note="They need a blackcode account, or an address a super admin has approved. b/sales does not send email — copy the link and send it yourself."
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (email.trim())
                invite.mutate(
                  { email: email.trim().toLowerCase() },
                  {
                    onSuccess: (sent) => {
                      setLastSent(sent as SentInvitation)
                      setEmail('')
                    },
                  }
                )
            }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@blackcode.ch"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={invite.isPending || !email.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <UserPlus size={15} />
              Invite
            </button>
          </form>

          {/* The link IS the delivery mechanism here, so it is shown rather than
              mentioned. An invitation whose link the owner cannot copy is an
              invitation nobody receives. */}
          {lastSent && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="text-foreground">
                  Send this link to {lastSent.invitation.email}
                  {!lastSent.invitee_has_account && ' — they will be asked to sign up first'}
                </div>
                <code className="mt-1 block truncate text-muted-foreground">
                  {lastSent.accept_url}
                </code>
              </div>
              <button
                type="button"
                aria-label="Copy invitation link"
                onClick={() => {
                  navigator.clipboard.writeText(lastSent.accept_url)
                  toast.success('Link copied')
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setLastSent(null)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {invitations.isPending && <BlockSkeleton rows={1} />}
          {invitations.isError && <ErrorState error={invitations.error} />}
          {invitations.data && invitations.data.length > 0 && (
            <ul className="divide-y divide-border">
              {invitations.data.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      invited by {inv.invited_by_name ?? inv.invited_by_email}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Revoke invitation for ${inv.email}`}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ id: inv.id })}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  )
}

function Avatar({
  name,
  email,
  url,
}: {
  name: string | null
  email: string
  url: string | null
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="size-8 shrink-0 rounded-full object-cover" />
  }
  const initial = (name ?? email).trim().charAt(0).toUpperCase()
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initial}
    </span>
  )
}
