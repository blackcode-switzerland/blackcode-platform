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
//   0 workspaces        → the no-workspace screen (an anomaly; see its header)
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
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, Plus } from 'lucide-react'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
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

  if (mine.length === 0) {
    // Reaching here with none means the sign-in bootstrap did not run or did
    // not finish; `?new=1` makes no difference — the empty screen already
    // offers the same create form.
    return <NoWorkspace email={user.email} />
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
