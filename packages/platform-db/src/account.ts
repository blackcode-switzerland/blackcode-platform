// One person's own account: read it, edit it, close it — plus the invitations
// waiting for them.
//
// All `platform.*`: users, api_tokens, inbox_messages, workspaces,
// workspace_members, workspace_invitations. An account is not an app's to own —
// there is one login for every app (docs/platform-architecture.md §6) — so
// `/api/me` had to become a shared factory the moment a second app grew a UI.
//
// Moved from `apps/issues/lib/db/queries/{users,invitations}.ts` on 2026-08-06
// (docs/sales-app-plan.md Phase 1b, D-2). The app files re-export these bound to
// their own `db`, so every existing call site is unchanged.

import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { PlatformDb } from './client'
import {
  apiTokens,
  apps,
  inboxMessages,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type User,
} from './schema'

export async function getUserById(db: PlatformDb, id: number): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return rows[0] ?? null
}

export interface UpdateUserProfileInput {
  name?: string | null
  tagline?: string | null
  avatar_url?: string | null
}

export async function updateUserProfile(
  db: PlatformDb,
  id: number,
  patch: UpdateUserProfileInput
): Promise<User | null> {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.tagline !== undefined) updates.tagline = patch.tagline
  if (patch.avatar_url !== undefined) updates.avatar_url = patch.avatar_url
  if (Object.keys(updates).length === 0) return getUserById(db, id)
  updates.updated_at = new Date()
  const [row] = await db.update(users).set(updates).where(eq(users.id, id)).returning()
  return row ?? null
}

// ---------------------------------------------------------------------------
// Closing an account
// ---------------------------------------------------------------------------

export interface DeleteAccountReport {
  /**
   * WHICH APP THIS REPORT COVERS. Not optional, and not cosmetic.
   *
   * ── WHY IT IS ON THE TYPE AND NOT IN A SENTENCE IN THE UI ──────────────────
   * This function enumerates `platform.workspaces`, which has been `apps/issues`'
   * own table since multiAppFinalRefactor Phase 2. It therefore CANNOT see a
   * person's `sales.workspaces` row, and until 2026-08-11 it did not say so: the
   * dry-run named one workspace and was silent about the other app entirely.
   *
   * **The report was not empty — it was confidently incomplete, which is worse.**
   * An empty report invites suspicion; a partial one reads as authoritative.
   * (Measured in Phase 8; multiAppFinalRefactor/PLAN.md §9 item 8.)
   *
   * Putting the scope in the RETURN TYPE means no caller can render this report
   * without having been handed the answer to "of what?". A comment could be
   * ignored; a required field has to be spent.
   */
  app: { slug: string; name: string }
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_hard_delete: Array<{ workspace_id: number; name: string }>
}

/**
 * What closing this account would do **in one app**, without doing it.
 *
 * A workspace they own with other people in it BLOCKS the deletion — deleting it
 * would take those people's data with it, so ownership has to be transferred
 * first. A workspace they own alone is theirs to destroy.
 *
 * `appSlug` is required rather than defaulted for the reason on
 * `DeleteAccountReport['app']`: the scope of this answer is a fact the caller
 * knows and this function cannot derive, and a default would let it be forgotten.
 */
export async function deleteAccountReport(
  db: PlatformDb,
  userId: number,
  appSlug: string
): Promise<DeleteAccountReport> {
  const rows = await db.execute<{
    workspace_id: number
    name: string
    member_count: number
  }>(sql`
    SELECT w.id AS workspace_id, w.name, COUNT(wm.id)::int AS member_count
    FROM ${workspaces} w
    LEFT JOIN ${workspaceMembers} wm ON wm.workspace_id = w.id
    WHERE w.owner_id = ${userId}
    GROUP BY w.id, w.name
  `)
  const blocked: DeleteAccountReport['blocked_by'] = []
  const willHardDelete: DeleteAccountReport['will_hard_delete'] = []
  for (const r of rows.rows) {
    if (r.member_count > 1) blocked.push(r)
    else willHardDelete.push({ workspace_id: r.workspace_id, name: r.name })
  }
  return { app: await appLabel(db, appSlug), blocked_by: blocked, will_hard_delete: willHardDelete }
}

/**
 * An app's human name from the address book, falling back to its slug.
 *
 * The fallback is deliberate and one-directional: a missing `platform.apps` row
 * must not turn a deletion report into an error. A person is entitled to be told
 * what closing their account would do even if the registry is behind.
 */
async function appLabel(db: PlatformDb, slug: string): Promise<{ slug: string; name: string }> {
  const res = await db.execute<{ name: string }>(
    sql`SELECT name FROM ${apps} WHERE slug = ${slug} LIMIT 1`
  )
  return { slug, name: res.rows[0]?.name ?? slug }
}

/**
 * Soft-delete the user: mark `deleted_at`, clear auth, revoke tokens.
 *
 * One transaction, deliberately. Half of this — tokens revoked, user still
 * active, or the reverse — is worse than either end state.
 */
export async function softDeleteUser(db: PlatformDb, userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Hard-delete sole-owner workspaces (the cascade will sweep their content).
    await tx.execute(sql`
      DELETE FROM ${workspaces} w
      WHERE w.owner_id = ${userId}
        AND (SELECT COUNT(*) FROM ${workspaceMembers} wm WHERE wm.workspace_id = w.id) <= 1
    `)
    // Revoke tokens.
    await tx.execute(sql`DELETE FROM ${apiTokens} WHERE user_id = ${userId}`)
    // Wipe inbox.
    await tx.execute(sql`DELETE FROM ${inboxMessages} WHERE user_id = ${userId}`)
    // Soft delete the user row.
    await tx.execute(sql`
      UPDATE ${users} SET
        deleted_at = now(),
        password_hash = NULL,
        google_id = NULL,
        active_workspace_id = NULL
      WHERE id = ${userId}
    `)
  })
}

// ---------------------------------------------------------------------------
// Invitations addressed to this person
// ---------------------------------------------------------------------------

export type PendingInvitation = typeof workspaceInvitations.$inferSelect & {
  invited_by_email: string | null
  invited_by_name: string | null
  workspace_name: string
  workspace_slug: string
}

/**
 * Pending, unexpired invitations for this email address.
 *
 * Matched case-insensitively on the address, not on a user id: an invitation can
 * predate the account it is for, which is the whole point of inviting by email.
 */
export async function listPendingInvitationsForEmail(
  db: PlatformDb,
  email: string
): Promise<PendingInvitation[]> {
  const normalized = email.trim().toLowerCase()
  const rows = await db
    .select({
      inv: workspaceInvitations,
      invited_by_email: users.email,
      invited_by_name: users.name,
      workspace_name: workspaces.name,
      workspace_slug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .leftJoin(users, eq(users.id, workspaceInvitations.invited_by))
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(
      and(
        sql`lower(${workspaceInvitations.email}) = ${normalized}`,
        eq(workspaceInvitations.status, 'pending'),
        gt(workspaceInvitations.expires_at, new Date())
      )
    )
    .orderBy(desc(workspaceInvitations.created_at))

  // A workspace deleted out from under a pending invitation leaves the row
  // orphaned rather than gone. Render it as "(deleted)" instead of dropping it:
  // an invitation that silently disappears from the list is a support question.
  return rows.map((r) => ({
    ...r.inv,
    invited_by_email: r.invited_by_email,
    invited_by_name: r.invited_by_name,
    workspace_name: r.workspace_name ?? '(deleted)',
    workspace_slug: r.workspace_slug ?? '',
  }))
}
