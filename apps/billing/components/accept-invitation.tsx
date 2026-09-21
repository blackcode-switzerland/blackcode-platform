'use client'

// Accept or decline, from `/invitations/{token}`.
//
// Both go through this app's own `POST /api/invitations/{accept,decline}` — the
// routes `bk billing invite accept|decline` call — via `lib/mutations.ts`.
// Accepting lands in the workspace by the SLUG the route returns, so the client
// never guesses where the person now belongs; `router.refresh()` so the shell's
// server-loaded switcher lists it.

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { Button } from '@blackcode/platform-ui/ui/button'
import { useAcceptInvitation, useDeclineInvitation, toastError } from '@/lib/mutations'

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter()
  const accept = useAcceptInvitation()
  const decline = useDeclineInvitation()
  const busy = accept.isPending || decline.isPending

  async function onAccept() {
    try {
      const res = await accept.mutateAsync({ token })
      toast.success(res.already_member ? 'You were already a member' : 'Invitation accepted')
      router.push(res.workspace_slug ? `/dashboard/${encodeURIComponent(res.workspace_slug)}` : '/dashboard')
      router.refresh()
    } catch (e) {
      toastError(e)
    }
  }

  async function onDecline() {
    try {
      await decline.mutateAsync({ token })
      toast.success('Invitation declined')
      router.push('/dashboard')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="flex gap-2">
      <Button onClick={onAccept} disabled={busy} data-testid="accept-invitation">
        <Check size={15} />
        {accept.isPending ? 'Accepting…' : 'Accept'}
      </Button>
      <Button variant="outline" onClick={onDecline} disabled={busy} data-testid="decline-invitation">
        <X size={15} />
        {decline.isPending ? 'Declining…' : 'Decline'}
      </Button>
    </div>
  )
}
