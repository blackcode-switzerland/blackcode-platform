// Where an invitation link lands.
//
// ---------------------------------------------------------------------------
// THIS PAGE DID NOT EXIST, AND EVERY INVITATION SENT FROM SALES 404'd
// ---------------------------------------------------------------------------
// The shared invitations factory builds its accept URL as
// `<the serving app's origin>/invitations/{token}` — a convention, and an app
// mounting that route must serve the page. `apps/sales` mounted the route and
// never served the page, so an owner could create an invitation, be handed a
// link, and send somebody to a 404. Found in Phase 2; the brief did not name it.
//
// Signed out → login, with a callbackUrl back here, so the link survives the
// round trip. Signed in → the two buttons.
//
// The card and the refusal panel are the shared ones since 2026-09-28
// (`@blackcode/platform-ui/workspace/invitation-card`), on this app's site frame.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { InvitationProblem } from '@blackcode/platform-ui/workspace/invitation-card'
import { authOptions } from '@/lib/auth'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { SiteFrame } from '@/components/site-chrome'
import { AcceptInvitation } from '@/components/accept-invitation'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)
  }

  const back = (
    <Link href="/dashboard" className="text-primary hover:underline">
      Go to b/sales →
    </Link>
  )

  const inv = await getInvitationByToken(token)
  if (!inv) {
    return (
      <SiteFrame>
        <InvitationProblem title="Invitation not found" back={back}>
          This link is not valid, or the invitation has been removed.
        </InvitationProblem>
      </SiteFrame>
    )
  }

  const expired = new Date(inv.expires_at).getTime() < Date.now()
  const sessionEmail = session.user?.email?.toLowerCase() ?? ''
  const matches = sessionEmail === inv.email.toLowerCase()

  // Order matters: the email check comes LAST of the refusals that name a
  // reason, and its message names no address but the caller's. Whose invitation
  // a token is for is not something the holder of the token gets to learn — the
  // API says the same.
  let message: string | null = null
  if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status !== 'pending') message = 'This invitation is no longer valid.'
  else if (expired) message = 'This invitation has expired.'
  else if (!matches) message = `This invitation is not for ${sessionEmail}. Sign in with the address it was sent to.`

  return (
    <SiteFrame>
      {message ? (
        <InvitationProblem title="This invitation can’t be used" back={back}>
          {message}
        </InvitationProblem>
      ) : (
        <AcceptInvitation
          token={token}
          workspaceName={inv.workspace_name}
          inviter={inv.invited_by_name ?? inv.invited_by_email}
          signedInAs={sessionEmail}
        />
      )}
    </SiteFrame>
  )
}
