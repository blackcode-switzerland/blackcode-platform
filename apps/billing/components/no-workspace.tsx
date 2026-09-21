'use client'

// The "your account exists, but it has no billing workspace" screen.
//
// Since phase 2 (2026-09-21) it is a FAILURE screen, not a first-run state and
// not a forced step. `/dashboard` runs the sign-in bootstrap
// (`ensureWorkspaceForUser`, one transaction, idempotent) for any validated
// visitor with no workspace — including one whose session arrived from another
// blackcode app — and redirects into the result. This renders only when that
// bootstrap threw, and it shows the error rather than a guess at the cause.
//
// The recoveries: reload (the bootstrap is idempotent, so retrying is safe),
// create a named workspace by hand (the same `POST /api/workspaces` that
// `bk billing workspace create` calls), or sign out and back in.

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { RotateCw } from 'lucide-react'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'

export function NoWorkspace({ email, error }: { email: string; error?: string | null }) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-foreground">Your workspace couldn&rsquo;t be set up</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A workspace is created for you the first time you open this dashboard, and that step
            failed. Reloading retries it safely — it never creates a second one.
          </p>
          {error && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-left font-mono text-xs text-destructive"
              data-testid="bootstrap-error"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 text-sm">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
          >
            <RotateCw size={13} />
            Try again
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
          >
            Sign out and back in
          </button>
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
              Or create one yourself, with a name of your choosing — the same as{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                bk billing workspace create --name &quot;Acme SA&quot;
              </code>
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Signed in as <strong className="text-foreground">{email}</strong>. A workspace is a{' '}
          <strong className="text-foreground">tenant</strong>, not an issuing entity — several
          companies can bill from one.
        </p>
      </div>
    </div>
  )
}
