// Workspace settings — name, transfer ownership, delete. New 2026-09-11 with
// the D-3 reversal.
//
// Same pattern as `app/dashboard/[ws]/members/page.tsx`: the server resolves
// WHICH workspace and WHETHER the caller owns it, because the URL's slug is
// user input and the parent `app/dashboard/[ws]/layout.tsx` has already
// established it as one this person is a member of (an unreachable slug 404s
// there). This page repeats the membership lookup rather than trusting a
// value passed down, for the same reason `members/page.tsx` does: a page is
// reachable on its own and a layout's conclusions are not passed down as data.
//
// This route is NOT `/dashboard/settings/*` (the account pages, outside the
// workspace segment) — see `app/dashboard/settings/layout.tsx`'s header for
// why those four are filed there. A workspace's own name, ownership and
// existence are properties of the WORKSPACE, the same reasoning that moved
// Members out of `/dashboard/settings/members` on 2026-08-11.
import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const here = mine.find((w) => w.slug === ws)
  if (!here) notFound()

  return <WorkspaceSettings ws={here.slug} isOwner={here.member_role === 'owner'} />
}
