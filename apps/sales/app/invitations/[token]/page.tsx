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
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { AcceptInvitation } from '@/components/accept-invitation'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)
  }

  const inv = await getInvitationByToken(token)
  if (!inv) {
    return (
      <Shell title="Invitation not found">
        This link is not valid, or the invitation has been removed.
      </Shell>
    )
  }

  const expired = new Date(inv.expires_at).getTime() < Date.now()
  const sessionEmail = session.user?.email?.toLowerCase()
  const matches = sessionEmail === inv.email.toLowerCase()

  // Order matters: the email check comes LAST of the refusals that name a
  // reason, and its message names no address. Whose invitation a token is for is
  // not something the holder of the token gets to learn — the API says the same.
  let message: string | null = null
  if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status !== 'pending') message = 'This invitation is no longer valid.'
  else if (expired) message = 'This invitation has expired.'
  else if (!matches) {
    message = `This invitation is not for ${sessionEmail}. Sign in with the address it was sent to.`
  }

  if (message) return <Shell title="b/sales">{message}</Shell>

  return (
    <Shell title={`Join ${inv.workspace_name}`}>
      <p>
        {inv.invited_by_name ?? inv.invited_by_email} invited you to their b/sales
        pipeline.
      </p>
      <AcceptInvitation token={token} />
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-20">
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div className="space-y-4 text-sm text-muted-foreground">{children}</div>
        <Link href="/dashboard" className="inline-block text-xs text-primary hover:underline">
          Go to b/sales →
        </Link>
      </div>
    </main>
  )
}
