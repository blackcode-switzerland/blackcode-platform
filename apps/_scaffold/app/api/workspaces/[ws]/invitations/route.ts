// GET  /api/workspaces/{ws}/invitations — `bk scaffold invite list`
// POST /api/workspaces/{ws}/invitations — `bk scaffold invite send`
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
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { acceptUrl, createInvitation, listInvitations } from '@/lib/db/queries/invitations'

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
      'run `bk scaffold member list` to see who is in it'
    )
  }

  // THE LINK IS PART OF THE RESPONSE because THIS app sends no email. That is a
  // property of the scaffold, not of the platform: `packages/platform-email`
  // exists as of 2026-08-11 and `apps/sales` uses it — see
  // `docs/adding-an-app.md` open item 8, which shows the four-line binding.
  //
  // The scaffold deliberately does NOT bind a sender, so a copied app starts
  // with no dependency on a Resend key and `email_sent: false` stays honest.
  // Add the binding when your app needs to send, and set the two environment
  // variables at the same time — without them, production password resets
  // refuse with 503 `email_not_configured` rather than silently not sending.
  //
  // A link nobody can copy is not a delivery mechanism, so it is returned
  // either way — `apps/sales` still returns it now that it does send, because
  // email is best-effort and a bounce must not strand a valid invitation.
  const origin = new URL(req.url).origin
  return NextResponse.json(
    {
      invitation,
      email_sent: false,
      accept_url: acceptUrl(origin, invitation.token),
    },
    { status: 201 }
  )
})
