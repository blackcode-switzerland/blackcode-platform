// The workspace frame: membership decided here, then the shell.
//
// A slug in the URL is user input. One this person is not a member of is a
// **404**, never a 403 — a 403 would confirm the workspace exists, which is the
// fact that must not leak. The API answers the same question the same way
// (`getWorkspaceForUser` is null for both), so the two surfaces agree.
//
// ── THIS APP'S OWN MEMBERSHIPS, NEVER THE PLATFORM'S ────────────────────────
// `listWorkspacesForUser` reads `billing.workspaces`. apps/sales' version of
// this file read the shared `platform.workspaces` for four phases after its
// workspaces moved, and 404'd every sales-only account while every API route
// returned 200. `lib/app-isolation.test.ts` fails the build if a file here
// imports a platform tenancy reader.
//
// The switcher's list comes from the SAME query as the 404, so the sidebar
// paints with the right names on first render and can never disagree with it.

import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { APP_NAME } from '@/lib/app'
import { BillingShell } from '@/components/shell/billing-shell'

export const dynamic = 'force-dynamic'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ ws: string }>
}) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)
  if (!memberships.some((w) => w.slug === ws)) notFound()

  // Only what the client needs — no `owner_id`, no timestamps across the wire.
  const workspaces = memberships.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    member_role: w.member_role,
  }))

  return (
    <BillingShell ws={ws} workspaces={workspaces} appName={APP_NAME}>
      {children}
    </BillingShell>
  )
}
