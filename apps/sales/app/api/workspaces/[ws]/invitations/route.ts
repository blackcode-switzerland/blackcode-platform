// GET|POST /api/workspaces/{ws}/invitations — `bk invite list | send`.
//
// ---------------------------------------------------------------------------
// THIS APP'S OWN AS OF PHASE 2, AND THE SHARED FACTORY COULD NOT BE KEPT
// ---------------------------------------------------------------------------
// `workspaceInvitationsRoute` writes `platform.workspace_invitations` and takes
// an optional `app` naming which app inside the workspace the invitee is being
// let into, validated against `platform.workspace_apps`. Both concepts are gone
// here: an invitation to a sales workspace IS an invitation to sales, which is
// why `sales.invitations` has no `app` column.
//
// ---------------------------------------------------------------------------
// THE WHITELIST GATE COMES WITH IT
// ---------------------------------------------------------------------------
// Accepting an invitation creates nothing, but SENDING one to an address with no
// account is how that address later gets one. The platform factory gated it and
// so does this: same rule, same super-admin auto-add, same
// `@blackcode/platform-auth` implementation. PLAN.md §6 decision 1.
//
// ---------------------------------------------------------------------------
// IT SENDS EMAIL NOW (2026-08-11). `email_sent: false` USED TO BE A CONSTANT
// ---------------------------------------------------------------------------
// This block used to read "no email is sent, and that is unchanged — this
// deployment has no email provider and is not gaining one to mount a route".
// That stopped being true when `packages/platform-email` landed and b/sales got
// a `lib/email/send.ts` binding of its own.
//
// `email_sent` is now the real result rather than a hardcoded `false`, which
// matters more than it sounds: a client that could not tell "sent" from "not
// attempted" was the reason it was reported at all, and a literal `false` gave
// it the same answer forever. `accept_url` is still returned either way — it is
// the delivery mechanism `bk <app> invite send` prints, and it stays useful
// when a send fails.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import {
  addWhitelistEntry,
  isEmailAllowed,
  isSuperAdmin,
  isWhitelistEnabled,
} from '@blackcode/platform-auth'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import {
  INVITE_TTL_DAYS,
  createInvitation,
  listWorkspaceInvitations,
} from '@/lib/db/queries/invitations'
import { INVITE_EMAIL_MAX } from '@/lib/limits'
import { sendInvitationEmail } from '@/lib/email/send'

interface Params {
  params: Promise<{ ws: string }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * This deployment's own origin.
 *
 * `NEXTAUTH_URL` first, because behind a proxy the request URL can be the
 * internal one, and a link into an internal hostname is a link nobody outside
 * can open.
 */
function baseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXTAUTH_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  const includeAll = req.nextUrl.searchParams.get('all') === 'true'
  const data = await listWorkspaceInvitations(ctx.workspace.id, {
    includeNonPending: includeAll,
  })
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email)) {
    throw Errors.badRequest('invalid_email', 'email is required and must be a valid email')
  }
  if (email.length > INVITE_EMAIL_MAX) {
    throw Errors.badRequest('email_too_long', `email max ${INVITE_EMAIL_MAX} chars`)
  }

  // Who may hold an account on this platform at all. Off when SUPER_ADMINS is
  // unset, which is what keeps local development working — and is why the test
  // for this gate configures a whitelist rather than relying on the default.
  if (isWhitelistEnabled()) {
    const allowed = await isEmailAllowed(getDb(), email)
    if (!allowed) {
      if (isSuperAdmin(ctx.user.email)) {
        await addWhitelistEntry(getDb(), { type: 'email', value: email, added_by: ctx.user.id })
      } else {
        throw Errors.forbidden(
          `${email} is not in the approved list. Only Blackcode team members can be invited. ` +
            'Contact a super admin to add them first.'
        )
      }
    }
  }

  try {
    const result = await createInvitation({
      workspaceId: ctx.workspace.id,
      email,
      invitedBy: ctx.user.id,
      ttlDays: INVITE_TTL_DAYS,
    })

    const acceptUrl = `${baseUrl(req)}/invitations/${result.invitation.token}`

    // Best-effort by design: the invitation is already written and valid, and a
    // bounce is not a reason to fail the request. The caller learns what
    // happened from `email_sent` and still has `accept_url` to fall back on.
    const emailResult = await sendInvitationEmail(email, {
      workspaceName: ctx.workspace.name,
      inviterName: ctx.user.name ?? ctx.user.email,
      acceptUrl,
      inviteeHasAccount: result.invitee_has_account,
      expiresInDays: INVITE_TTL_DAYS,
    })

    return NextResponse.json(
      {
        invitation: result.invitation,
        invitee_has_account: result.invitee_has_account,
        // The real result. Reported rather than omitted: a client that cannot
        // tell "sent" from "not attempted" will assume the first one.
        email_sent: emailResult.sent,
        accept_url: acceptUrl,
      },
      { status: 201 }
    )
  } catch (err) {
    // The query layer throws bare messages; THIS layer decides what a denial
    // looks like over HTTP, the same split platform-db makes.
    const m = (err as Error)?.message
    if (m === 'already_member') {
      throw Errors.conflict(
        'already_member',
        'A user with this email is already a member of this workspace'
      )
    }
    if (m === 'already_invited') {
      throw Errors.conflict(
        'already_invited',
        'There is already a pending invitation for this email',
        'Revoke it first with `bk sales invite revoke <id>` if you need to issue a fresh link.'
      )
    }
    throw err
  }
})
