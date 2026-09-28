'use client'

// The accept / decline card on `/invitations/{token}` — the shared
// `InvitationCard`, wired to this app's gated writes and its words.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { InvitationCard } from '@blackcode/platform-ui/workspace/invitation-card'
import { useAcceptInvitation, useDeclineInvitation } from '@/lib/mutations'
import { useT } from '@/lib/i18n'
import { WORKSPACE_CLI } from '@/lib/workspace-cli'
import { useWorkspaceLabels } from './labels'

export function BooksInvitationCard({
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
  const t = useT()
  const labels = useWorkspaceLabels()
  const accept = useAcceptInvitation()
  const decline = useDeclineInvitation()

  return (
    <InvitationCard
      workspace={{ name: workspaceName }}
      inviter={inviter}
      signedInAs={signedInAs}
      detail={t('ws.memberDetail')}
      labels={labels}
      footer={
        <>
          {t('ws.cliAccept')}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">{WORKSPACE_CLI.inviteAccept}</code>
        </>
      }
      onAccept={async () => {
        const res = await accept.run({ token })
        if (!res.ok) {
          toast.error(res.message)
          throw res.error
        }
        toast.success(res.data.already_member ? t('ws.toastAlreadyMember') : t('ws.toastAccepted'))
        router.push(`/dashboard/${encodeURIComponent(res.data.workspace_slug)}`)
        router.refresh()
      }}
      onDecline={async () => {
        const res = await decline.run({ token })
        if (!res.ok) {
          toast.error(res.message)
          throw res.error
        }
        toast.success(t('ws.toastDeclined'))
        router.push('/dashboard')
      }}
    />
  )
}
