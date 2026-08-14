'use client'

// The "your account exists, but it has no b/sales workspace" screen.
//
// ── IT MOVED OUT OF `app/dashboard/layout.tsx` ON 2026-08-11 ────────────────
// It was rendered by the layout, INSTEAD of `children`, for anybody with zero
// memberships. That is the right answer for the workspace-scoped pages and the
// wrong one for `/dashboard/settings/*`, which is where somebody in exactly this
// state goes to check their profile, close their account, or mint a token —
// none of which needs a workspace. A layout cannot tell the two apart: it has no
// pathname on the server, and `children` is opaque to it.
//
// So the branch moved DOWN, to the one page that owns the zero case
// (`app/dashboard/page.tsx`). `app/dashboard/[ws]/layout.tsx` already answers
// the other half — a slug you are not a member of is a 404, and with zero
// memberships every slug is — so nothing became reachable that was not before,
// except settings, deliberately.
//
// It is still an ANOMALY screen, not a normal state: every sign-in mints a
// workspace (`lib/auth.ts` → `ensureWorkspaceForUser`, one transaction), so
// reaching it means that bootstrap failed. Hence the "sign out and back in"
// wording — that is the action which actually retries it.

import Link from 'next/link'
import { signOut } from 'next-auth/react'

export function NoWorkspace({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">No workspace yet</h1>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Your account exists, but it has no b/sales workspace. One is normally
            created the moment you sign in, so this means that step did not finish.
          </p>
          <p>
            Sign out and back in with <strong>{email}</strong> — it retries. If it
            keeps happening, tell an administrator.
          </p>
        </div>
        <div className="flex items-center justify-center gap-4 text-sm">
          {/* Settings is reachable from here on purpose: with no workspace it is
              the only part of the app that still works, and it is where the
              account itself lives. It was NOT reachable before this screen
              moved — the layout swallowed every route under /dashboard. */}
          <Link href="/dashboard/settings/profile" className="text-primary underline">
            Account settings
          </Link>
          {/* `signOut()`, NOT a link to `/api/auth/signout`: that URL renders
              NextAuth's own unstyled confirm page, whose form carries a CSRF
              token. Every other sign-out in this app goes through this call. */}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-primary underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
