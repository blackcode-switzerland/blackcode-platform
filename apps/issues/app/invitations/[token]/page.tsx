// Public landing page for invitation links. If the invitee is signed out, we
// redirect to login with a callback URL pointing back here. If signed in, we
// show accept/decline UI.

//
// ── 2026-09-28: THE SHARED CARD, AND ONE LEAK CLOSED ──────────────────────────
// The card and the refusal panel are the ones every blackcode app renders
// (`@blackcode/platform-ui/workspace/invitation-card`). And the not-yours
// message used to read "This invitation is for <the invitee's address>": whoever
// held a link learned who it was sent to — an address oracle, which apps/sales,
// apps/billing and apps/books each refuse by naming only the CALLER's address.
// It names only yours now. The refusal order is theirs too: accepted → not
// pending → expired → not yours.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { InvitationProblem } from '@blackcode/platform-ui/workspace/invitation-card'
import { authOptions } from '@/lib/auth'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { AcceptInvitationButton } from '@/components/accept-invitation-button'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)
  }

  const back = (
    <Link href="/dashboard" className="text-primary hover:underline">
      ← Back to dashboard
    </Link>
  )

  const inv = await getInvitationByToken(token)
  const sessionEmail = session.user?.email?.toLowerCase() ?? ''

  let title = 'This invitation can’t be used'
  let message: string | null = null
  if (!inv) {
    title = 'Invitation not found'
    message = 'This invitation link is invalid or has been removed.'
  } else if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status !== 'pending') message = 'This invitation is no longer valid.'
  else if (new Date(inv.expires_at).getTime() < Date.now()) message = 'This invitation has expired.'
  else if (sessionEmail !== inv.email.toLowerCase()) {
    message = `This invitation is not for ${sessionEmail}. Sign in with the address it was sent to.`
  }

  return (
    <main className="min-h-screen bg-background">
      {message || !inv ? (
        <InvitationProblem title={title} back={back}>
          {message}
        </InvitationProblem>
      ) : (
        <AcceptInvitationButton token={token} workspaceName={inv.workspace_name} signedInAs={sessionEmail} />
      )}
    </main>
  )
}
