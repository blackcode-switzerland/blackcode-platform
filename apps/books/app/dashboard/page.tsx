// `/dashboard` → `/dashboard/{ws}`.
//
// ===========================================================================
// ONE → OPEN IT. SEVERAL → THE ONE YOU CHOSE, OR ASK ONCE.
// ===========================================================================
// Until 2026-09-28 this resolved several memberships to the first one without
// asking, because decision D-C kept the word "workspace" off every screen and a
// picker is a screen made of it. D-C was reversed (apps/books/docs/frontend.md
// §4): a person can now create workspaces and accept invitations into other
// people's, so being in several is ordinary, and landing in the wrong one with
// no way to the other was the limitation the old header recorded.
//
// So: one membership opens directly; several open the one you last chose
// (`books.user_settings`, written by the switcher, the chooser and `bk books
// workspace use`); several with no choice yet — or a choice you have since left
// — shows the chooser, and choosing is remembered, so it is asked once.
//
// ── ZERO MEMBERSHIPS IS A BOOTSTRAP FAILURE, NOT AN EMPTY STATE ────────────
// It is not the zero-BOOKS screen, which is a normal state for a new employee
// and lives on the overview. This is "sign-in should have created one and did
// not" — `ensureWorkspaceForUser` is best-effort by design, because a sign-in
// must not fail because a workspace could not be minted. So it says what to do
// (sign out and back in retries it) and where to look, and it never mentions the
// word to the reader.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getStoredActiveWorkspaceId, listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { BooksWorkspaceChooser } from '@/components/workspace/workspace-chooser'
import { serverT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function DashboardIndex() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  // THIS APP'S OWN tenancy (`books.workspaces`), never the platform's. Reading
  // `platform.workspaces` here is what 404'd every sales-only account for four
  // phases while every API route returned 200 — see the header of
  // `app/dashboard/[ws]/layout.tsx` in that app. `lib/app-isolation.test.ts`
  // fails the build if this file imports a platform tenancy reader.
  const [mine, storedId] = await Promise.all([
    listWorkspacesForUser(user.id),
    getStoredActiveWorkspaceId(user.id),
  ])

  if (mine.length === 1) redirect(`/dashboard/${mine[0].slug}`)
  // The stored pointer counts only while you are still a member of it.
  const remembered = storedId == null ? undefined : mine.find((w) => w.id === storedId)
  if (remembered) redirect(`/dashboard/${remembered.slug}`)
  if (mine.length > 1) return <BooksWorkspaceChooser workspaces={mine} />

  // Resolved AFTER the redirect, so the ordinary path — everybody who has a
  // workspace — pays nothing for it.
  const t = await serverT()

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-lg font-semibold text-foreground">{t('dashboard.notSetUp')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.notSetUpBody')}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        {t('dashboard.notSetUpBody2', {
          reason: 'ensureWorkspaceForUser failed at sign-in',
          path: '/dashboard/settings',
        })}
      </p>
    </div>
  )
}
