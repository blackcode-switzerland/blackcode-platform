// `/dashboard` → `/dashboard/{ws}`.
//
// ===========================================================================
// THERE IS NO PICKER HERE, AND THAT IS DECISION D-C READ THROUGH
// ===========================================================================
// `apps/sales` renders a "Choose a workspace" screen when somebody belongs to
// more than one. b/books must not: **the word "workspace" never appears on
// screen**, and a picker is a screen made entirely of it. `[ws]` stays in the URL
// because the platform route factories require it, and it is never explained to
// the reader.
//
// So more-than-one resolves deterministically to the first membership rather
// than asking. That is a guess, and it is worth being honest about what it costs
// — but the shape of this product is what makes it cheap:
//
//   - A person gets ONE personal workspace, minted at sign-in
//     (`ensureWorkspaceForUser`, on every sign-in, both providers).
//   - There is no invite flow and no members page in this app (D-C), so a second
//     membership cannot be created from the b/books UI at all.
//   - The thing a reader actually chooses between is BOOKS, and that control is
//     in the top bar on every page (`?entity=`). A workspace is not a book —
//     that is D1 in the plan and the first sentence of
//     `apps/books/docs/frontend.md` §4.
//
// If a person ever does end up in two, the cost is that they land in one of them
// with no way to reach the other from the UI. That is a real limitation and it
// is recorded rather than hidden — see the sprint-1 report. The fix, if it is
// ever needed, is a switcher that talks about BOOKS and resolves quietly, not a
// screen that teaches platform tenancy.
//
// ── ZERO MEMBERSHIPS IS A BOOTSTRAP FAILURE, NOT AN EMPTY STATE ────────────
// It is not the zero-BOOKS screen, which is a normal state for a new employee
// and lives on the overview. This is "sign-in should have created one and did
// not" — `ensureWorkspaceForUser` is best-effort by design, because a sign-in
// must not fail because a workspace could not be minted. So it says what to do
// (sign out and back in retries it) and where to look, and it never mentions the
// word to the reader.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'

export const dynamic = 'force-dynamic'

export default async function DashboardIndex() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  // THIS APP'S OWN tenancy (`books.workspaces`), never the platform's. Reading
  // `platform.workspaces` here is what 404'd every sales-only account for four
  // phases while every API route returned 200 — see the header of
  // `app/dashboard/[ws]/layout.tsx` in that app. `lib/app-isolation.test.ts`
  // fails the build if this file imports a platform tenancy reader.
  const mine = await listWorkspacesForUser(user.id)
  const first = mine[0]

  if (first) redirect(`/dashboard/${first.slug}`)

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-lg font-semibold text-foreground">Your account is not set up yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signing in should have finished setting up your account. It is best-effort and idempotent,
        so signing out and back in retries it.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        If it keeps failing, the server log carries the reason —{' '}
        <span className="font-mono text-[12.5px]">ensureWorkspaceForUser failed at sign-in</span>.
        Your account settings are still reachable at{' '}
        <a href="/dashboard/settings" className="text-primary-strong hover:underline">
          /dashboard/settings
        </a>
        .
      </p>
    </div>
  )
}
