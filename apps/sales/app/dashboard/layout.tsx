import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'

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
 * `PLATFORM_ENFORCE_APP_ACCESS` is not consulted anywhere in this app any more.
 *
 * ── AND THE REMAINING EMPTY MOVED DOWN A LEVEL ON 2026-08-11 ────────────────
 *
 * The zero-membership screen used to render HERE, instead of `children`, for
 * every route under `/dashboard`. That swallowed `/dashboard/settings/*` too —
 * so the one person who most needs their account pages (their workspace
 * bootstrap failed) was the one person who could not reach them.
 *
 * A layout cannot make the distinction: on the server it has no pathname, and
 * `children` is opaque. So the branch is `app/dashboard/page.tsx`'s now, beside
 * the redirect it already owned, and the screen itself is
 * `components/no-workspace.tsx`. Nothing else became reachable —
 * `app/dashboard/[ws]/layout.tsx` 404s a slug you are not a member of, and with
 * zero memberships that is every slug.
 *
 * What is left here is the one thing that IS true of every route below:
 * you must be signed in, with a session that survives `getValidatedSessionUser`
 * (soft delete, password-reset invalidation).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  return <>{children}</>
}
