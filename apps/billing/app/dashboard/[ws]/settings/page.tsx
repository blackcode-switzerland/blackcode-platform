// Workspace settings — rename, members (remove / transfer / leave),
// invitations, and the danger zone (phase 2, 2026-09-21).
//
// Same pattern as the rest of `[ws]/**`: the server resolves WHICH workspace
// and WHETHER the caller owns it, because the slug is user input and
// `app/dashboard/[ws]/layout.tsx` has already established it as one this
// person is a member of (an unreachable slug 404s there) — this page repeats
// the membership lookup rather than trusting a value passed down, the same
// reason every other page under `[ws]/**` does.
//
// This route is NOT one of the `/dashboard/settings/*` account pages — see
// that layout's header for why those are filed separately. A workspace's own
// name and membership are properties of the WORKSPACE.

import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { PageHeader, PageBody } from '@/components/shell'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const here = mine.find((w) => w.slug === ws)
  if (!here) notFound()

  return (
    <>
      <PageHeader title="Settings" titleTestId="page-title" />
      <PageBody>
        <div className="mx-auto max-w-3xl">
          <WorkspaceSettings ws={here.slug} isOwner={here.member_role === 'owner'} userId={user.id} />
        </div>
      </PageBody>
    </>
  )
}
