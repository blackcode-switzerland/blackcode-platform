// Invitations into one of this app's workspaces — `scaffold.invitations`.
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
// `scaffold.workspace_members`. Somebody invited here may already have an
// account from another app, and must not be asked to make a second one.
//
// ---------------------------------------------------------------------------
// NO EMAIL, AND THE LINK IS THEREFORE PART OF THE RESPONSE
// ---------------------------------------------------------------------------
// There is no `platform-email` package yet (`docs/adding-an-app.md` open item
// 7), so this app does not send anything. The create path returns `accept_url`
// and the listing returns the token, because **a link nobody can copy is not a
// delivery mechanism** — `apps/sales` shipped a members page that said "copy the
// link and send it yourself" while showing the link only until the next reload.

import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { scaffoldInvitations, scaffoldWorkspaceMembers, users } from '../schema'

/** How long an unaccepted invitation stays usable. */
const INVITATION_TTL_DAYS = 14

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
    .select({ id: scaffoldWorkspaceMembers.id })
    .from(scaffoldWorkspaceMembers)
    .innerJoin(users, eq(users.id, scaffoldWorkspaceMembers.user_id))
    .where(
      and(eq(scaffoldWorkspaceMembers.workspace_id, input.workspaceId), eq(users.email, email))
    )
    .limit(1)
  if (existingMember[0]) return null

  const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const [row] = await getDb()
    .insert(scaffoldInvitations)
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
      id: scaffoldInvitations.id,
      email: scaffoldInvitations.email,
      role: scaffoldInvitations.role,
      token: scaffoldInvitations.token,
      status: scaffoldInvitations.status,
      expires_at: scaffoldInvitations.expires_at,
      created_at: scaffoldInvitations.created_at,
      invited_by_name: users.name,
      invited_by_email: users.email,
    })
    .from(scaffoldInvitations)
    .innerJoin(users, eq(users.id, scaffoldInvitations.invited_by))
    .where(
      and(
        eq(scaffoldInvitations.workspace_id, workspaceId),
        eq(scaffoldInvitations.status, 'pending')
      )
    )
    .orderBy(desc(scaffoldInvitations.created_at))
}

/** Revoke a pending invitation. False when it was not this workspace's. */
export async function revokeInvitation(workspaceId: number, id: number): Promise<boolean> {
  const rows = await getDb()
    .update(scaffoldInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(scaffoldInvitations.id, id),
        eq(scaffoldInvitations.workspace_id, workspaceId),
        eq(scaffoldInvitations.status, 'pending')
      )
    )
    .returning({ id: scaffoldInvitations.id })
  return rows.length > 0
}

/** One pending, unexpired invitation by token. */
export async function findUsableInvitation(token: string) {
  const rows = await getDb()
    .select()
    .from(scaffoldInvitations)
    .where(eq(scaffoldInvitations.token, token))
    .limit(1)
  const inv = rows[0]
  if (!inv) return null
  if (inv.status !== 'pending') return { invitation: inv, usable: false as const, why: inv.status }
  if (inv.expires_at.getTime() < Date.now()) {
    return { invitation: inv, usable: false as const, why: 'expired' }
  }
  return { invitation: inv, usable: true as const, why: null }
}

/**
 * Mark an invitation accepted.
 *
 * The membership row is written by `addMember` in `./workspaces`, and the two
 * are ordered membership-first by the route: an invitation marked accepted with
 * no membership is somebody locked out holding a used link, while a membership
 * with a still-pending invitation is merely untidy and self-heals.
 */
export async function markAccepted(id: number, userId: number): Promise<void> {
  await getDb()
    .update(scaffoldInvitations)
    .set({ status: 'accepted', accepted_at: new Date(), accepted_by: userId })
    .where(eq(scaffoldInvitations.id, id))
}
