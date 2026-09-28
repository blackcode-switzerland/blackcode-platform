'use client'

// Accept / Decline on `/invitations/{token}` — the shared `InvitationCard`
// (since 2026-09-28), wired to this app's writes.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { InvitationCard } from '@blackcode/platform-ui/workspace/invitation-card'
import { useAcceptInvitation, useDeclineInvitation, toastError } from '@/lib/mutations'

export function AcceptInvitation({
  token,
  workspaceName,
  inviter,
  signedInAs,
  appName,
}: {
  token: string
  workspaceName: string
  inviter: string
  signedInAs: string
  appName: string
}) {
  const router = useRouter()
  const accept = useAcceptInvitation()
  const decline = useDeclineInvitation()

  return (
    <InvitationCard
      workspace={{ name: workspaceName }}
      inviter={inviter}
      signedInAs={signedInAs}
      labels={{ invitedYou: (who) => `${who} invited you to their ${appName} workspace.` }}
      detail="As a member you can see and work on its companies and invoices; the owner keeps the workspace’s administration."
      footer={
        <>
          The same from a terminal:{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">bk billing invite accept &lt;token&gt;</code>
        </>
      }
      onAccept={async () => {
        try {
          const res = await accept.mutateAsync({ token })
          toast.success(res.already_member ? 'You were already a member' : 'Invitation accepted')
          router.push(res.workspace_slug ? `/dashboard/${encodeURIComponent(res.workspace_slug)}` : '/dashboard')
          router.refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      }}
      onDecline={async () => {
        try {
          await decline.mutateAsync({ token })
          toast.success('Invitation declined')
          router.push('/dashboard')
        } catch (e) {
          toastError(e)
          throw e
        }
      }}
    />
  )
}
