'use client'

// Accept / Decline on `/invitations/{token}` — the shared `InvitationCard`
// (since 2026-09-28), wired to this app's routes. Accepting also makes the new
// workspace the active one and opens it.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { InvitationCard } from '@blackcode/platform-ui/workspace/invitation-card'

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    toast.error(j.error ?? 'Something went wrong')
    throw new Error(j.error ?? 'failed')
  }
  return j
}

export function AcceptInvitationButton({
  token,
  workspaceName,
  signedInAs,
}: {
  token: string
  workspaceName: string
  signedInAs: string
}) {
  const router = useRouter()
  return (
    <InvitationCard
      workspace={{ name: workspaceName }}
      inviter=""
      signedInAs={signedInAs}
      labels={{ invitedYou: () => 'You have been invited to join this workspace in b/issues.' }}
      footer={
        <>
          The same from a terminal:{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">bk issues invite accept &lt;token&gt;</code>
        </>
      }
      onAccept={async () => {
        const data = await post('/api/invitations/accept', { token })
        await fetch('/api/me/active-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: data.workspace_id }),
        })
        toast.success('Joined workspace')
        router.push('/dashboard')
        router.refresh()
      }}
      onDecline={async () => {
        await post('/api/invitations/decline', { token })
        toast.info('Invitation declined')
        router.push('/dashboard')
      }}
    />
  )
}
