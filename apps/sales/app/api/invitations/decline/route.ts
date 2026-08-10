// POST /api/invitations/decline — `bk invite decline <token>`.
//
// The pair of ./accept; see that file's header for why neither existed on this
// app before Phase 2.
//
// The row ends up `revoked`, not `declined`: `sales.invitations`' CHECK has no
// such value, because 0003 dropped a status nothing had ever written. The end
// state is "this invitation will not be honoured", which `revoked` already says.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { declineInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required')

  const result = await declineInvitation(token, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation')
      case 'email_mismatch':
        throw Errors.forbidden('This invitation is not for your account')
      case 'already_resolved':
        throw Errors.conflict('invitation_already_resolved', 'This invitation is no longer pending')
    }
  }
  return NextResponse.json({ declined: true })
})
