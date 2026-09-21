// POST /api/invitations/decline — `bk billing invite decline <token>`, and the
// "Decline" button on `/invitations/{token}`. The pair of ./accept (phase 2).
//
// The row ends `revoked`: `billing.invitations`' CHECK has no `declined`. See
// `declineInvitation`.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { declineInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required', 'bk billing invite decline <token>')

  const result = await declineInvitation(token, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation_not_found', 'no such invitation', 'run `bk billing invite pending`')
      case 'email_mismatch':
        throw Errors.forbidden('This invitation is not for your account', 'sign in as the address it was sent to', 'invitation_not_yours')
      case 'already_resolved':
        throw Errors.conflict('invitation_already_resolved', 'This invitation is no longer pending', null)
    }
  }
  return NextResponse.json({ declined: true })
})
