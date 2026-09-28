// `/dashboard/{ws}/settings` — the workspace's name, members, invitations and
// danger zone. Since 2026-09-28 (decision D-C reversed); the body is
// `components/workspace/workspace-settings.tsx`, built from the sections every
// blackcode app shares. The layout above has already refused a slug this person
// is not a member of, with a 404.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { PageShell } from '@/components/section'
import { BooksWorkspaceSettings } from '@/components/workspace/workspace-settings'

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')
  return (
    <PageShell>
      <div className="mx-auto max-w-3xl">
        <BooksWorkspaceSettings ws={ws} userId={user.id} />
      </div>
    </PageShell>
  )
}
