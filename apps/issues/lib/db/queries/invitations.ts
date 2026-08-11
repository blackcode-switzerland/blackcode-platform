// Workspace invitation queries.
//
// Flow:
//   1. Owner POSTs an invite for an email. Any prior pending invite for the
//      same (workspace_id, lower(email)) is revoked first. A fresh token is
//      generated.
//   2. The owner shares the token URL out-of-band (Phase 5 will route it via
//      inbox). Anyone with the token can call /api/invitations/accept while
//      authenticated as a matching email — we verify email match server-side.
//   3. On accept: invitation marked accepted, accepted_by + accepted_at set,
//      workspace_members row inserted (idempotent) AND the matching app_access
//      rows granted in the same transaction (Phase 4). An invitation may name an
//      `app` to grant access to one app specifically.
//
// Tokens are 32 raw bytes encoded as base64url (43 chars), never starting with
// `-` — see `generateInvitationToken` in @blackcode/platform-db for why. They
// are random, not derived; we store the literal string. Tokens are unique by
// index.
//
// Creating, revoking and listing invitations moved to that package on
// 2026-08-06 with their routes; what is still written here is ACCEPTING and
// DECLINING, which are Tier 2 (`/api/invitations/{accept,decline}`).

import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import {
  createInvitation as platformCreateInvitation,
  listPendingInvitationsForEmail as platformListPendingInvitationsForEmail,
  listWorkspaceInvitations as platformListWorkspaceInvitations,
  materializePendingInvitationsForUser as platformMaterializePendingInvitationsForUser,
  revokeInvitation as platformRevokeInvitation,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationListItem,
} from '@blackcode/platform-db'
import { APP_SLUG } from '@/lib/app'
import { type WorkspaceInvitation, workspaceInvitations, workspaceMembers, workspaces } from '../schema'
import { recordEvent } from './events'

// Moved to @blackcode/platform-db on 2026-08-06 with the invitations routes,
// now shared factories (docs/sales-app-plan.md Phase 1b-C). They could not move
// earlier: every one records an event, and until D-23 the only recorder was this
// app's. Bound to this app's `db` and `APP_SLUG` here — `APP_SLUG` becomes
// `platform.events.app`, the PRODUCING app.
//
// `generateInvitationToken` went with them, and the reason it must never be
// re-implemented per app went in its doc comment: a token starting with `-` is
// unredeemable by every `bk` binary older than 1.10.0.
export {
  generateInvitationToken,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationListItem,
} from '@blackcode/platform-db'

export function createInvitation(
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  return platformCreateInvitation({ db, app: APP_SLUG }, input)
}

export function revokeInvitation(
  id: number,
  workspaceId: number,
  actorUserId: number
): Promise<boolean> {
  return platformRevokeInvitation({ db, app: APP_SLUG }, id, workspaceId, actorUserId)
}

export function listWorkspaceInvitations(
  workspaceId: number,
  options: { includeNonPending?: boolean } = {}
): Promise<InvitationListItem[]> {
  return platformListWorkspaceInvitations(db, workspaceId, options)
}

export async function getInvitationByToken(
  token: string
): Promise<(WorkspaceInvitation & { workspace_name: string; workspace_slug: string }) | null> {
  const rows = await db
    .select({
      inv: workspaceInvitations,
      workspace_name: workspaces.name,
      workspace_slug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(eq(workspaceInvitations.token, token))
    .limit(1)
  if (!rows[0]) return null
  return {
    ...rows[0].inv,
    workspace_name: rows[0].workspace_name ?? '(deleted)',
    workspace_slug: rows[0].workspace_slug ?? '',
  }
}

// Moved to @blackcode/platform-db on 2026-08-06 with
// GET /api/me/pending-invitations. It matches on the EMAIL, not a user id — an
// invitation can predate the account it is for, which is the point of inviting
// by address.
export function listPendingInvitationsForEmail(email: string) {
  return platformListPendingInvitationsForEmail(db, email)
}

export type AcceptResult =
  | { ok: true; workspace_id: number; already_member: boolean }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'accepted' | 'declined' | 'email_mismatch' }

export async function acceptInvitation(
  token: string,
  acceptingUserId: number,
  acceptingUserEmail: string
): Promise<AcceptResult> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1)
    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' }

    if (inv.email.trim().toLowerCase() !== acceptingUserEmail.trim().toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' }
    }
    if (inv.status === 'revoked') return { ok: false, reason: 'revoked' }
    if (inv.status === 'accepted') return { ok: false, reason: 'accepted' }
    if (inv.status === 'declined') return { ok: false, reason: 'declined' }
    if (inv.expires_at.getTime() < Date.now()) {
      await tx
        .update(workspaceInvitations)
        .set({ status: 'expired' })
        .where(eq(workspaceInvitations.id, inv.id))
      return { ok: false, reason: 'expired' }
    }

    // Idempotent membership insert.
    let alreadyMember = false
    const existing = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, inv.workspace_id),
          eq(workspaceMembers.user_id, acceptingUserId)
        )
      )
      .limit(1)
    if (existing[0]) {
      alreadyMember = true
    } else {
      await tx.insert(workspaceMembers).values({
        workspace_id: inv.workspace_id,
        user_id: acceptingUserId,
        role: 'member',
      })

      // MEMBERSHIP INSERT SITE 2 of 2 (the other is createWorkspace).
      //
      // A `grantDefaultAppAccess` call stood here, in this same transaction,
      // because an invitee who became a member without their `app_access` row
      // got a workspace that rendered empty — the quiet failure Phase 4 was
      // built to avoid. Phase 5 (2026-08-10) removed the second row: this
      // workspace belongs to this app, so the insert above is the whole of
      // joining it. `inv.app` — the app the person was invited INTO, which drove
      // `alsoGrantApp` — has no reader now; the column keeps its history.

      await recordEvent(tx, {
        workspaceId: inv.workspace_id,
        actorUserId: acceptingUserId,
        entityType: 'workspace_member',
        entityId: acceptingUserId,
        action: 'member_added',
        meta: {
          user_id: acceptingUserId,
          role: 'member',
          via: 'invitation',
          invitation_id: inv.id,
        },
      })
    }

    await tx
      .update(workspaceInvitations)
      .set({
        status: 'accepted',
        accepted_at: new Date(),
        accepted_by: acceptingUserId,
      })
      .where(eq(workspaceInvitations.id, inv.id))

    await recordEvent(tx, {
      workspaceId: inv.workspace_id,
      actorUserId: acceptingUserId,
      entityType: 'invitation',
      entityId: inv.id,
      action: 'invitation_accepted',
    })

    return {
      ok: true,
      workspace_id: inv.workspace_id,
      already_member: alreadyMember,
    }
  })
}

export async function declineInvitation(
  token: string,
  acceptingUserId: number,
  acceptingUserEmail: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'email_mismatch' | 'already_resolved' }> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1)
    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' }
    if (inv.email.trim().toLowerCase() !== acceptingUserEmail.trim().toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' }
    }
    if (inv.status !== 'pending') return { ok: false, reason: 'already_resolved' }

    await tx
      .update(workspaceInvitations)
      .set({ status: 'declined' })
      .where(eq(workspaceInvitations.id, inv.id))

    await recordEvent(tx, {
      workspaceId: inv.workspace_id,
      actorUserId: acceptingUserId,
      entityType: 'invitation',
      entityId: inv.id,
      action: 'invitation_declined',
    })

    return { ok: true }
  })
}

// Moved to @blackcode/platform-db on 2026-08-06 (docs/sales-app-plan.md Phase
// 1b-C). Called from the signup paths — credentials register, and a first Google
// sign-in — and every app has those, because there is one login for all of them.
// It reads platform.workspace_invitations + platform.workspaces and writes
// platform.inbox_messages, in one transaction, and records no event.
export function materializePendingInvitationsForUser(
  userId: number,
  email: string
): Promise<number> {
  return platformMaterializePendingInvitationsForUser(db, userId, email)
}
