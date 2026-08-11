// Members — who is in this workspace, and who has been invited into it.
//
// ── IT WAS `/dashboard/settings/members` UNTIL 2026-08-11 ───────────────────
//
// It sat beside profile, account, tokens and preferences, and it was the only
// one of the five that is not about the ACCOUNT. The account is one
// `platform.users` row shared by every blackcode app; a member list is
// `sales.workspace_members`, this app's alone, scoped to one workspace. Filing
// them together made the workspace look like a property of the person.
//
// So it moved into the workspace segment, where the slug is in the URL instead
// of being guessed, and into the sidebar, where a thing people use weekly
// belongs. That is `app/dashboard/settings/layout.tsx`'s reasoning run the other
// way: settings is about the account, members is about the workspace.
//
// The old path is a redirect, not a 404 — see `app/dashboard/settings/members/`.
//
// ── WHAT THE SERVER SETTLES, AND WHY IT IS NOT THE CLIENT ───────────────────
//
// WHICH workspace and WHETHER the caller owns it. Asking the client to work out
// the workspace would be a second, weaker copy of a rule the URL already states,
// and a members list rendered against the wrong workspace is silent. The parent
// `app/dashboard/[ws]/layout.tsx` has already established that the slug is one
// this person is a member of — an unreachable slug is a 404 there — so the
// lookup below cannot fail for a reason the reader would need explained.

import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { MemberSettings } from '@/components/settings/member-settings'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const here = mine.find((w) => w.slug === ws)
  // The layout 404s first. This repeats it rather than asserting it: a page is
  // reachable on its own, and a layout's conclusions are not passed down as data.
  if (!here) notFound()

  return <MemberSettings ws={here.slug} isOwner={here.member_role === 'owner'} meId={user.id} />
}
