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
import { redirect } from 'next/navigation'
import { MailOpen } from 'lucide-react'
import { APP_NAME } from '@/lib/app'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { AcceptInvitation } from '@/components/accept-invitation'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)

  const inv = await getInvitationByToken(token)
  if (!inv) {
    return (
      <Shell title="Invitation not found">
        This link is not valid, or the invitation has been removed. Ask whoever invited you to send
        another.
      </Shell>
    )
  }

  const expired = new Date(inv.expires_at).getTime() < Date.now()
  const matches = user.email.toLowerCase() === inv.email.toLowerCase()

  let message: string | null = null
  if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status !== 'pending') message = 'This invitation is no longer valid.'
  else if (expired) message = 'This invitation has expired. Ask the workspace owner to send another.'
  else if (!matches) {
    message = `This invitation is not for ${user.email}. Sign in with the address it was sent to.`
  }
  if (message) return <Shell title="This invitation can't be used">{message}</Shell>

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl" data-testid="invitation">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <MailOpen size={20} className="text-primary" />
          </span>
          <span className="min-w-0">
            <h1 className="truncate text-lg font-semibold" data-testid="invitation-workspace">
              Join {inv.workspace_name}
            </h1>
            <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>
          </span>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">
            {inv.invited_by_name ?? inv.invited_by_email}
          </strong>{' '}
          invited you to their {APP_NAME} workspace. As a member you can see and work on its
          companies and invoices; the owner keeps the workspace&rsquo;s administration.
        </p>
        <AcceptInvitation token={token} />
        <p className="mt-6 text-xs text-muted-foreground">
          The same from a terminal:{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">bk billing invite accept &lt;token&gt;</code>
        </p>
      </div>
    </div>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl" data-testid="invitation-refused">
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
        <a href="/dashboard" className="mt-6 inline-block text-sm text-primary hover:underline">
          ← Go to the dashboard
        </a>
      </div>
    </div>
  )
}
