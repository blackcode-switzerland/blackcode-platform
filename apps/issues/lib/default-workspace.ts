import { getValidatedSessionUser } from '@/lib/auth/session'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { APP_SLUG } from '@/lib/app'

// Slug of the user's remembered (active) workspace, or their first one.
// Used by the bare /dashboard and legacy redirects to land somewhere sensible.
// Returns null if the user has no session or no workspaces.
//
// "Somewhere sensible" is any workspace they are a member of. It was narrowed by
// `platform.app_access` until 2026-08-10, so that nobody landed on a workspace
// they held membership in but no access to; these are this app's workspaces now
// and membership is the whole of it.
export async function getDefaultWorkspaceSlug(): Promise<string | null> {
  const user = await getValidatedSessionUser()
  if (!user) return null
  const workspaces = await listMyWorkspaces(user.id)
  if (workspaces.length === 0) return null
  const active = workspaces.find((w) => w.id === user.active_workspace_id) ?? workspaces[0]
  return active.slug
}
