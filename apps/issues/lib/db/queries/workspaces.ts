// Workspace CRUD + member queries.
//
// Membership rules (enforced here, mirrored in §1.2 of architecture-rebuild.md):
//   - createWorkspace inserts the workspace + owner membership + counter + the
//     app registry rows atomically.
//   - getWorkspaceForUser returns the row only if the user is an active member.
//     App access is a SEPARATE gate — see lib/api/workspace-context.ts.
//   - transferOwnership moves the 'owner' role to another existing member.
//   - deleteWorkspace cascades (FKs handle it) — caller verifies role first.
//
// Phase 4 added a second axis — a workspace could be visible to you as a member
// and still not be one you may use THIS app in — and multiAppFinalRefactor Phase 5
// removed it again on 2026-08-10. These are `apps/issues`' workspaces now, so
// membership is the whole of the answer and `listMyWorkspaces` takes no `app`.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  users,
  workspaces,
  workspaceCounters,
  workspaceMembers,
  type Workspace,
  type WorkspaceMember,
} from '../schema'
import {
  getMembership as platformGetMembership,
  getWorkspaceById as platformGetWorkspaceById,
  getWorkspaceForUser as platformGetWorkspaceForUser,
  listMyWorkspaces as platformListMyWorkspaces,
  listWorkspaceMembers as platformListWorkspaceMembers,
  removeMember as platformRemoveMember,
  setActiveWorkspace as platformSetActiveWorkspace,
  type WorkspaceWithMembership as PlatformWorkspaceWithMembership,
  renameWorkspaceEntities,
} from '@blackcode/platform-db'
import { APP_SLUG } from '@/lib/app'
import { recordEvent } from './events'

// Aliased, not redeclared. Two structurally identical definitions in two
// packages is two things to keep in step, and the day they disagree the error
// lands somewhere neither of them mentions.
export type WorkspaceWithMembership = PlatformWorkspaceWithMembership

// Moved to @blackcode/platform-db on 2026-08-06 with GET /api/workspaces, now a
// shared route factory (docs/sales-app-plan.md Phase 1b). Bound to this app's
// `db` here so every existing call site is unchanged. It took an optional `app`
// to narrow by `platform.app_access` until Phase 5 dropped that table.
export function listMyWorkspaces(userId: number): Promise<WorkspaceWithMembership[]> {
  return platformListMyWorkspaces(db, userId)
}

// Moved to @blackcode/platform-db on 2026-08-06 with the shared
// `resolveWorkspace` (docs/sales-app-plan.md Phase 1a). Its note on the missing
// `deleted_at` filter went with it.
export function getWorkspaceForUser(
  slugOrId: string,
  userId: number
): Promise<WorkspaceWithMembership | null> {
  return platformGetWorkspaceForUser(db, slugOrId, userId)
}

// Moved to @blackcode/platform-db on 2026-08-06 with /api/upload, which resolves
// the uploader's active workspace through it. One SELECT on platform.workspaces.
export function getWorkspaceById(id: number): Promise<Workspace | null> {
  return platformGetWorkspaceById(db, id)
}

/**
 * Look a workspace up by slug WITHOUT a membership check.
 *
 * Deliberately narrow in who may call it: only the super-admin surface, where
 * the caller is by definition allowed to see every workspace. Every other route
 * must use `getWorkspaceForUser`, which is what makes "not a member" and "does
 * not exist" the same 404 and stops the API confirming which workspaces exist.
 */
export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
  return rows[0] ?? null
}

// Allocate the next issue sequence atomically. Must run inside a transaction
// alongside the issue insert so that an aborted insert rolls back the seq.
export async function allocateNextIssueSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_issue_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_issue_seq = last_issue_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_issue_seq
  `)
  const next = rows.rows[0]?.last_issue_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

// Allocate the next project sequence atomically (workspace-scoped #number).
export async function allocateNextProjectSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_project_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_project_seq = last_project_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_project_seq
  `)
  const next = rows.rows[0]?.last_project_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

// Allocate the next task sequence atomically (workspace-scoped #number).
export async function allocateNextTaskSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_task_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_task_seq = last_task_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_task_seq
  `)
  const next = rows.rows[0]?.last_task_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

export interface CreateWorkspaceInput {
  name: string
  ownerId: number
  slug?: string
  logo_url?: string
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const slug = await pickAvailableSlug(input.slug ?? slugify(input.name))

  return await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: input.name,
        slug,
        logo_url: input.logo_url,
        owner_id: input.ownerId,
      })
      .returning()
    if (!ws) throw new Error('workspace insert returned nothing')

    await tx.insert(workspaceMembers).values({
      workspace_id: ws.id,
      user_id: input.ownerId,
      role: 'owner',
    })

    await tx.insert(workspaceCounters).values({
      workspace_id: ws.id,
      last_issue_seq: 0,
    })

    // MEMBERSHIP INSERT SITE 1 of 2 (the other is acceptInvitation).
    //
    // `enableAllAppsForWorkspace` ran here until 2026-08-10, in this same
    // transaction, and the reason it had to was that a membership row committing
    // without its `app_access` row was a person who is a member of a workspace
    // they cannot open. Phase 5 removed the second row entirely: the membership
    // insert above IS the grant, so there is nothing left that can commit
    // half-done. This path still serves three entry points — explicit workspace
    // create, POST /api/auth/register, and OAuth first login via lib/auth.ts →
    // ensureDefaultWorkspace — and now none of them can lock anybody out.

    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerId,
      entityType: 'workspace',
      entityId: ws.id,
      action: 'created',
      diff: { after: { name: ws.name, slug: ws.slug } },
    })
    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerId,
      entityType: 'workspace_member',
      entityId: input.ownerId,
      action: 'member_added',
      meta: { user_id: input.ownerId, role: 'owner', via: 'workspace_create' },
    })

    return ws
  })
}

// Guarantees the "every user has a workspace" invariant. Called on account
// creation (credentials signup + fresh Google sign-in). Idempotent: if the
// user already belongs to a workspace it does nothing except ensure an active
// workspace is selected.
export async function ensureDefaultWorkspace(
  userId: number,
  displayName: string | null | undefined,
  email: string
): Promise<void> {
  const existing = await listMyWorkspaces(userId)
  if (existing.length > 0) {
    // They have a workspace (e.g. joined one via invitation). Make sure one is
    // marked active so the dashboard isn't stuck on an empty selection.
    const rows = await db
      .select({ active: users.active_workspace_id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!rows[0]?.active) {
      await setActiveWorkspace(userId, existing[0].id)
    }
    return
  }
  const base = displayName?.trim() || email.split('@')[0] || 'My'
  const ws = await createWorkspace({ name: `${base}'s Workspace`, ownerId: userId })
  await setActiveWorkspace(userId, ws.id)
}

export interface UpdateWorkspaceInput {
  name?: string
  slug?: string
  logo_url?: string | null
}

export async function updateWorkspace(
  id: number,
  patch: UpdateWorkspaceInput,
  actorUserId: number
): Promise<Workspace | null> {
  const before = await getWorkspaceById(id)
  if (!before) return null

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.logo_url !== undefined) updates.logo_url = patch.logo_url
  if (patch.slug !== undefined) updates.slug = await pickAvailableSlug(slugify(patch.slug), id)

  if (Object.keys(updates).length === 0) {
    return before
  }

  updates.updated_at = new Date()

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning()
    if (!row) return null

    // A URN embeds the workspace slug, so renaming the workspace rewrites every
    // URN in it. Links follow automatically — their foreign keys into
    // `platform.entities` are ON UPDATE CASCADE — which is what makes "a link
    // survives a rename" a property of the schema rather than of this call site
    // being remembered. Same transaction as the slug update: a rename that
    // committed without this would leave every URN in the workspace pointing at
    // a slug that no longer exists.
    if (row.slug !== before.slug) {
      await renameWorkspaceEntities(tx, id, before.slug, row.slug)
    }

    await recordEvent(tx, {
      workspaceId: id,
      actorUserId,
      entityType: 'workspace',
      entityId: id,
      action: 'updated',
      diff: {
        before: pickWorkspaceDiff(before),
        after: pickWorkspaceDiff(row),
      },
    })
    return row
  })
}

function pickWorkspaceDiff(w: Workspace) {
  return { name: w.name, slug: w.slug, logo_url: w.logo_url }
}

export async function deleteWorkspace(id: number): Promise<boolean> {
  const result = await db.delete(workspaces).where(eq(workspaces.id, id))
  return (result.rowCount ?? 0) > 0
}

// Transfer ownership: bumps current owner to 'member', promotes the target to
// 'owner', updates workspaces.owner_id. The target must already be a member.
// Throws if not.
export async function transferOwnership(
  workspaceId: number,
  newOwnerUserId: number,
  actorUserId: number
): Promise<void> {
  await db.transaction(async (tx) => {
    const ws = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    if (!ws[0]) throw new Error('workspace_not_found')

    const memberRow = await tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, newOwnerUserId)
        )
      )
      .limit(1)
    if (!memberRow[0]) throw new Error('not_a_member')

    if (ws[0].owner_id === newOwnerUserId) return

    const previousOwner = ws[0].owner_id

    await tx
      .update(workspaceMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, previousOwner)
        )
      )
    await tx
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, newOwnerUserId)
        )
      )
    await tx
      .update(workspaces)
      .set({ owner_id: newOwnerUserId, updated_at: new Date() })
      .where(eq(workspaces.id, workspaceId))

    // Two `syncAppAccessRole` calls stood here, keeping `app_access.role` in step
    // with the membership role so the mirror did not become a lie after a
    // transfer. The mirror is gone with the table (2026-08-10) and
    // `workspace_members.role`, updated above, is the only role there is.

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'ownership_transferred',
      meta: { previous_owner_user_id: previousOwner, new_owner_user_id: newOwnerUserId },
    })
  })
}

// Moved to @blackcode/platform-db on 2026-08-06 with GET /api/workspaces/{ws}/members.
export function listWorkspaceMembers(workspaceId: number) {
  return platformListWorkspaceMembers(db, workspaceId)
}

export function getMembership(
  workspaceId: number,
  userId: number
): Promise<WorkspaceMember | null> {
  return platformGetMembership(db, workspaceId, userId)
}

// Moved to @blackcode/platform-db on 2026-08-06 with
// DELETE /api/workspaces/{ws}/members/{userId}, now a shared factory. It could
// not move earlier: it records an event, and until D-23 the only recorder was
// this app's. The app_access cascade note went with it.
export function removeMember(
  workspaceId: number,
  userId: number,
  actorUserId: number
): Promise<boolean> {
  return platformRemoveMember({ db, app: APP_SLUG }, workspaceId, userId, actorUserId)
}

// NOTE: there is deliberately no `addMember` here. It existed until Phase 4 as a
// third `insert(workspaceMembers)` with no callers — `invitations.ts` imported it
// only to re-export it. Membership now carries an app_access grant written in the
// same transaction (see grantDefaultAppAccess), so a bare membership insert is a
// lockout waiting to be wired up. The two real membership paths are
// createWorkspace (above) and acceptInvitation (invitations.ts); add a third only
// by going through the same helper.

// True if the user is the 'owner' of at least one (non-deleted) workspace.
// Used to gate trust-bar UIs like the public error detail view.
export async function isWorkspaceOwnerSomewhere(userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.user_id, userId), eq(workspaceMembers.role, 'owner')))
    .limit(1)
  return rows.length > 0
}

// Moved to @blackcode/platform-db on 2026-08-06 with POST /api/me/active-workspace.
export function setActiveWorkspace(userId: number, workspaceId: number | null): Promise<void> {
  return platformSetActiveWorkspace(db, userId, workspaceId)
}

// ----- slug/key generation -----

const SLUG_MAX = 40

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
  return base || 'workspace'
}

async function pickAvailableSlug(desired: string, excludeId?: number): Promise<string> {
  const base = slugify(desired)
  return await pickAvailable(base, async (candidate) => {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1)
    if (!rows[0]) return true
    return excludeId !== undefined && rows[0].id === excludeId
  }, SLUG_MAX)
}

async function pickAvailable(
  base: string,
  isAvailable: (candidate: string) => Promise<boolean>,
  maxLen: number
): Promise<string> {
  if (await isAvailable(base)) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n)
    const room = Math.max(1, maxLen - suffix.length)
    const candidate = (base.slice(0, room) + suffix).slice(0, maxLen)
    if (await isAvailable(candidate)) return candidate
  }
  throw new Error(`could not find available identifier from base ${base}`)
}

// Bulk lookup of memberships used across the workspace queries.
export async function userIsMemberOf(userId: number, workspaceIds: number[]): Promise<Set<number>> {
  if (workspaceIds.length === 0) return new Set()
  const rows = await db
    .select({ workspace_id: workspaceMembers.workspace_id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.user_id, userId),
        inArray(workspaceMembers.workspace_id, workspaceIds)
      )
    )
  return new Set(rows.map((r) => r.workspace_id))
}
