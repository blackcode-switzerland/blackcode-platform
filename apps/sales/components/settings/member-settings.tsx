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

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Search, Trash2, UserPlus, X } from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { apiGet, wsPath } from '@/lib/client'
import { useInviteMember, useRemoveMember, useRevokeInvitation } from '@/lib/mutations'
import { useCanWrite, READ_ONLY_NOTE } from '@/lib/ui-mode'
import { BlockSkeleton, ErrorState, ticks } from '@/components/states'
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

interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
  from_platform: boolean
}

export function MemberSettings({ ws, isOwner, meId }: { ws: string; isOwner: boolean; meId: number }) {
  const [email, setEmail] = useState('')
  const [search, setSearch] = useState('')
  const [lastSent, setLastSent] = useState<SentInvitation | null>(null)

  // ── THIS PAGE DID NOT ASK UNTIL 2026-08-11, AND IT WAS THE ONLY ONE ────────
  // Found by the Phase 7 browser pass. `read_only` is the DEFAULT `ui_mode`
  // (D-7), so out of the box this page rendered a live-looking Invite field and
  // an enabled Remove/Revoke on every row — while the prospect page one click
  // away said "Editing is hidden — this browser is in read-only mode".
  //
  // Nothing was ever written: `useRecordMutation` refuses, and the refusal is
  // loud — measured, the click raises the `ReadOnlyModeError` toast naming both
  // recoveries. So this is the safety net doing exactly the job
  // `lib/read-only.test.ts`'s header describes ("a button that was not hidden
  // fails loudly instead of writing"), which is also why nobody had noticed:
  // the net held, and the affordance stayed wrong underneath it.
  //
  // An error toast is the fallback, not the design. The design is that a mode
  // which hides editing hides it here too.
  const canWrite = useCanWrite(ws)

  // BOTH list routes answer with the `{ data, next_cursor }` envelope
  // (`jsonList`), so both queryFns must UNWRAP it. Typing the call as a bare
  // array does not make it one: on 2026-08-11 this read `apiGet<Member[]>` and
  // `members.data` was the envelope — truthy, so the `members.data &&` guard
  // passed, and `.map` threw. The page was blank in production for every user.
  // See `member-settings-envelope.test.ts`.
  const members = useQuery({
    queryKey: ['members', ws],
    queryFn: async () => (await apiGet<{ data: Member[] }>(wsPath(ws, '/members'))).data,
  })

  // Only an owner may read this — the route is owner-gated, so asking as a
  // member would render an error where there is nothing wrong. `enabled` is the
  // honest expression of "this question is not mine to ask".
  const invitations = useQuery({
    queryKey: ['invitations', ws],
    enabled: isOwner,
    // The `as unknown as` here was a cast that LIED — it renamed the envelope
    // rather than opening it. This one failed QUIETLY: `.length` on the
    // envelope is undefined, so `length > 0` was false and the list simply
    // never rendered. Unwrap, never cast.
    queryFn: async () =>
      (await apiGet<{ data: Invitation[] }>(wsPath(ws, '/invitations'))).data,
  })

  // Every one of these is a RECORD write and goes through `lib/mutations.ts`,
  // which is the only module allowed to send `apiSend` at an `/api/workspaces/…`
  // path — `lib/read-only.test.ts` asserts it. The first version of this file
  // called `apiSend` directly and that guard caught it, correctly: membership
  // became a sales row on 2026-08-10 and stopped being an account operation.
  // ── THE SUPER ADMIN'S SHORTCUT (2026-08-11) ────────────────────────────────
  //
  // b/sales has no administration screens and is not growing any — that is
  // deliberate, and `app/dashboard/settings/account/page.tsx` says so to the
  // person reading it. So the one super-admin capability this app needs lives
  // HERE, inside the page whose subject it already is, rather than behind a
  // /super-admin route that would exist to hold a single list.
  //
  // The gate is the SERVER's `is_super_admin`, not a guess made here: this
  // component cannot read `SUPER_ADMINS` (it is not a public env var) and the
  // whitelist is a table. A client-side guess would be a second, weaker copy of
  // a rule that already has one authority. The route is owner-gated too, which
  // is why `enabled` matches the `invitations` query above — asking as a plain
  // member would render an error where there is nothing wrong.
  //
  // NOT a substitute for the email field below it. Somebody with no blackcode
  // account cannot appear in this list at all, and inviting them is the case
  // the field exists for.
  const candidates = useQuery({
    queryKey: ['invite-candidates', ws],
    enabled: isOwner,
    queryFn: async () =>
      await apiGet<{ data: InviteCandidate[]; is_super_admin: boolean }>(
        wsPath(ws, '/invite-candidates')
      ),
  })

  const invite = useInviteMember(ws)
  const revoke = useRevokeInvitation(ws)
  const remove = useRemoveMember(ws)

  const isSuperAdmin = candidates.data?.is_super_admin ?? false
  const filteredCandidates = useMemo(() => {
    const rows = candidates.data?.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (c) => c.email.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q)
    )
  }, [candidates.data, search])

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
                <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={32} />
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
                {isOwner && canWrite && m.role !== 'owner' && (
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
          note="They need a blackcode account, or an address a super admin has approved. We email them an invitation; the link below works too, if it does not arrive."
        >
          {/* The note, not silence. `ui-mode.ts`'s READ_ONLY_NOTE exists because
              a control that is simply absent teaches nothing: the reader
              concludes the feature does not exist, or that they are not allowed
              — and here the second reading would be actively wrong, since an
              owner in read-only mode can still invite through `bk sales`. */}
          {/* `ticks`, because READ_ONLY_NOTE names a command in backticks and
              this was the last place in the app still printing them literally
              (2026-08-11). It is the only call site of that constant, so the
              alternative — dropping the backticks from `ui-mode.ts` — would
              have made the constant unable to mark a command at all. */}
          {!canWrite && (
            <p className="text-xs text-muted-foreground">{ticks(READ_ONLY_NOTE)}</p>
          )}

          {canWrite && (
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
          )}

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
                  {/* ── THE LINK, ON EVERY PENDING ROW AND NOT ONLY THE FRESH ONE ──
                      Until 2026-08-11 the only place the link appeared was the
                      `lastSent` banner above: it survived until the next reload
                      and then the invitation became unsendable from the UI. The
                      owner's remaining options were to revoke and re-invite, or
                      to read the token out of Postgres.

                      **This app sends the invitation by email now** (Phase 10),
                      so the link is a fallback rather than the only channel —
                      which is why the note above changed on the same day. It
                      stays because email is best-effort by design: a bounce
                      must not strand an invitation that is already valid.

                      Nothing new is exposed — `token` is already in this row's
                      payload, which is what made the gap invisible: the data was
                      there and only the affordance was missing. Reconstructed
                      from `window.location.origin` because this app serves the
                      accept page itself (`app/invitations/[token]`), so its own
                      origin is the right one by construction. */}
                  <button
                    type="button"
                    aria-label={`Copy invitation link for ${inv.email}`}
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}/invitations/${inv.token}`
                      )
                      toast.success('Link copied')
                    }}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Copy size={14} />
                  </button>
                  {canWrite && (
                    <button
                      type="button"
                      aria-label={`Revoke invitation for ${inv.email}`}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ id: inv.id })}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* ── SUPER ADMINS ONLY ──────────────────────────────────────────────
          Rendered off the SERVER's flag. `candidates.data` is undefined while
          the query is in flight and after a failure, so `isSuperAdmin` is false
          in both cases and this section is absent rather than empty — the safe
          direction: a normal owner must never see it, and a super admin seeing
          it a moment late costs nothing.

          There is no skeleton for the same reason. A placeholder here would be
          a hole in the page that a non-super-admin also sees, which announces
          the feature to precisely the people it is hidden from. */}
      {isOwner && isSuperAdmin && (
        <Section
          title="Everyone with a blackcode account"
          note="You are a super admin, so you can add any existing account to b/sales directly. Everybody else here only sees the people they already share this pipeline with."
        >
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          {candidates.isError && <ErrorState error={candidates.error} />}

          {filteredCandidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {search.trim() ? 'Nobody matches that.' : 'No other accounts on the platform yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredCandidates.map((c) => (
                <li key={c.user_id} className="flex items-center gap-3 py-2.5">
                  <MemberAvatar
                    name={c.name}
                    email={c.email}
                    avatarUrl={c.avatar_url}
                    size={28}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{c.name ?? c.email}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.email}
                      {/* Said only when true. Everyone in this list has an
                          account; only some of them are already colleagues, and
                          that is the fact worth carrying. */}
                      {c.shared_workspaces.length > 0 && (
                        <span className="text-muted-foreground/70">
                          {' · also in '}
                          {c.shared_workspaces.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.already_member ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Check size={12} />
                      In this pipeline
                    </span>
                  ) : c.invited ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Invited</span>
                  ) : (
                    canWrite && (
                      <button
                        type="button"
                        disabled={invite.isPending}
                        onClick={() =>
                          invite.mutate(
                            { email: c.email },
                            { onSuccess: (sent) => setLastSent(sent as SentInvitation) }
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <UserPlus size={13} />
                        Invite
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  )
}

// ── THE LOCAL `Avatar` WAS DELETED HERE ON 2026-08-11 ───────────────────────
// It rendered a bare `<img>` with `alt=""` and, with no URL, ONE grey initial —
// so two teammates whose names start with the same letter were the same circle.
// `@blackcode/platform-ui/ui/member-avatar` already did the better thing (two
// initials, a colour derived from the label, a title attribute), was already
// used in 20 files in `apps/issues`, and this file predated nothing: it was a
// second implementation of a solved problem, which is the defect the platform
// spent a week removing. Import it; do not write a third.
