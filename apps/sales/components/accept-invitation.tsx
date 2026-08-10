'use client'

// Accept or decline, from the invitation landing page.
//
// Both go through this app's own `/api/invitations/{accept,decline}` — routes
// that did not exist on this deployment before Phase 2. Accepting redirects into
// the workspace by SLUG, which the route returns: the client never has to guess
// where the person now belongs.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { apiSend } from '@/lib/client'

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run(action: 'accept' | 'decline') {
    setBusy(true)
    try {
      const res = await apiSend<{ workspace_slug?: string }>(
        'POST',
        `/api/invitations/${action}`,
        { token }
      )
      if (action === 'accept') {
        toast.success('Welcome aboard')
        router.push(res.workspace_slug ? `/dashboard/${res.workspace_slug}` : '/dashboard')
      } else {
        toast.success('Invitation declined')
        router.push('/dashboard')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="flex justify-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => run('accept')}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run('decline')}
        className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  )
}
