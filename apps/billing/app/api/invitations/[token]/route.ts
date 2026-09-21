// GET /api/invitations/{token} — `bk billing invite show <token>`.
//
// Phase 2 (2026-09-21), ported from `apps/sales`. It exists because the WEB can
// preview an invitation (`/invitations/{token}` names who invited you and to
// which workspace before you commit) and an agent handed a raw token could
// otherwise only accept it blind.
//
// ---------------------------------------------------------------------------
// THE REFUSAL ORDER IS A SECURITY PROPERTY, NOT A STYLE CHOICE
// ---------------------------------------------------------------------------
//   accepted → not-pending → expired → not-yours
//
// **The email check comes LAST, and its message names the CALLER's address,
// never the invitation's.** Whose invitation a token is for is not something
// the holder of a token gets to learn; reordering these, or reporting "this is
// for alice@…", turns a token into an address oracle. `app/invitations/[token]
// /page.tsx` answers in the same order — change one, change both.
//
// The token is not the credential on its own: the caller must be SIGNED IN too,
// exactly as `accept` requires, so a leaked link alone reveals nothing.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { getInvitationByToken } from '@/lib/db/queries/invitations'

type Params = { params: Promise<{ token: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const { token } = await params
  const inv = await getInvitationByToken((token ?? '').trim())
  if (!inv) {
    throw Errors.notFound(
      'invitation_not_found',
      'no such invitation',
      'check the token, or run `bk billing invite pending` to list invitations addressed to you'
    )
  }
  if (inv.status === 'accepted') {
    throw Errors.badRequest('invitation_already_accepted', 'this invitation has already been accepted', null)
  }
  if (inv.status !== 'pending') {
    throw Errors.badRequest('invitation_not_pending', 'this invitation is no longer valid', 'ask the workspace owner to send another')
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    throw Errors.badRequest('invitation_expired', 'this invitation has expired', 'ask the workspace owner to send another')
  }
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    // Names the CALLER, not the invitee. See the header.
    throw Errors.forbidden(
      `this invitation is not for ${user.email}`,
      'sign in as the address it was sent to',
      'invitation_not_yours'
    )
  }

  return NextResponse.json({
    token,
    email: inv.email,
    status: inv.status,
    expires_at: inv.expires_at,
    workspace: { id: inv.workspace_id, name: inv.workspace_name, slug: inv.workspace_slug },
    invited_by: { name: inv.invited_by_name, email: inv.invited_by_email },
  })
})
