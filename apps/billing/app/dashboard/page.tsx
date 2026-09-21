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
//                          (`platform.users.active_workspace_id`, resolved
//                          against THIS app's membership so it can only ever
//                          point at a workspace of ours) when there is one;
//                          otherwise a chooser, listing every workspace with
//                          the `workspace-<slug>` testids a Playwright walk
//                          depends on
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
import Link from 'next/link'
import { Building2, Plus } from 'lucide-react'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { ensureWorkspaceForUser, listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { listPendingInvitationsForEmail } from '@/lib/db/queries/invitations'
import { NoWorkspace } from '@/components/no-workspace'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'

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
    const remembered =
      user.active_workspace_id != null
        ? mine.find((w) => w.id === user.active_workspace_id)
        : undefined
    if (remembered) redirect(`/dashboard/${remembered.slug}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {wantsCreate ? 'Create a workspace' : 'Choose a workspace'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {wantsCreate
              ? 'A workspace is a tenant — one is enough even if you bill under several companies, which live inside it.'
              : `You can reach ${mine.length} workspaces here. This choice is remembered — switch any time from the sidebar.`}
          </p>
        </div>

        {wantsCreate ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <CreateWorkspaceForm />
          </div>
        ) : (
          <>
            <div className="space-y-1.5" data-testid="workspaces">
              {mine.map((w) => (
                <Link
                  key={w.id}
                  href={`/dashboard/${w.slug}`}
                  data-testid={`workspace-${w.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{w.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{w.slug}</span>
                  </span>
                </Link>
              ))}
            </div>
            <Link
              href="/dashboard?new=1"
              data-testid="new-workspace"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus size={14} />
              Create workspace
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
