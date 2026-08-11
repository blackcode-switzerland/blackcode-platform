// This app's workspaces and memberships — `sales.workspaces`,
// `sales.workspace_members`.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL (multiAppFinalRefactor Phase 2, 2026-08-10)
// ---------------------------------------------------------------------------
// Until now this app had no workspaces of its own: it read `platform.workspaces`
// through the shared route factories, which is why a grep for `workspaceMembers`
// in `apps/sales` returned zero files while the app depended on the table
// completely. That dependency is what made sales feel like an add-on to issues
// rather than an app — a person could hold a sales account only by being invited
// into an ISSUES workspace first.
//
// From here, a sales workspace is a sales row. `platform.users` stays shared and
// is the only thing that does: one account, one password, one token, every app.
//
// ---------------------------------------------------------------------------
// ONE WORKSPACE PER PERSON, AND THE UI NEVER SAYS THE WORD
// ---------------------------------------------------------------------------
// PLAN.md §1: no switcher, no picker, no create-workspace page, no workspace
// settings. The TABLES are fully multi-workspace — every row carries a
// `workspace_id` — so making sales multi-workspace later is a UI change rather
// than a migration. What is hidden is the offer, not the capability.
//
// `ensureWorkspaceForUser` below is the whole of the bootstrap, and it is
// deliberately the ONLY writer of `sales.workspaces`.

import { and, asc, eq, sql } from 'drizzle-orm'
import type {
  WorkspaceMemberRef,
  WorkspaceMembershipRef,
  WorkspaceRef,
} from '@blackcode/platform-api'
import { getDb } from '../client'
import { salesWorkspaceMembers, salesWorkspaces, users } from '../schema'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'

/** The five columns shared code reads. Selected explicitly, never `SELECT *`. */
const WS_COLUMNS = {
  id: salesWorkspaces.id,
  name: salesWorkspaces.name,
  slug: salesWorkspaces.slug,
  owner_id: salesWorkspaces.owner_id,
  updated_at: salesWorkspaces.updated_at,
} as const

/**
 * One workspace by slug or numeric id, asserting the caller is a member.
 *
 * Null for "does not exist" AND for "you are not a member" — the two are one
 * answer on purpose, so the API cannot be used to confirm which workspaces
 * exist. The route layer turns it into a 404.
 */
export async function getWorkspaceForUser(
  slugOrId: string,
  userId: number
): Promise<WorkspaceMembershipRef | null> {
  const isNumeric = /^\d+$/.test(slugOrId)
  const rows = await getDb()
    .select({ ...WS_COLUMNS, role: salesWorkspaceMembers.role })
    .from(salesWorkspaces)
    .innerJoin(
      salesWorkspaceMembers,
      and(
        eq(salesWorkspaceMembers.workspace_id, salesWorkspaces.id),
        eq(salesWorkspaceMembers.user_id, userId)
      )
    )
    .where(
      isNumeric
        ? eq(salesWorkspaces.id, parseInt(slugOrId, 10))
        : eq(salesWorkspaces.slug, slugOrId)
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null
  const { role, ...ws } = row
  return { ...ws, member_role: role as 'owner' | 'member' }
}

/**
 * Every sales workspace this user belongs to.
 *
 * There is no app-scoped variant, and that is the refactor in one function:
 * `platform.workspace_apps` / `platform.app_access` exist to gate an app INSIDE
 * a shared workspace, and a `sales.workspaces` row cannot be shared with
 * anything. Membership is the whole answer here, so `scopedToApp` true and false
 * return the same list — see `salesWorkspaceSource`.
 */
export async function listWorkspacesForUser(userId: number): Promise<WorkspaceMembershipRef[]> {
  const rows = await getDb()
    .select({ ...WS_COLUMNS, role: salesWorkspaceMembers.role })
    .from(salesWorkspaceMembers)
    .innerJoin(salesWorkspaces, eq(salesWorkspaces.id, salesWorkspaceMembers.workspace_id))
    .where(eq(salesWorkspaceMembers.user_id, userId))
    .orderBy(asc(salesWorkspaces.updated_at))

  return rows.map(({ role, ...ws }) => ({ ...ws, member_role: role as 'owner' | 'member' }))
}

/**
 * Everyone in one workspace, joined to `platform.users`.
 *
 * `deleted_at` is SELECTED, not filtered: a soft-deleted user who is still a
 * member is a row the members page must be able to render as such. Filtering
 * here would make the member count disagree with the member list.
 */
export async function listWorkspaceMembers(workspaceId: number): Promise<WorkspaceMemberRef[]> {
  return await getDb()
    .select({
      id: salesWorkspaceMembers.id,
      workspace_id: salesWorkspaceMembers.workspace_id,
      user_id: salesWorkspaceMembers.user_id,
      role: salesWorkspaceMembers.role,
      joined_at: salesWorkspaceMembers.joined_at,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      deleted_at: users.deleted_at,
    })
    .from(salesWorkspaceMembers)
    .innerJoin(users, eq(users.id, salesWorkspaceMembers.user_id))
    .where(eq(salesWorkspaceMembers.workspace_id, workspaceId))
    .orderBy(asc(salesWorkspaceMembers.joined_at))
}

/** One membership row, or null. */
export async function getMembership(
  workspaceId: number,
  userId: number
): Promise<{ role: 'owner' | 'member' } | null> {
  const rows = await getDb()
    .select({ role: salesWorkspaceMembers.role })
    .from(salesWorkspaceMembers)
    .where(
      and(
        eq(salesWorkspaceMembers.workspace_id, workspaceId),
        eq(salesWorkspaceMembers.user_id, userId)
      )
    )
    .limit(1)
  const row = rows[0]
  return row ? { role: row.role as 'owner' | 'member' } : null
}

/**
 * Remove somebody from a workspace. Returns false if they were not in it.
 *
 * Refusing to remove the OWNER is the ROUTE's job, not this function's — the
 * route has the workspace record and can say "transfer ownership first" with the
 * slug in the message.
 *
 * ── THE EVENT, ADDED IN PHASE 3 ────────────────────────────────────────────
 * Phase 2 left this write with NO event row, and said so in the route: at that
 * point `recordEvent` still wrote `platform.events`, whose `workspace_id` has a
 * foreign key on `platform.workspaces`, so an event carrying a sales workspace
 * id would either fail loudly or land against a different app's workspace with
 * the same number. The spine is `sales.events` now, and this is the call site
 * that was waiting for it — the only place in this app where a membership
 * changes after the workspace exists.
 *
 * In the same transaction as the delete, for the reason `recordEvent`'s header
 * gives: there are no event triggers, so a mutation that commits without its
 * event has lost it permanently.
 */
export async function removeMember(
  workspaceId: number,
  userId: number,
  actor: Actor
): Promise<boolean> {
  return await getDb().transaction(async (tx) => {
    const rows = await tx
      .delete(salesWorkspaceMembers)
      .where(
        and(
          eq(salesWorkspaceMembers.workspace_id, workspaceId),
          eq(salesWorkspaceMembers.user_id, userId)
        )
      )
      .returning({ id: salesWorkspaceMembers.id })
    if (rows.length === 0) return false

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'workspace_member',
      entityId: userId,
      action: 'member_removed',
      meta: { user_id: userId },
      // A membership has no cross-app address, and never had one.
      subjectUrn: null,
    })
    return true
  })
}

// ---------------------------------------------------------------------------
// The bootstrap
// ---------------------------------------------------------------------------

/**
 * A slug from a person's name or email. Lowercase, hyphenated, ASCII.
 *
 * Not imported from `apps/issues` — apps never import each other, and
 * `lib/app-isolation.test.ts` is what makes that true rather than polite.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return base || 'workspace'
}

export interface EnsureWorkspaceResult {
  workspace: WorkspaceMembershipRef
  /** True when this call is what created it. */
  created: boolean
}

/**
 * The workspace a person lands in, created on their first sign-in if they have
 * none.
 *
 * ---------------------------------------------------------------------------
 * ONE TRANSACTION, AND IT IS THE POINT OF THE FUNCTION
 * ---------------------------------------------------------------------------
 * A workspace with no membership row locks its own owner out of their data —
 * every read in this app goes through `getWorkspaceForUser`, which joins on
 * membership. It is also the shape a partial failure leaves behind, so the two
 * writes are one statement pair inside one transaction or they are a bug waiting
 * for a bad night.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SAFE TO CALL ON EVERY SIGN-IN
 * ---------------------------------------------------------------------------
 * It returns the existing workspace when there is one, so it is idempotent
 * rather than "call it only for new accounts". That matters because the two
 * callers cannot both know: the Google provider knows `was_new`, the credentials
 * provider does not, and a person invited into a workspace must NOT be given a
 * second one of their own. Membership — not account age — is the test, which is
 * also what makes the invitation flow work: accept first, sign in second, and
 * this function correctly does nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REVERSES D-3
 * ---------------------------------------------------------------------------
 * `lib/auth.ts` deliberately did NOT create a workspace, because with no
 * switcher and no create flow, one minted at sign-in was a workspace the human
 * could neither see nor leave — and it arrived with `sales` not enabled on it.
 * Both halves of that premise are gone: this app owns its workspaces (there is
 * nothing left to enable) and it now has a members page. The reasoning was right
 * and its subject no longer exists.
 */
export async function ensureWorkspaceForUser(
  userId: number,
  name: string | null,
  email: string
): Promise<EnsureWorkspaceResult> {
  const existing = await listWorkspacesForUser(userId)
  if (existing[0]) return { workspace: existing[0], created: false }

  const label = name?.trim() || email.split('@')[0]
  const base = slugify(label)

  return await getDb().transaction(async (tx) => {
    // Re-check INSIDE the transaction. Two sign-ins racing (a browser tab and a
    // `bk login` in the same second) would otherwise both see no membership and
    // both mint a workspace, and the loser is a row nobody ever opens.
    // `salesWorkspaceMembers.workspace_id`, NOT `salesWorkspaces.id` — this
    // query does not join the workspaces table, and Drizzle throws at runtime
    // rather than at compile time when a projection names an unjoined table
    // ("your `id` field references a column `workspaces`.`id`, but the table
    // `workspaces` is not part of the query"). The first version of this file
    // had it wrong, tsc was happy, and every sign-up silently landed without a
    // workspace because this whole function is called best-effort. Found by
    // running the flow, not by the suite.
    const already = await tx
      .select({ id: salesWorkspaceMembers.workspace_id })
      .from(salesWorkspaceMembers)
      .where(eq(salesWorkspaceMembers.user_id, userId))
      .limit(1)
    if (already[0]) {
      const ws = await getWorkspaceForUser(String(already[0].id), userId)
      if (ws) return { workspace: ws, created: false }
    }

    // Slug collision: `slug` is UNIQUE, and two people called Anna would
    // collide. Suffix from the sequence rather than a random string so the slug
    // stays typeable — a person has to be able to say it out loud to a colleague.
    let slug = base
    for (let attempt = 0; attempt < 25; attempt++) {
      const clash = await tx
        .select({ id: salesWorkspaces.id })
        .from(salesWorkspaces)
        .where(eq(salesWorkspaces.slug, slug))
        .limit(1)
      if (!clash[0]) break
      slug = `${base}-${attempt + 2}`
    }

    const [ws] = await tx
      .insert(salesWorkspaces)
      .values({ name: `${label}'s workspace`, slug, owner_id: userId })
      .returning(WS_COLUMNS)

    await tx.insert(salesWorkspaceMembers).values({
      workspace_id: ws.id,
      user_id: userId,
      role: 'owner',
    })

    return { workspace: { ...ws, member_role: 'owner' as const }, created: true }
  })
}

/**
 * Add somebody to a workspace, or leave them where they are.
 *
 * Used by invitation acceptance. `ON CONFLICT DO NOTHING` against
 * `uq_sales_workspace_members_ws_user` rather than a SELECT-then-INSERT: two
 * clicks on the same accept link are a race, and the unique index is the only
 * thing that can settle it.
 */
export async function addMember(
  workspaceId: number,
  userId: number,
  role: 'owner' | 'member' = 'member'
): Promise<{ added: boolean }> {
  const rows = await getDb()
    .insert(salesWorkspaceMembers)
    .values({ workspace_id: workspaceId, user_id: userId, role })
    .onConflictDoNothing()
    .returning({ id: salesWorkspaceMembers.id })
  return { added: rows.length > 0 }
}

/**
 * Who this owner could invite without retyping an email: everyone they already
 * share a SALES workspace with, minus themselves.
 *
 * The privacy guard is the join, not a filter applied afterwards — a person you
 * share no sales workspace with is not discoverable here at all. That is the
 * same rule `platform-db`'s version enforces, restricted to this app's tenancy,
 * which is the change: an issues colleague is no longer a sales suggestion.
 */
export interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
}

export async function listInviteCandidates(input: {
  userId: number
  currentWorkspaceId: number
}): Promise<InviteCandidate[]> {
  const db = getDb()

  const [currentRows, pendingRows, sharedRows] = await Promise.all([
    db
      .select({ user_id: salesWorkspaceMembers.user_id })
      .from(salesWorkspaceMembers)
      .where(eq(salesWorkspaceMembers.workspace_id, input.currentWorkspaceId)),
    db.execute(sql`
      SELECT email FROM sales.invitations
      WHERE workspace_id = ${input.currentWorkspaceId} AND status = 'pending'
    `),
    db.execute(sql`
      SELECT u.id AS user_id, u.email, u.name, u.avatar_url, w.name AS workspace_name
      FROM sales.workspace_members mine
      JOIN sales.workspace_members theirs ON theirs.workspace_id = mine.workspace_id
      JOIN sales.workspaces w ON w.id = mine.workspace_id
      JOIN platform.users u ON u.id = theirs.user_id
      WHERE mine.user_id = ${input.userId}
        AND theirs.user_id <> ${input.userId}
        AND u.deleted_at IS NULL
    `),
  ])

  const memberIds = new Set(currentRows.map((r) => r.user_id))
  const pendingEmails = new Set(
    (pendingRows.rows as { email: string }[]).map((r) => r.email.toLowerCase())
  )

  const byUser = new Map<number, InviteCandidate>()
  for (const r of sharedRows.rows as {
    user_id: number
    email: string
    name: string | null
    avatar_url: string | null
    workspace_name: string
  }[]) {
    const entry = byUser.get(r.user_id) ?? {
      user_id: r.user_id,
      email: r.email,
      name: r.name,
      avatar_url: r.avatar_url,
      already_member: memberIds.has(r.user_id),
      invited: pendingEmails.has(r.email.toLowerCase()),
      shared_workspaces: [],
    }
    if (!entry.shared_workspaces.includes(r.workspace_name)) {
      entry.shared_workspaces.push(r.workspace_name)
    }
    byUser.set(r.user_id, entry)
  }

  return [...byUser.values()].sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email)
  )
}
