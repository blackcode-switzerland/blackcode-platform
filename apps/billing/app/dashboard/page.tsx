// `/dashboard` — resolves which workspace to open, or shows the empty state.
//
// ===========================================================================
// A SERVER COMPONENT IS NOT A ROUTE
// ===========================================================================
// This page reads the database DIRECTLY: `listWorkspacesForUser`, no `fetch`,
// no `/api/…`, no bearer token. That is the shape that cost `apps/sales` four
// phases of being broken — see `lib/app-isolation.test.ts`'s header and
// `apps/billing/docs/frontend.md`. It reads THIS app's own tables
// (`billing.workspaces`) and nothing platform-wide.
//
// ===========================================================================
// WHAT MOVED HERE FROM THE OLD PHASE-0 PAGE
// ===========================================================================
// The old page rendered the team list and pending invitations inline. That
// content now lives at `/dashboard/[ws]/settings` (workstream S) — this page's
// job is narrower: land the visitor in a workspace, or let them create one.
//
// ===========================================================================
// THE THREE CASES
// ===========================================================================
//   0 workspaces        → a pending invitation for this address? open it.
//                          Otherwise BOOTSTRAP one (below) and redirect into
//                          it. The no-workspace screen is only the fallback
//                          for a bootstrap that threw, and shows the error.
//   1 workspace          → redirect straight there, unless `?new=1`
//   several workspaces   → redirect to the REMEMBERED one
//                          (`billing.user_settings`, migration 0014 — until
//                          2026-09-28 this read `platform.users
//                          .active_workspace_id`, which this app never writes,
//                          so it never matched), when it is still one of ours;
//                          otherwise the shared chooser, whose rows keep the
//                          `workspace-<slug>` testids a Playwright walk
//                          depends on, and which remembers the choice
//   `?new=1`              → always shows the create-workspace screen instead
//                          of redirecting, regardless of count — the
//                          workspace switcher's "Create workspace" link uses it
//
// ===========================================================================
// A PAGE THAT WRITES — THE ONE EXCEPTION, AND WHY IT IS SAFE (phase 2)
// ===========================================================================
// Somebody signed in on another blackcode app arrives here on the shared
// session cookie having never taken THIS app's sign-in path, which is where
// `ensureWorkspaceForUser` runs. In production (2026-09-21) that person got a
// "No workspace yet" screen and a forced step. So when a validated user with no
// billing workspace reaches `/dashboard`, this page runs the SAME bootstrap
// sign-in runs, and redirects into the result.
//
// Server components in this app otherwise only read. This one may write because:
//   - it is the same function as sign-in and register — not a second
//     implementation of workspace creation (`mintWorkspace` is shared);
//   - it is idempotent: it keys on MEMBERSHIP and re-checks inside its
//     transaction, so a reload, two tabs, or a race with a sign-in cannot
//     mint two workspaces;
//   - membership is the whole gate (`lib/api.ts`), so minting one grants this
//     person nothing but a tenant of their own — no other app's data, and
//     nobody else's;
//   - it runs only for `getValidatedSessionUser()`, i.e. a real, unrevoked
//     account that reached this app's own dashboard — the act of opening it.
//
// This REVERSES the phase-0 position written at `createWorkspaceForUser`
// ("bootstrapping on first authenticated request … is wrong for this app"):
// that argued a tenant appearing because somebody loaded a page is one nobody
// decided to create. Loading `/dashboard` of this app IS the decision — the same
// one signing in at `/login` already was — and the explicit alternative cost
// every cross-app visitor a dead-end screen. Nothing is minted for `/api/*`,
// for another app's pages, or for `?new=1` (an explicit create, which shows the
// named-workspace form instead).
//
// A pending invitation wins over a mint: somebody invited into an existing
// workspace should land on the invitation, not in an empty tenant of their own.
import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { ensureWorkspaceForUser, getStoredActiveWorkspaceId, listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { listPendingInvitationsForEmail } from '@/lib/db/queries/invitations'
import { NoWorkspace } from '@/components/no-workspace'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'
import { BillingWorkspaceChooser } from '@/components/workspace-chooser'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>
}) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const sp = await searchParams
  const wantsCreate = sp.new === '1'

  const mine = await listWorkspacesForUser(user.id)

  if (mine.length === 0 && !wantsCreate) {
    // `redirect()` throws, so it stays OUTSIDE the try: a caught NEXT_REDIRECT
    // would be reported as a failed bootstrap.
    let target: string | null = null
    let failure: string | null = null
    try {
      const pending = await listPendingInvitationsForEmail(user.email)
      if (pending[0]) {
        target = `/invitations/${pending[0].token}`
      } else {
        const { workspace } = await ensureWorkspaceForUser(user.id, user.name ?? null, user.email)
        target = `/dashboard/${workspace.slug}`
      }
    } catch (err) {
      console.error('ensureWorkspaceForUser failed on /dashboard:', err)
      failure = err instanceof Error ? err.message : String(err)
    }
    if (target) redirect(target)
    return <NoWorkspace email={user.email} error={failure} />
  }

  if (!wantsCreate) {
    if (mine.length === 1) redirect(`/dashboard/${mine[0].slug}`)

    // More than one: go where they last were, if that is still a workspace
    // they belong to. `getWorkspaceForUser`-style membership is already
    // implied by `mine`, so this is a plain lookup, not a second query.
    const storedId = await getStoredActiveWorkspaceId(user.id)
    const remembered = storedId != null ? mine.find((w) => w.id === storedId) : undefined
    if (remembered) redirect(`/dashboard/${remembered.slug}`)
  }

  if (!wantsCreate) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BillingWorkspaceChooser workspaces={mine} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Create a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace is a tenant — one is enough even if you bill under several companies, which live inside it.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <CreateWorkspaceForm />
        </div>
      </div>
    </div>
  )
}
