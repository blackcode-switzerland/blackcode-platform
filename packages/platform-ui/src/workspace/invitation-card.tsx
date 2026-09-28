'use client'

// `/invitations/{token}` — one card for every app (2026-09-28), modelled on
// apps/billing's page. The PAGE stays the app's: it resolves the token on the
// server and decides, in the security order its route header records
// (accepted → not-pending → expired → not-yours), whether to render this card
// or `InvitationProblem`. The card only accepts or declines, through callbacks.

import { useState } from 'react'
import { Check, Loader2, MailOpen, X } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkspaceMark } from './workspace-mark'
import { withDefaults, type WorkspaceLabels } from './labels'

function Frame({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl" data-testid={testId}>
        {children}
      </div>
    </div>
  )
}

export function InvitationCard({
  workspace,
  inviter,
  signedInAs,
  detail,
  footer,
  onAccept,
  onDecline,
  labels,
}: {
  workspace: { name: string; logo_url?: string | null }
  inviter: string
  signedInAs: string
  /** What membership means in this app, in its own nouns. */
  detail?: React.ReactNode
  footer?: React.ReactNode
  onAccept: () => Promise<void>
  onDecline: () => Promise<void>
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  async function run(kind: 'accept' | 'decline') {
    setBusy(kind)
    try {
      await (kind === 'accept' ? onAccept() : onDecline())
    } catch {
      // Shown by the app.
    } finally {
      setBusy(null)
    }
  }

  return (
    <Frame testId="invitation">
      <div className="mb-6 flex items-center gap-3">
        {workspace.logo_url ? (
          <WorkspaceMark name={workspace.name} logoUrl={workspace.logo_url} size={40} />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <MailOpen size={20} className="text-primary" />
          </span>
        )}
        <span className="min-w-0">
          <h1 className="truncate text-lg font-semibold" data-testid="invitation-workspace">
            {L.joinTitle(workspace.name)}
          </h1>
          <p className="text-xs text-muted-foreground">{L.signedInAs(signedInAs)}</p>
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{L.invitedYou(inviter)}</p>
      {detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => void run('accept')} disabled={busy !== null} data-testid="accept-invitation">
          {busy === 'accept' ? <Loader2 className="animate-spin" /> : <Check />}
          {busy === 'accept' ? L.accepting : L.accept}
        </Button>
        <Button variant="outline" onClick={() => void run('decline')} disabled={busy !== null} data-testid="decline-invitation">
          <X />
          {L.decline}
        </Button>
      </div>
      {footer && <div className="mt-6 text-xs text-muted-foreground">{footer}</div>}
    </Frame>
  )
}

/** Why an invitation link cannot be used — every refusal state, one shape. */
export function InvitationProblem({
  title,
  children,
  back,
}: {
  title: React.ReactNode
  children: React.ReactNode
  /** A link back into the app, rendered by the app (it owns the router). */
  back?: React.ReactNode
}) {
  return (
    <Frame testId="invitation-refused">
      <h1 className="mb-2 text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      {back && <div className="mt-6 text-sm">{back}</div>}
    </Frame>
  )
}
