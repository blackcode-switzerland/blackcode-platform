import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { SalesShell } from '@/components/sales-shell'

/**
 * The workspace frame.
 *
 * A slug in the URL is user input, so it is checked here rather than trusted:
 * an unreachable one is a **404**, not a 403. A 403 confirms the workspace
 * exists, and for a workspace this person is not in, its existence is exactly
 * the fact that must not leak. The API layer settles the same question the same
 * way (`getWorkspaceForUser` returns null for both cases and lets the caller
 * choose), so the two surfaces agree.
 *
 * ── IT READ `platform.workspaces` UNTIL 2026-08-10, AND 404'd EVERYONE ───────
 * This was `listMyWorkspaces(getDb(), user.id, { app: APP_SLUG })` — the SHARED
 * platform membership list, filtered by `platform.app_access`. Phase 2 moved
 * this app's workspaces to `sales.workspaces` and the sibling
 * `dashboard/layout.tsx` was repointed; this file, one directory down, was not.
 *
 * MEASURED, not reasoned about: a brand-new sales signup — the exact user Phase
 * 2 exists to create — got **404 on their own dashboard**, because they have no
 * `platform.workspaces` row at all. The whole sales web UI was unreachable for
 * them while every API route worked, which is why four phases of route-level
 * verification did not catch it.
 *
 * Dropping only the `{ app }` filter would have been WORSE than leaving it: the
 * page would then match any PLATFORM workspace sharing this slug, and migration
 * 0004 mirrored ids and slugs on purpose. That is a cross-tenant frame. It has
 * to be this app's own source, which is what it is now.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ ws: string }>
}) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)
  if (!memberships.some((w) => w.slug === ws)) notFound()

  return <SalesShell ws={ws}>{children}</SalesShell>
}
