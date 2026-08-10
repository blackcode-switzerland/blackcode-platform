// Preferences is per (user, WORKSPACE) — `sales.user_preferences`' primary key.
//
// So this page resolves the workspaces this person can reach and hands them to
// the client, which renders one block each. With one workspace (D-3, the normal
// case) that is a single block and nobody notices; with two it is two blocks
// rather than a setting that silently applies to whichever one the code happened
// to pick. Landing somebody's toggle in the wrong workspace is exactly the class
// of silent failure `app/dashboard/page.tsx` refuses to commit with its picker.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { PreferenceSettings } from '@/components/settings/preference-settings'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const reachable = await listWorkspacesForUser(user.id)
  return (
    <PreferenceSettings workspaces={reachable.map((w) => ({ slug: w.slug, name: w.name }))} />
  )
}
