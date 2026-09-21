// POST /api/invitations/accept — `bk billing invite accept <token>`, and the
// "Accept" button on `/invitations/{token}`.
//
// Phase 2 (2026-09-21). Until then this app could CREATE invitations that
// nobody could redeem: the accept link pointed at a page that did not exist and
// the CLI's `invite accept` was not built for this group. `apps/sales` shipped
// the same dead end in its own phase 1 and closed it the same way.
//
// Not a shared factory: acceptance writes THIS app's membership table inside
// THIS app's transaction (`acceptInvitation`).
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { acceptInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required', 'bk billing invite accept <token>')

  const result = await acceptInvitation(token, user.id, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation_not_found', 'no such invitation', 'run `bk billing invite pending`')
      case 'expired':
        throw Errors.conflict('invitation_expired', 'This invitation has expired', 'ask the workspace owner to send another')
      case 'revoked':
        throw Errors.conflict('invitation_revoked', 'This invitation was revoked', 'ask the workspace owner to send another')
      case 'accepted':
        throw Errors.conflict('invitation_already_accepted', 'This invitation was already accepted', 'run `bk billing workspace list`')
      case 'email_mismatch':
        // Whose address it was for is not the token-holder's to learn.
        throw Errors.forbidden('This invitation is not for your account', 'sign in as the address it was sent to', 'invitation_not_yours')
    }
  }
  return NextResponse.json({
    accepted: true,
    workspace_id: result.workspace_id,
    workspace_slug: result.workspace_slug,
    already_member: result.already_member,
  })
})
