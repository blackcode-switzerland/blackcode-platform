// GET  /api/workspaces/{ws}/invitations — `bk billing invite list`
// POST /api/workspaces/{ws}/invitations — `bk billing invite send`
//
// ===========================================================================
// WHY THIS IS NOT `workspaceInvitationsRoute(appContext)`
// ===========================================================================
// There IS a shared factory with that name, and mounting it here would be a bug
// of a shape this repo has now hit four times: **a shared factory is only shared
// if the table under it is.** `workspaceInvitationsRoute` calls platform-db's
// `createInvitation` / `listWorkspaceInvitations`, which read and write
// `platform.workspace_invitations` — one app's table since 2026-08-10.
//
// The three that came before it, all removed from this scaffold in Phase 4 and
// listed in `app/api/README.md`: `searchRoute` (served another app's titles to a
// caller with no access), `usersRoute` (listed people from another app's
// membership table), `linksRoute` (an index that no longer exists — the factory
// itself was deleted on 2026-08-12). Each looked
// like a free capability and each would have taught the next app a bug.
//
// Invitations is the fourth, and it is the quietest of the four because nothing
// is currently wrong: only `apps/issues` mounts that factory today. Which is
// exactly why it is worth the comment — the failure would arrive with app #3,
// months later, as invitations into a workspace this app cannot see.
//
// Read what a factory QUERIES before you mount it.

import { NextRequest, NextResponse } from 'next/server'
import { Errors, requireOwner } from '@blackcode/platform-api'
import { getUserByEmail } from '@blackcode/platform-db'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import {
  acceptUrl,
  createInvitation,
  INVITATION_TTL_DAYS,
  listInvitations,
} from '@/lib/db/queries/invitations'
import { sendInvitationEmail } from '@/lib/email/send'

/**
 * This deployment's public origin — `NEXTAUTH_URL` first, because behind a
 * proxy the request URL can be an internal hostname nobody outside can open.
 * The link lands on THIS app's `/invitations/{token}` page (phase 2).
 */
function baseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXTAUTH_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return new URL(req.url).origin
}

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  // Owner-only: a pending invitation carries a redeemable token, so listing them
  // is handing out access. `requireOwner` throws the 403.
  requireOwner(ctx)
  return NextResponse.json({ data: await listInvitations(ctx.workspace.id), next_cursor: null })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = (await req.json().catch(() => null)) as { email?: string } | null
  const email = (body?.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw Errors.badRequest('invalid_email', 'an email address is required', 'pass --email <address>')
  }

  // NOTE: this app does not apply the sign-up whitelist here, and that is a
  // DECISION rather than an omission. `isEmailAllowed` gates who may hold a
  // platform ACCOUNT; an invitation is an offer to join one workspace, redeemed
  // by somebody who must then pass that gate to register. `apps/sales` does gate
  // invitations as well — a defensible, stricter choice. If you want that, copy
  // its check from `apps/sales/app/api/workspaces/[ws]/invitations/route.ts` and
  // say so, because "we forgot" and "we decided" look identical afterwards.

  const invitation = await createInvitation({
    workspaceId: ctx.workspace.id,
    email,
    invitedBy: ctx.user.id,
  })
  if (!invitation) {
    throw Errors.conflict(
      'already_member',
      `${email} is already in this workspace`,
      'run `bk billing member list` to see who is in it'
    )
  }

  // ── IT SENDS EMAIL SINCE PHASE 2 (2026-09-21) ──────────────────────────────
  // Through `platform-email`, the way `apps/sales` does. `email_sent` is the
  // REAL result, not a constant: a client that cannot tell "sent" from "not
  // attempted" assumes the first. The link is still returned either way,
  // because email is best-effort and a bounce — or a deployment with no Resend
  // key, where this reports `email_sent: false` — must not strand a valid
  // invitation. It points at THIS app's own accept page, `/invitations/{token}`.
  const link = acceptUrl(baseUrl(req), invitation.token)
  const inviteeHasAccount = (await getUserByEmail(getDb(), email)) != null
  const emailResult = await sendInvitationEmail(email, {
    workspaceName: ctx.workspace.name,
    inviterName: ctx.user.name ?? ctx.user.email,
    acceptUrl: link,
    inviteeHasAccount,
    expiresInDays: INVITATION_TTL_DAYS,
  })

  return NextResponse.json(
    {
      invitation,
      invitee_has_account: inviteeHasAccount,
      email_sent: emailResult.sent,
      accept_url: link,
    },
    { status: 201 }
  )
})
