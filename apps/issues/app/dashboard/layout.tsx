import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { DashboardLayout } from '@/components/dashboard-layout'
import { OnboardingCreateWorkspace } from '@/components/onboarding-create-workspace'

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Validates soft-delete + password-reset session invalidation. A reset signs
  // you out of the dashboard everywhere.
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  // Two different empties, and telling them apart is the whole point.
  //
  // ONE LIST since 2026-08-10 (refactor Phase 5). There were two: `reachable`
  // (app-scoped through `platform.app_access`) and `memberships` (the raw list),
  // compared so that a member with no app access was not shown "create your
  // first workspace" — a screen that quietly works, by making them owner of a
  // second workspace nobody asked for, while hiding the real problem.
  //
  // These are this app's workspaces now, so the two lists were the same list.
  // The empty case below means what it says again: you belong to none.
  const memberships = await listMyWorkspaces(user.id)

  // Invariant: a user always works inside a workspace. New accounts get one
  // auto-created at signup; this is the safety net if someone reaches zero
  // (e.g. they deleted their last workspace, or an older account predates the
  // auto-create). Show a full-screen "create your first workspace" instead of
  // a broken dashboard.
  if (memberships.length === 0) {
    const base = user.name?.trim() || user.email.split('@')[0] || 'My'
    return <OnboardingCreateWorkspace defaultName={`${base}'s Workspace`} />
  }

  // ── THE "NO ACCESS TO <APP>" SCREEN WAS HERE, AND WENT ON 2026-08-10 ────────
  // It rendered for somebody who was a member of workspaces but granted this app
  // in none of them, named those workspaces, and pointed at Workspace settings →
  // Apps. All three of its parts are gone: the grants, the panel it pointed at,
  // and the state itself. A member of one of THIS app's workspaces is a user of
  // this app, so the branch could never be taken again — and a screen nobody can
  // reach reads to the next person as protection.
  //
  // `apps/sales` deleted its own copy of this screen in Phase 2 for the same
  // reason; this is the other half of that change.

  return <DashboardLayout>{children}</DashboardLayout>
}
