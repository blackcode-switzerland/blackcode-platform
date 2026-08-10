// Settings → Members. **The screen this whole refactor is for.**
//
// Until 2026-08-10 nobody could be added to b/sales from b/sales: membership was
// `platform.workspace_members` plus a per-app grant, so a sales user was
// somebody who had first been invited into an ISSUES workspace. This page reads
// and writes `sales.workspace_members` and `sales.invitations`.
//
// Server component, like the rest of settings: it resolves WHICH workspace and
// WHETHER the caller owns it, and hands both to the client. Asking the client to
// work out the workspace would mean a second, weaker copy of the rule
// `app/dashboard/page.tsx` states — and a members list rendered against the
// wrong workspace is silent.
//
// There is one workspace per person (PLAN.md §1), so no picker: this page uses
// the same "the one you have" answer `/api/meta` reports. The plural case is
// `app/dashboard/page.tsx`'s picker, and if this app ever grows a switcher the
// workspace becomes a route segment here too.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { MemberSettings } from '@/components/settings/member-settings'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const ws = mine[mine.length - 1]
  // The layout's empty has already rendered instead of this page when there are
  // none. Reaching here with zero would mean the two disagreed.
  if (!ws) return null

  return <MemberSettings ws={ws.slug} isOwner={ws.member_role === 'owner'} meId={user.id} />
}
