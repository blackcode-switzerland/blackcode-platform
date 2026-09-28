'use client'

// Accept or decline, from the invitation landing page.
//
// Both go through this app's own `/api/invitations/{accept,decline}` — routes
// that did not exist on this deployment before Phase 2. Accepting redirects into
// the workspace by SLUG, which the route returns: the client never has to guess
// where the person now belongs.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { InvitationCard } from '@blackcode/platform-ui/workspace/invitation-card'
import { apiSend } from '@/lib/client'

export function AcceptInvitation({
  token,
  workspaceName,
  inviter,
  signedInAs,
}: {
  token: string
  workspaceName: string
  inviter: string
  signedInAs: string
}) {
  const router = useRouter()

  async function run(action: 'accept' | 'decline') {
    try {
      const res = await apiSend<{ workspace_slug?: string }>('POST', `/api/invitations/${action}`, { token })
      if (action === 'accept') {
        toast.success('Welcome aboard')
        router.push(res.workspace_slug ? `/dashboard/${res.workspace_slug}` : '/dashboard')
        router.refresh()
      } else {
        toast.success('Invitation declined')
        router.push('/dashboard')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      throw e
    }
  }

  return (
    <InvitationCard
      workspace={{ name: workspaceName }}
      inviter={inviter}
      signedInAs={signedInAs}
      labels={{ invitedYou: (who) => `${who} invited you to their b/sales pipeline.` }}
      onAccept={() => run('accept')}
      onDecline={() => run('decline')}
    />
  )
}
