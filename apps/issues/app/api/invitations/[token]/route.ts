// GET /api/invitations/{token} — `bk issues invite show <token>`.
//
// The mirror of `apps/sales`' route of the same path, and both exist for the
// same reason: `/invitations/{token}` renders who invited you and to which
// workspace BEFORE you commit, while an agent handed a raw token from the CLI
// could only `accept` it blind. Found by the 2026-08-11 web⇄CLI parity audit
// (§4.2) — the only real capability gap it found in either direction.
//
// Per-app rather than a shared factory because each app reads its OWN
// invitations table: this one is `platform.workspace_invitations`, sales' is
// `sales.invitations`. Same URL, same response shape, different tenancy.
//
// ---------------------------------------------------------------------------
// THE REFUSAL ORDER IS A SECURITY PROPERTY
// ---------------------------------------------------------------------------
//   accepted → not-pending → expired → not-yours
//
// **The email check is LAST and its message names the CALLER's address, never
// the invitation's.** Whose invitation a token is for is not something the
// holder of a token gets to learn — otherwise a link becomes an oracle for "who
// was invited where". `app/invitations/[token]/page.tsx` says the same in its
// own comment; if you change one, change both, and sales' copy too.
//
// The token is not the credential: a caller must be SIGNED IN as well as
// holding it, exactly as `accept` requires.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { getUserById } from '@/lib/db/queries/users'

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
      'check the token, or run `bk issues invite pending` to list invitations addressed to you'
    )
  }

  if (inv.status === 'accepted') {
    throw Errors.badRequest('invitation_already_accepted', 'this invitation has already been accepted')
  }
  if (inv.status !== 'pending') {
    throw Errors.badRequest('invitation_not_pending', 'this invitation is no longer valid')
  }
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    throw Errors.badRequest(
      'invitation_expired',
      'this invitation has expired',
      'ask the workspace owner to send another'
    )
  }
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    // Names the CALLER, not the invitee. See the header.
    throw Errors.forbidden(
      `this invitation is not for ${user.email}`,
      'sign in as the address it was sent to',
      'invitation_not_yours'
    )
  }

  const inviter = inv.invited_by ? await getUserById(inv.invited_by) : null

  return NextResponse.json({
    token,
    email: inv.email,
    status: inv.status,
    expires_at: inv.expires_at,
    workspace: { id: inv.workspace_id, name: inv.workspace_name, slug: inv.workspace_slug },
    invited_by: { name: inviter?.name ?? '', email: inviter?.email ?? '' },
  })
})
