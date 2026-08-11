// A REDIRECT, not a 404. Members moved to `/dashboard/{ws}/members` on
// 2026-08-11 (see that file for why), and this path is in people's history, in
// their bookmarks, and in at least one invitation email's "manage your team"
// wording. A 404 where a page used to be is the cheapest bad impression there
// is, and it is indistinguishable from the app being broken.
//
// It resolves the workspace the same way the settings frame around it does —
// the first membership, deterministic ordering — because the old URL never named
// one and there is nothing in it to carry over. With no membership at all there
// is nowhere to send anybody, so it falls back to `/dashboard`, which owns the
// "no workspace yet" screen.
//
// Delete this when the redirect has stopped being taken. It is not load-bearing
// and nothing else depends on it.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const ws = mine[0]?.slug
  redirect(ws ? `/dashboard/${ws}/members` : '/dashboard')
}
