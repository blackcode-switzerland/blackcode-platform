// Writing membership and invitations — the platform mutations that record an
// event.
//
// ---------------------------------------------------------------------------
// WHY THESE COULD NOT MOVE BEFORE 2026-08-06
// ---------------------------------------------------------------------------
// Every function here writes through the event spine, and until D-23 the only
// recorder was `apps/issues`'s `recordEvent` — which resolves a subject URN from
// that app's tables and fans out through rules written in its nouns. So six
// shared routes could not be shared: not because of what they did, but because
// of what recording them dragged in.
//
// `recordPlatformEvent` is the seam, and these are the first callers of it that
// are not an app.
//
// ---------------------------------------------------------------------------
// `WriteContext` — WHY THE APP SLUG IS A PARAMETER AND NOT A CONSTANT
// ---------------------------------------------------------------------------
// `platform.events.app` is the PRODUCING app: whoever wrote the row, not what
// the row is about. A member removed from the sales deployment is a sales event
// even though membership belongs to no app, because "which app did this happen
// in" is the question the activity feed's `?app=` filter asks.
//
// It travels in a `WriteContext` rather than as a bare second string
// deliberately: `createInvitation` ALREADY has an `app` field, meaning something
// different — the app the invitee is being invited INTO. Two adjacent string
// parameters called `app` with different meanings is a bug waiting for a
// distracted afternoon.

import { randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { PlatformDb } from './client'
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from './schema'
import { recordPlatformEvent } from './events-write'

/** Who is writing: the client, and the app that will own the event rows. */
export interface WriteContext {
  db: PlatformDb
  /** `AppContext.appSlug` — never a literal. See the header. */
  app: string
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function getMembership(
  db: PlatformDb,
  workspaceId: number,
  userId: number
): Promise<WorkspaceMember | null> {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspace_id, workspaceId), eq(workspaceMembers.user_id, userId))
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Remove one member from a workspace.
 *
 * Removing a member also removes their `app_access` — by FK cascade, not by code
 * here. `app_access`'s primary FK is to `workspace_members (workspace_id,
 * user_id) ON DELETE CASCADE`, which is why this needed no Phase 4 change and why
 * a future third removal path cannot forget to do it. Verified on the rehearsal
 * branch: deleting one membership row took its `app_access` row with it.
 *
 * The event is `member_left` when somebody removes themselves and
 * `member_removed` otherwise — the fan-out tells the removed person, and telling
 * them about their own action is noise.
 */
export async function removeMember(
  w: WriteContext,
  workspaceId: number,
  userId: number,
  actorUserId: number
): Promise<boolean> {
  return await w.db.transaction(async (tx) => {
    const result = await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspace_id, workspaceId), eq(workspaceMembers.user_id, userId))
      )
    const removed = (result.rowCount ?? 0) > 0
    if (removed) {
      const isSelf = actorUserId === userId
      await recordPlatformEvent(tx, {
        app: w.app,
        workspaceId,
        actorUserId,
        entityType: 'workspace_member',
        entityId: userId,
        action: isSelf ? 'member_left' : 'member_removed',
        meta: { user_id: userId },
      })
    }
    return removed
  })
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const DEFAULT_TTL_DAYS = 14
const TOKEN_BYTES = 32

/**
 * A token is 32 random bytes, base64url-encoded — but never one that begins
 * with `-`.
 *
 * base64url's alphabet includes `-`, so about 1 in 32 tokens used to start with
 * one, and every one of those was unredeemable from the CLI: `bk invite accept
 * -Jx…` made cobra read the token as a flag and fail with `unknown shorthand
 * flag: 'J'` before the request was ever sent. Hit for real during Phase 4
 * verification.
 *
 * The CLI now reads that argument literally, but only in versions from 1.10.0
 * on. Refusing to mint the token here is what protects every binary already
 * installed, which is the population we cannot upgrade.
 *
 * Rejection is on the FIRST character only, and the rest of the string keeps the
 * full alphabet: it costs ~0.05 bits of the token's 256 and leaves the retry
 * loop expected to run 1.03 times.
 *
 * Shared rather than injected: the constraint is about the `bk` binary, which is
 * one binary for every app, so an app supplying its own generator is an app that
 * can reintroduce a token nobody can redeem.
 */
export function generateInvitationToken(): string {
  for (;;) {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    if (!token.startsWith('-')) return token
  }
}

export interface CreateInvitationInput {
  workspaceId: number
  email: string
  invitedBy: number
  role?: 'member'
  ttlDays?: number
  // ── `app` (the DESTINATION app) WAS HERE. GONE 2026-08-11, migration 0046. ──
  // "Invite this person straight into one app; set, it also grants that app even
  // if the app is 'invite_only' there — the invitation is the grant."
  //
  // There is nothing to grant. Phase 5 dropped `platform.app_access` and
  // `platform.workspace_apps`: an invitation is into ONE workspace, that
  // workspace belongs to exactly one app, and accepting it makes you a member of
  // that app. To give somebody access to another app, invite them from that app.
  //
  // The route has REJECTED an `app` in the request body since 2026-08-10 with a
  // 400 that names the change (`app_not_accepted`) — that stays, and it is the
  // part an older client meets. What goes is the parameter behind it, which
  // every caller was already passing as a hardcoded null.
  //
  // Note the header above still distinguishes this from `WriteContext.app` (who
  // is WRITING, which remains). That ambiguity is why the two were never merged.
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitation
  /**
   * True if the invitee already had an account at the time of invite. The caller
   * uses it to decide whether to surface an inbox message or only a copy-link UI.
   */
  invitee_has_account: boolean
}

/**
 * Invite an email address to a workspace.
 *
 * Throws `already_member` or `invalid_email` as bare `Error`s — the ROUTE turns
 * those into a 409 / 400 with a suggestion, because this package does not decide
 * what a denial looks like.
 */
export async function createInvitation(
  w: WriteContext,
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw new Error('invalid_email')
  }

  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  return await w.db.transaction(async (tx) => {
    // Block: invitee is already a member.
    const existing = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.user_id))
      .where(
        and(
          eq(workspaceMembers.workspace_id, input.workspaceId),
          sql`lower(${users.email}) = ${email}`
        )
      )
      .limit(1)
    if (existing[0]) throw new Error('already_member')

    // Revoke any prior pending invitations for the same email.
    const revoked = await tx
      .update(workspaceInvitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(workspaceInvitations.workspace_id, input.workspaceId),
          sql`lower(${workspaceInvitations.email}) = ${email}`,
          eq(workspaceInvitations.status, 'pending')
        )
      )
      .returning({ id: workspaceInvitations.id })

    for (const r of revoked) {
      await recordPlatformEvent(tx, {
        app: w.app,
        workspaceId: input.workspaceId,
        actorUserId: input.invitedBy,
        entityType: 'invitation',
        entityId: r.id,
        action: 'invitation_revoked',
        meta: { reason: 'superseded' },
      })
    }

    const token = generateInvitationToken()
    const [row] = await tx
      .insert(workspaceInvitations)
      .values({
        workspace_id: input.workspaceId,
        email,
        invited_by: input.invitedBy,
        role: input.role ?? 'member',
        token,
        status: 'pending',
        expires_at: expiresAt,
      })
      .returning()
    if (!row) throw new Error('insert failed')

    await recordPlatformEvent(tx, {
      app: w.app,
      workspaceId: input.workspaceId,
      actorUserId: input.invitedBy,
      entityType: 'invitation',
      entityId: row.id,
      action: 'invitation_created',
      meta: { email },
    })

    const account = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, sql`${users.deleted_at} IS NULL`))
      .limit(1)

    return { invitation: row, invitee_has_account: !!account[0] }
  })
}

export async function revokeInvitation(
  w: WriteContext,
  id: number,
  workspaceId: number,
  actorUserId: number
): Promise<boolean> {
  return await w.db.transaction(async (tx) => {
    const result = await tx
      .update(workspaceInvitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(workspaceInvitations.id, id),
          eq(workspaceInvitations.workspace_id, workspaceId),
          eq(workspaceInvitations.status, 'pending')
        )
      )
      .returning({ id: workspaceInvitations.id })

    if (result.length === 0) return false

    await recordPlatformEvent(tx, {
      app: w.app,
      workspaceId,
      actorUserId,
      entityType: 'invitation',
      entityId: id,
      action: 'invitation_revoked',
      meta: { reason: 'owner_action' },
    })
    return true
  })
}

export interface InvitationListItem extends WorkspaceInvitation {
  invited_by_email: string | null
  invited_by_name: string | null
  workspace_name: string
  workspace_slug: string
}

export async function listWorkspaceInvitations(
  db: PlatformDb,
  workspaceId: number,
  options: { includeNonPending?: boolean } = {}
): Promise<InvitationListItem[]> {
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
    // leftJoin, and the fallbacks below are the reason: an invitation outlives
    // the workspace it names, and a listing that dropped those rows would hide
    // history rather than report it.
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(
      options.includeNonPending
        ? eq(workspaceInvitations.workspace_id, workspaceId)
        : and(
            eq(workspaceInvitations.workspace_id, workspaceId),
            eq(workspaceInvitations.status, 'pending')
          )
    )
    .orderBy(desc(workspaceInvitations.created_at))

  return rows.map((r) => ({
    ...r.inv,
    invited_by_email: r.invited_by_email,
    invited_by_name: r.invited_by_name,
    workspace_name: r.workspace_name ?? '(deleted)',
    workspace_slug: r.workspace_slug ?? '',
  }))
}
