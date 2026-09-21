// Invitations into one of this app's workspaces — `billing.invitations`.
//
// ---------------------------------------------------------------------------
// AN INVITATION IS INTO ONE APP, AND THAT IS THE WHOLE CHANGE
// ---------------------------------------------------------------------------
// The platform's invitation table carried an `app` column, because an invitation
// used to grant access to an app INSIDE a shared workspace. Both halves of that
// are gone (`platform.workspace_apps` and `platform.app_access`, dropped
// 2026-08-10), so here an invitation names a workspace and the workspace names
// the app.
//
// What is still shared is the ACCOUNT: accepting adds a `platform.users` row to
// `billing.workspace_members`. Somebody invited here may already have an
// account from another app, and must not be asked to make a second one.
//
// ---------------------------------------------------------------------------
// EMAIL IS BEST-EFFORT, SO THE LINK IS STILL PART OF THE RESPONSE
// ---------------------------------------------------------------------------
// Since phase 2 (2026-09-21) the create route sends the invitation through
// `platform-email` (`lib/email/send.ts`), the way `apps/sales` does. The create
// path still returns `accept_url` and the listing still returns the token,
// because **a link nobody can copy is not a delivery mechanism** — a bounce or a
// deployment with no Resend key must not strand a valid invitation.
//
// ---------------------------------------------------------------------------
// ACCEPTANCE IS THIS APP'S OWN (phase 2)
// ---------------------------------------------------------------------------
// `acceptInvitation`, `declineInvitation`, `getInvitationByToken` and
// `listPendingInvitationsForEmail` below are ported from `apps/sales` (never
// imported): acceptance writes THIS app's membership table inside THIS app's
// transaction, so there is nothing generic left to share once the tenancy
// tables are the app's.

import { randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { billingInvitations, billingWorkspaceMembers, billingWorkspaces, users } from '../schema'

/** How long an unaccepted invitation stays usable. */
export const INVITATION_TTL_DAYS = 14

export interface InvitationRow {
  id: number
  email: string
  role: string
  token: string
  status: string
  expires_at: Date
  created_at: Date
  invited_by_name: string | null
  invited_by_email: string
}

/**
 * A token with enough entropy that guessing is not a strategy.
 *
 * 32 random bytes, hex — the column is varchar(64) and this fills it exactly.
 * Note it is stored in the CLEAR, unlike `platform.api_tokens`, which stores a
 * SHA-256 hash. That difference is deliberate and worth understanding before you
 * copy either: a token the owner must be able to re-read and hand to somebody
 * cannot be one-way hashed. What bounds it instead: one workspace, one use, and
 * `INVITATION_TTL_DAYS` above.
 */
function mintToken(): string {
  return randomBytes(32).toString('hex')
}

/** The accept URL for a token, on this app's own origin. */
export function acceptUrl(origin: string, token: string): string {
  return `${origin}/invitations/${token}`
}

/**
 * Create an invitation, or fail loudly if one is already pending.
 *
 * Returns null when the address is ALREADY A MEMBER — the caller turns that into
 * a 409 rather than a second membership row.
 */
export async function createInvitation(input: {
  workspaceId: number
  email: string
  invitedBy: number
  role?: 'owner' | 'member'
}): Promise<InvitationRow | null> {
  const email = input.email.trim().toLowerCase()

  // Already in? Nothing to invite. Checked against the shared identity table
  // joined to THIS app's membership, because the same person may hold an account
  // from another app and not be a member here.
  const existingMember = await getDb()
    .select({ id: billingWorkspaceMembers.id })
    .from(billingWorkspaceMembers)
    .innerJoin(users, eq(users.id, billingWorkspaceMembers.user_id))
    .where(
      and(eq(billingWorkspaceMembers.workspace_id, input.workspaceId), eq(users.email, email))
    )
    .limit(1)
  if (existingMember[0]) return null

  const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const [row] = await getDb()
    .insert(billingInvitations)
    .values({
      workspace_id: input.workspaceId,
      email,
      invited_by: input.invitedBy,
      role: input.role ?? 'member',
      token: mintToken(),
      expires_at: expires,
    })
    .returning()

  const inviter = await getDb()
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.invitedBy))
    .limit(1)

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    invited_by_name: inviter[0]?.name ?? null,
    invited_by_email: inviter[0]?.email ?? '',
  }
}

/** Pending invitations for a workspace, newest first. */
export async function listInvitations(workspaceId: number): Promise<InvitationRow[]> {
  return await getDb()
    .select({
      id: billingInvitations.id,
      email: billingInvitations.email,
      role: billingInvitations.role,
      token: billingInvitations.token,
      status: billingInvitations.status,
      expires_at: billingInvitations.expires_at,
      created_at: billingInvitations.created_at,
      invited_by_name: users.name,
      invited_by_email: users.email,
    })
    .from(billingInvitations)
    .innerJoin(users, eq(users.id, billingInvitations.invited_by))
    .where(
      and(
        eq(billingInvitations.workspace_id, workspaceId),
        eq(billingInvitations.status, 'pending')
      )
    )
    .orderBy(desc(billingInvitations.created_at))
}

/** Revoke a pending invitation. False when it was not this workspace's. */
export async function revokeInvitation(workspaceId: number, id: number): Promise<boolean> {
  const rows = await getDb()
    .update(billingInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(billingInvitations.id, id),
        eq(billingInvitations.workspace_id, workspaceId),
        eq(billingInvitations.status, 'pending')
      )
    )
    .returning({ id: billingInvitations.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// The invitee's half — accept, decline, preview, pending (phase 2)
// ---------------------------------------------------------------------------

export type AcceptFailure = 'not_found' | 'expired' | 'revoked' | 'accepted' | 'email_mismatch'

export type AcceptResult =
  | { ok: true; workspace_id: number; workspace_slug: string; already_member: boolean }
  | { ok: false; reason: AcceptFailure }

/**
 * Accept an invitation: add the membership and mark it accepted, in ONE
 * transaction.
 *
 * One transaction, because an invitation marked accepted with no membership
 * row is a person holding a spent link into a workspace they cannot open, and
 * the rollback is what rules it out. (This replaced the phase-0
 * `findUsableInvitation` + `markAccepted` pair, which had no caller.)
 *
 * `FOR UPDATE` with no `OF` clause, for the reason `apps/sales` found by
 * accepting a real invitation: Drizzle's `{ of: table }` emits the
 * schema-qualified name, which Postgres rejects. Locking the one table in the
 * FROM list needs no `OF`.
 */
export async function acceptInvitation(
  token: string,
  userId: number,
  userEmail: string
): Promise<AcceptResult> {
  return await getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(billingInvitations)
      .for('update')
      .where(eq(billingInvitations.token, token))
      .limit(1)
    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' as const }

    // Email FIRST among the refusals here, unlike the preview's order: a
    // stranger holding the token must not learn its status either. The route
    // maps this to a 403 that names no address.
    if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' as const }
    }
    if (inv.status === 'revoked') return { ok: false, reason: 'revoked' as const }
    if (inv.status === 'accepted') return { ok: false, reason: 'accepted' as const }
    if (inv.status === 'expired' || inv.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' as const }
    }

    const added = await tx
      .insert(billingWorkspaceMembers)
      .values({
        workspace_id: inv.workspace_id,
        user_id: userId,
        role: inv.role === 'owner' ? 'owner' : 'member',
      })
      .onConflictDoNothing()
      .returning({ id: billingWorkspaceMembers.id })

    await tx
      .update(billingInvitations)
      .set({ status: 'accepted', accepted_at: new Date(), accepted_by: userId })
      .where(eq(billingInvitations.id, inv.id))

    const ws = await tx
      .select({ slug: billingWorkspaces.slug })
      .from(billingWorkspaces)
      .where(eq(billingWorkspaces.id, inv.workspace_id))
      .limit(1)

    return {
      ok: true as const,
      workspace_id: inv.workspace_id,
      workspace_slug: ws[0]?.slug ?? '',
      already_member: added.length === 0,
    }
  })
}

export type DeclineResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'email_mismatch' | 'already_resolved' }

/**
 * Decline an invitation. The row ends `revoked`: `billing.invitations`' CHECK
 * (0001) has no `declined`, and "this invitation will not be honoured" is what
 * `revoked` already says. A fifth status would be a migration, not an edit here.
 */
export async function declineInvitation(token: string, userEmail: string): Promise<DeclineResult> {
  const rows = await getDb()
    .select({ id: billingInvitations.id, email: billingInvitations.email, status: billingInvitations.status })
    .from(billingInvitations)
    .where(eq(billingInvitations.token, token))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.email.toLowerCase() !== userEmail.toLowerCase()) return { ok: false, reason: 'email_mismatch' }
  if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' }

  // Conditional on still being pending, so a decline racing an accept cannot
  // revoke an invitation that has just been redeemed.
  const done = await getDb()
    .update(billingInvitations)
    .set({ status: 'revoked' })
    .where(and(eq(billingInvitations.id, row.id), eq(billingInvitations.status, 'pending')))
    .returning({ id: billingInvitations.id })
  return done.length > 0 ? { ok: true } : { ok: false, reason: 'already_resolved' }
}

export interface InvitationDetail {
  id: number
  email: string
  status: string
  expires_at: Date
  workspace_id: number
  workspace_name: string
  workspace_slug: string
  invited_by_name: string | null
  invited_by_email: string
}

/**
 * One invitation by token, for the landing page and `bk billing invite show`.
 *
 * NO membership or email check here: the CALLER compares the address, last, and
 * never names the invitation's — see `app/api/invitations/[token]/route.ts`.
 */
export async function getInvitationByToken(token: string): Promise<InvitationDetail | null> {
  const rows = await getDb()
    .select({
      id: billingInvitations.id,
      email: billingInvitations.email,
      status: billingInvitations.status,
      expires_at: billingInvitations.expires_at,
      workspace_id: billingWorkspaces.id,
      workspace_name: billingWorkspaces.name,
      workspace_slug: billingWorkspaces.slug,
      invited_by_name: users.name,
      invited_by_email: users.email,
    })
    .from(billingInvitations)
    .innerJoin(billingWorkspaces, eq(billingWorkspaces.id, billingInvitations.workspace_id))
    .innerJoin(users, eq(users.id, billingInvitations.invited_by))
    .where(eq(billingInvitations.token, token))
    .limit(1)
  return rows[0] ?? null
}

export type PendingInvitation = {
  id: number
  token: string
  email: string
  role: string
  expires_at: string
  created_at: string
  workspace_id: number
  workspace_name: string
  workspace_slug: string
  invited_by_name: string | null
  invited_by_email: string
} & Record<string, unknown>

/** Every pending, unexpired invitation addressed to one email, newest first. */
export async function listPendingInvitationsForEmail(email: string): Promise<PendingInvitation[]> {
  const result = await getDb().execute<PendingInvitation>(sql`
    SELECT i.id, i.token, i.email, i.role, i.expires_at, i.created_at,
           w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
           u.name AS invited_by_name, u.email AS invited_by_email
    FROM billing.invitations i
    JOIN billing.workspaces w ON w.id = i.workspace_id
    JOIN platform.users u ON u.id = i.invited_by
    WHERE lower(i.email) = lower(${email})
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
  `)
  return result.rows
}
