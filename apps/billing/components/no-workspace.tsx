'use client'

// The "your account exists, but it has no billing workspace" screen.
//
// It is an ANOMALY screen, not the normal first-run state: `lib/auth.ts` mints
// a workspace on every sign-in (`ensureWorkspaceForUser`, one transaction,
// idempotent) and `POST /api/auth/register` does the same at sign-up. Reaching
// here means that best-effort bootstrap did not run or did not finish — a
// session that travelled here from another blackcode app without ever
// completing this app's own sign-in is the one case that is expected, since
// this app's own bootstrap only runs on this app's sign-in path.
//
// `CreateWorkspaceForm` below is the same explicit act `bk billing workspace
// create` performs — the manual recovery when "sign out and back in" does not
// self-heal it.

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { RotateCw } from 'lucide-react'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'

export function NoWorkspace({ email }: { email: string }) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-foreground">No workspace yet</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your account exists, but it has no workspace here. One is normally created the moment
            you sign in — so this usually means that step did not finish, or your session arrived
            from another blackcode app without ever completing this app&rsquo;s own sign-in.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A workspace is a <strong className="text-foreground">tenant</strong>, not an issuing
            entity — one is enough even if you bill under several companies, which live inside it.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
          >
            <RotateCw size={13} />
            Sign out and back in
          </button>
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
          >
            Account settings
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4 text-left">
          {showCreate ? (
            <>
              <h2 className="mb-3 text-sm font-medium text-foreground">Create a workspace</h2>
              <CreateWorkspaceForm />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              data-testid="show-create-workspace"
              className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Or create one yourself, right now — the same as{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                bk billing workspace create --name &quot;Acme SA&quot;
              </code>
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Signed in as <strong className="text-foreground">{email}</strong>. Until the
          invitation-accept flow lands, a workspace you create is yours alone — you can send an
          invitation, but nobody can redeem it yet.
        </p>
      </div>
    </div>
  )
}
