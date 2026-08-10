import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'

/**
 * ── THE "NO ACCESS TO B/SALES" GATE IS GONE, AS OF 2026-08-10 ───────────────
 *
 * This file used to render TWO different empties and the whole point was
 * telling them apart: "you belong to no workspace" versus "you belong to one,
 * but b/sales has not been enabled for you there". The second came from
 * `listMyWorkspaces({ app })`, which filtered `platform.workspaces` through
 * `platform.workspace_apps` / `platform.app_access` behind
 * `PLATFORM_ENFORCE_APP_ACCESS`.
 *
 * That distinction was real and is now unrepresentable: a `sales.workspaces` row
 * is this app's, entirely, and **a member of a sales workspace is a sales user**
 * (multiAppFinalRefactor PLAN.md §3, Phase 2 §3e). There is no second app inside
 * it to be switched off, so there is no second empty to describe. Keeping the
 * branch would have left a screen nobody can ever see, which reads to the next
 * reader as protection.
 *
 * The remaining empty also changed meaning, and it is worth saying why it is
 * kept rather than deleted. Every sign-in now mints a workspace
 * (`lib/auth.ts` → `ensureWorkspaceForUser`, one transaction), so reaching this
 * screen means that bootstrap failed. It is an ANOMALY screen now, not the
 * normal state of an internal product nobody self-serves into — hence the
 * "sign out and back in" wording, which is the action that actually retries it.
 *
 * `PLATFORM_ENFORCE_APP_ACCESS` is not consulted anywhere in this app any more.
 * The variable stays set in Vercel until Phase 5 removes it and the two tables
 * it gates.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)

  if (memberships.length === 0) {
    return (
      <Empty title="No workspace yet">
        <p>
          Your account exists, but it has no b/sales workspace. One is normally
          created the moment you sign in, so this means that step did not finish.
        </p>
        <p>
          Sign out and back in with <strong>{user.email}</strong> — it retries.
          If it keeps happening, tell an administrator.
        </p>
      </Empty>
    )
  }

  return <>{children}</>
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
        <a href="/api/auth/signout" className="inline-block text-sm text-primary underline">
          Sign out
        </a>
      </div>
    </div>
  )
}
