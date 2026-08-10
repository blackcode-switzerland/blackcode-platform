// Invitations into a SALES workspace — `sales.invitations`.
//
// ---------------------------------------------------------------------------
// WHY THIS IS THIS APP'S AND NOT THE PLATFORM FACTORY'S
// ---------------------------------------------------------------------------
// The shared `workspaceInvitationsRoute` was written when an invitation was to a
// SHARED workspace, and it shows: it takes an optional `app` naming which app
// the invitee is being let into, and validates that app against
// `platform.workspace_apps`. Both concepts are gone here. An invitation to a
// sales workspace is an invitation to sales — there is no second app inside it
// to select, which is why `sales.invitations` has no `app` column (0003).
//
// ---------------------------------------------------------------------------
// ACCEPT AND DECLINE HAD NO SALES ROUTE AT ALL, AND THAT WAS A DEAD END
// ---------------------------------------------------------------------------
// `POST /api/invitations/accept` lived only in `apps/issues`, and the accept
// link the invitations factory builds is `<the serving app's origin>/invitations
// /{token}` — a page `apps/sales` did not have. So sales could CREATE an
// invitation and nobody could ever accept it from sales: `bk invite accept` is a
// bare verb, and against a sales-homed CLI it 404'd. The brief's own
// verification step 2 ("that person invites a second brand-new email; they sign
// in and see the same data") was not reachable before this file existed.
//
// ---------------------------------------------------------------------------
// THE TOKEN
// ---------------------------------------------------------------------------
// 32 bytes from `crypto.randomBytes`, hex — 64 chars, which is exactly the
// column width. It is a bearer credential in a URL somebody may paste into a
// chat window, so it is long enough that guessing is not a strategy and short
// enough to survive a copy-paste.

import { randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { salesInvitations, salesWorkspaceMembers, salesWorkspaces, users } from '../schema'
import type { SalesInvitation } from '../schema'

export const INVITE_TTL_DAYS = 14

export function generateInvitationToken(): string {
  return randomBytes(32).toString('hex')
}

export interface InvitationRow extends SalesInvitation {
  invited_by_name: string | null
  invited_by_email: string
}

/**
 * Pending invitations for a workspace, newest first.
 *
 * `includeNonPending` widens it to accepted/revoked/expired — what
 * `bk invite list --all` asks for. Default is pending only, because "who is
 * still waiting" is the question the members page is asking.
 */
export async function listWorkspaceInvitations(
  workspaceId: number,
  opts: { includeNonPending?: boolean } = {}
): Promise<InvitationRow[]> {
  const where = opts.includeNonPending
    ? eq(salesInvitations.workspace_id, workspaceId)
    : and(
        eq(salesInvitations.workspace_id, workspaceId),
        eq(salesInvitations.status, 'pending')
      )

  const rows = await getDb()
    .select({
      inv: salesInvitations,
      invited_by_name: users.name,
      invited_by_email: users.email,
    })
    .from(salesInvitations)
    .innerJoin(users, eq(users.id, salesInvitations.invited_by))
    .where(where)
    .orderBy(desc(salesInvitations.created_at))

  return rows.map((r) => ({
    ...r.inv,
    invited_by_name: r.invited_by_name,
    invited_by_email: r.invited_by_email,
  }))
}

/** Every pending, unexpired invitation addressed to one email, across workspaces. */
export async function listPendingInvitationsForEmail(email: string) {
  const result = await getDb().execute(sql`
    SELECT i.id, i.token, i.role, i.expires_at, i.created_at,
           w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
           u.name AS invited_by_name, u.email AS invited_by_email
    FROM sales.invitations i
    JOIN sales.workspaces w ON w.id = i.workspace_id
    JOIN platform.users u ON u.id = i.invited_by
    WHERE lower(i.email) = lower(${email})
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
  `)
  return result.rows
}

export type CreateInvitationFailure = 'already_member' | 'already_invited'

export interface CreateInvitationResult {
  invitation: SalesInvitation
  /** Does an account already exist for this address? Changes the email's wording. */
  invitee_has_account: boolean
}

/**
 * Create a pending invitation.
 *
 * Throws a bare string message on the two refusals — the ROUTE decides what a
 * denial looks like over HTTP, the same split `platform-db`'s version makes.
 *
 * "Already invited" is a refusal rather than a silent re-issue: re-issuing would
 * invalidate a token somebody may already have in their inbox, and the owner's
 * actual intent ("they lost it") is served by revoking and inviting again, which
 * is two visible actions instead of one invisible one.
 */
export async function createInvitation(input: {
  workspaceId: number
  email: string
  invitedBy: number
  role?: 'owner' | 'member'
  ttlDays?: number
}): Promise<CreateInvitationResult> {
  const db = getDb()
  const email = input.email.trim().toLowerCase()

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1)

  if (existingUser[0]) {
    const member = await db
      .select({ id: salesWorkspaceMembers.id })
      .from(salesWorkspaceMembers)
      .where(
        and(
          eq(salesWorkspaceMembers.workspace_id, input.workspaceId),
          eq(salesWorkspaceMembers.user_id, existingUser[0].id)
        )
      )
      .limit(1)
    if (member[0]) throw new Error('already_member')
  }

  const pending = await db
    .select({ id: salesInvitations.id })
    .from(salesInvitations)
    .where(
      and(
        eq(salesInvitations.workspace_id, input.workspaceId),
        eq(sql`lower(${salesInvitations.email})`, email),
        eq(salesInvitations.status, 'pending')
      )
    )
    .limit(1)
  if (pending[0]) throw new Error('already_invited')

  const ttl = input.ttlDays ?? INVITE_TTL_DAYS
  const [invitation] = await db
    .insert(salesInvitations)
    .values({
      workspace_id: input.workspaceId,
      email,
      invited_by: input.invitedBy,
      role: input.role ?? 'member',
      token: generateInvitationToken(),
      status: 'pending',
      expires_at: new Date(Date.now() + ttl * 24 * 60 * 60 * 1000),
    })
    .returning()

  return { invitation, invitee_has_account: Boolean(existingUser[0]) }
}

/** Revoke a pending invitation. False if it was not pending, or not in this workspace. */
export async function revokeInvitation(id: number, workspaceId: number): Promise<boolean> {
  const rows = await getDb()
    .update(salesInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(salesInvitations.id, id),
        eq(salesInvitations.workspace_id, workspaceId),
        eq(salesInvitations.status, 'pending')
      )
    )
    .returning({ id: salesInvitations.id })
  return rows.length > 0
}

export type AcceptFailure =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'accepted'
  | 'email_mismatch'

export type AcceptResult =
  | { ok: true; workspace_id: number; workspace_slug: string; already_member: boolean }
  | { ok: false; reason: AcceptFailure }

/**
 * Accept an invitation: mark it accepted and add the membership, in ONE
 * transaction.
 *
 * The transaction is the whole point, for the same reason the sign-in bootstrap
 * has one: an invitation marked accepted with no membership row is a person
 * looking at an empty app with no way to try again — the token is spent and the
 * owner has to notice and re-invite.
 *
 * `email_mismatch` is deliberately not distinguished from `not_found` in the
 * MESSAGE the route returns; whose address a token was for is not something a
 * stranger holding the token gets to learn.
 */
export async function acceptInvitation(
  token: string,
  userId: number,
  userEmail: string
): Promise<AcceptResult> {
  return await getDb().transaction(async (tx) => {
    // FOR UPDATE on the invitation row: two clicks on the same link are a
    // genuine race, and without the lock both pass the status check and the
    // second one's membership insert is the only thing that stops it.
    //
    // The workspace slug is fetched SEPARATELY rather than joined. Drizzle's
    // `.for('update', { of: table })` emits the schema-qualified name —
    // `FOR UPDATE OF "sales"."invitations"` — which Postgres rejects, because
    // that clause takes the FROM-list alias and the alias is bare
    // `invitations`. It fails at runtime with the whole statement in the
    // message and nothing at compile time; found by accepting a real
    // invitation, not by the suite. Locking one table means no `OF` clause at
    // all, which is both correct and the thing we actually wanted.
    const rows = await tx
      .select()
      .from(salesInvitations)
      .for('update')
      .where(eq(salesInvitations.token, token))
      .limit(1)

    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' as const }

    if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' as const }
    }
    if (inv.status === 'revoked') return { ok: false, reason: 'revoked' as const }
    if (inv.status === 'accepted') return { ok: false, reason: 'accepted' as const }
    if (inv.status === 'expired' || inv.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' as const }
    }

    const added = await tx
      .insert(salesWorkspaceMembers)
      .values({
        workspace_id: inv.workspace_id,
        user_id: userId,
        role: inv.role === 'owner' ? 'owner' : 'member',
      })
      .onConflictDoNothing()
      .returning({ id: salesWorkspaceMembers.id })

    await tx
      .update(salesInvitations)
      .set({ status: 'accepted', accepted_at: new Date(), accepted_by: userId })
      .where(eq(salesInvitations.id, inv.id))

    // Read AFTER the membership insert, inside the same transaction: the slug
    // is only useful to a caller who is now a member, and this ordering means
    // the read is covered by the same rollback.
    const ws = await tx
      .select({ slug: salesWorkspaces.slug })
      .from(salesWorkspaces)
      .where(eq(salesWorkspaces.id, inv.workspace_id))
      .limit(1)

    return {
      ok: true as const,
      workspace_id: inv.workspace_id,
      workspace_slug: ws[0]?.slug ?? '',
      already_member: added.length === 0,
    }
  })
}

export type DeclineResult = { ok: true } | { ok: false; reason: 'not_found' | 'email_mismatch' | 'already_resolved' }

/**
 * Decline an invitation.
 *
 * `sales.invitations`' CHECK constraint has no `'declined'` value — 0003 dropped
 * it because nothing had ever written it, on the principle that an accepted
 * value is a promise some code path produces it. This is that code path, and it
 * writes `'revoked'` rather than reintroducing a fifth status: the row's end
 * state is "this invitation will not be honoured", and the actor is recorded by
 * the event, not by the status. Reversing that is a migration, not an edit here.
 */
export async function declineInvitation(
  token: string,
  userEmail: string
): Promise<DeclineResult> {
  const db = getDb()
  const rows = await db
    .select({ id: salesInvitations.id, email: salesInvitations.email, status: salesInvitations.status })
    .from(salesInvitations)
    .where(eq(salesInvitations.token, token))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.email.toLowerCase() !== userEmail.toLowerCase()) {
    return { ok: false, reason: 'email_mismatch' }
  }
  if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' }

  await db
    .update(salesInvitations)
    .set({ status: 'revoked' })
    .where(eq(salesInvitations.id, row.id))
  return { ok: true }
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
 * One invitation by token, for the landing page.
 *
 * NO membership or email check: the page is reachable by anybody holding the
 * link, and its whole job is to say why a link will not work. The page compares
 * the address itself and the ACCEPT route re-checks it — this read is what makes
 * "this invitation is not for you" showable instead of a bare 403.
 */
export async function getInvitationByToken(token: string): Promise<InvitationDetail | null> {
  const rows = await getDb()
    .select({
      id: salesInvitations.id,
      email: salesInvitations.email,
      status: salesInvitations.status,
      expires_at: salesInvitations.expires_at,
      workspace_id: salesWorkspaces.id,
      workspace_name: salesWorkspaces.name,
      workspace_slug: salesWorkspaces.slug,
      invited_by_name: users.name,
      invited_by_email: users.email,
    })
    .from(salesInvitations)
    .innerJoin(salesWorkspaces, eq(salesWorkspaces.id, salesInvitations.workspace_id))
    .innerJoin(users, eq(users.id, salesInvitations.invited_by))
    .where(eq(salesInvitations.token, token))
    .limit(1)
  return rows[0] ?? null
}
