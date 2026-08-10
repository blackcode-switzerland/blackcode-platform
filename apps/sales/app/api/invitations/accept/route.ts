// POST /api/invitations/accept — `bk invite accept <token>`.
//
// ---------------------------------------------------------------------------
// THIS ROUTE DID NOT EXIST ON THIS APP BEFORE PHASE 2, AND THAT WAS A DEAD END
// ---------------------------------------------------------------------------
// `bk invite accept` is a bare verb: it goes to whichever deployment you are
// homed on. Only `apps/issues` served it, so a sales-homed CLI could be sent an
// invitation, be shown the link, and have nowhere to POST it — while the accept
// page the invitation link points at (`<this origin>/invitations/{token}`) 404'd
// as well. Sales could create invitations nobody could ever accept.
//
// It is not a shared factory because acceptance writes THIS app's membership
// table inside THIS app's transaction; there is nothing generic left once the
// tenancy tables are the app's.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { acceptInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required')

  const result = await acceptInvitation(token, user.id, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation')
      case 'expired':
        throw Errors.conflict('invitation_expired', 'This invitation has expired')
      case 'revoked':
        throw Errors.conflict('invitation_revoked', 'This invitation was revoked')
      case 'accepted':
        throw Errors.conflict('invitation_already_accepted', 'This invitation was already accepted')
      case 'email_mismatch':
        // Whose address the token was for is not something the holder of the
        // token gets to learn.
        throw Errors.forbidden('This invitation is not for your account')
    }
  }
  return NextResponse.json({
    accepted: true,
    workspace_id: result.workspace_id,
    workspace_slug: result.workspace_slug,
    already_member: result.already_member,
  })
})
