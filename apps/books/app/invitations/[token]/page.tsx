// `/invitations/{token}` — where every invitation this app sends points.
//
// It did not exist until 2026-09-28: `acceptUrl()` had always built this path,
// so every invite link books handed out 404'd. Ported from apps/billing, on the
// shared `InvitationCard`.
//
// THE REFUSAL ORDER IS A SECURITY PROPERTY — accepted → not pending → expired →
// not yours — and it matches `app/api/invitations/[token]/route.ts`. The
// not-yours message names the CALLER's address, never the invitation's: whose
// invitation a token is for is not something the holder of a link gets to learn.
// Signed out, the page sends you to sign in and back here.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { InvitationProblem } from '@blackcode/platform-ui/workspace/invitation-card'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { serverT } from '@/lib/i18n-server'
import { SiteFrame } from '@/components/site-chrome'
import { BooksInvitationCard } from '@/components/workspace/invitation-actions'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)

  const t = await serverT()
  const back = (
    <Link href="/dashboard" className="text-primary hover:underline">
      {t('ws.backToBooks')}
    </Link>
  )

  const inv = await getInvitationByToken(token)
  let problem: string | null = null
  if (!inv) problem = t('ws.invNotFound')
  else if (inv.status === 'accepted') problem = t('ws.invAccepted')
  else if (inv.status !== 'pending') problem = t('ws.invNotPending')
  else if (new Date(inv.expires_at).getTime() < Date.now()) problem = t('ws.invExpired')
  else if (user.email.toLowerCase() !== inv.email.toLowerCase()) problem = t('ws.invNotYours', { email: user.email })

  return (
    <SiteFrame>
      {problem || !inv ? (
        <InvitationProblem title={inv ? t('ws.invUnusableTitle') : t('ws.invNotFoundTitle')} back={back}>
          {problem}
        </InvitationProblem>
      ) : (
        <BooksInvitationCard
          token={token}
          workspaceName={inv.workspace_name}
          inviter={inv.invited_by_name ?? inv.invited_by_email}
          signedInAs={user.email}
        />
      )}
    </SiteFrame>
  )
}
