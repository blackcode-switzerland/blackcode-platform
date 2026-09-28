// Where an invitation link lands — `/invitations/{token}` (phase 2, 2026-09-21).
//
// The invitation email and the `accept_url` in `POST …/invitations`' response
// both point here, on THIS app's origin. Until phase 2 the page did not exist,
// so every link this app handed out was a 404: `apps/sales` shipped the same
// dead end in its phase 1 and closed it the same way.
//
// Signed out → login, with a callbackUrl back here, so the link survives the
// round trip. Signed in → who invited you, to what, and the two buttons.
//
// `getValidatedSessionUser`, not a bare session read, for the reason
// `/cli/authorize` gives: a session minted before the account's last password
// reset must be sent to sign in, not shown a button whose route will 401.
//
// The refusal ORDER matches `app/api/invitations/[token]/route.ts` and is a
// security property: the email check is LAST, and its message names the
// signed-in address — never the invitation's. Change one, change both.
//
// The card and the refusal panel are the shared ones since 2026-09-28
// (`@blackcode/platform-ui/workspace/invitation-card`), on this app's site frame.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { InvitationProblem } from '@blackcode/platform-ui/workspace/invitation-card'
import { APP_NAME } from '@/lib/app'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { SiteFrame } from '@/components/landing/site-chrome'
import { AcceptInvitation } from '@/components/accept-invitation'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)

  const back = (
    <Link href="/dashboard" className="text-primary hover:underline">
      ← Go to the dashboard
    </Link>
  )

  const inv = await getInvitationByToken(token)
  if (!inv) {
    return (
      <SiteFrame>
        <InvitationProblem title="Invitation not found" back={back}>
          This link is not valid, or the invitation has been removed. Ask whoever invited you to send another.
        </InvitationProblem>
      </SiteFrame>
    )
  }

  const expired = new Date(inv.expires_at).getTime() < Date.now()
  const matches = user.email.toLowerCase() === inv.email.toLowerCase()

  let message: string | null = null
  if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status !== 'pending') message = 'This invitation is no longer valid.'
  else if (expired) message = 'This invitation has expired. Ask the workspace owner to send another.'
  else if (!matches) message = `This invitation is not for ${user.email}. Sign in with the address it was sent to.`

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
          signedInAs={user.email}
          appName={APP_NAME}
        />
      )}
    </SiteFrame>
  )
}
