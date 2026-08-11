// This app's workspaces and memberships — `scaffold.workspaces`,
// `scaffold.workspace_members`.
//
// ---------------------------------------------------------------------------
// COPY THIS FILE. IT IS THE SHAPE `AppContext.workspaces` EXPECTS.
// ---------------------------------------------------------------------------
// `packages/platform-api` owns the request layer — `apiHandler`, the error log,
// the version headers, the 401/404/403 reasoning — and asks each app exactly one
// question: where do YOUR workspaces live? The answer is a `WorkspaceSource`,
// built in `lib/api.ts` out of the functions below.
//
// The field is REQUIRED and not optional, which is the property that matters
// when you copy this app: an optional one defaulting to `platform.workspaces`
// would mean the safe value is the one you have to remember, and forgetting it
// fails SILENTLY — a new app serving, correctly, against another app's tenancy.
// Required means your copy stops compiling until you have answered.
//
// ---------------------------------------------------------------------------
// MEMBERSHIP IS THE WHOLE GATE
// ---------------------------------------------------------------------------
// There is no second check to write. `platform.workspace_apps` and
// `platform.app_access` were dropped on 2026-08-10 along with
// `requireAppAccess`: an app owns its workspaces, so a workspace belongs to
// exactly one app, and "is this person a member?" answers "may they use this
// app?" completely.

import { and, asc, eq } from 'drizzle-orm'
import type {
  WorkspaceMemberRef,
  WorkspaceMembershipRef,
  WorkspaceRef,
} from '@blackcode/platform-api'
import { getDb } from '../client'
import { scaffoldWorkspaceMembers, scaffoldWorkspaces, users } from '../schema'

/**
 * The five columns shared code reads. Projected explicitly, never `SELECT *`.
 *
 * `WorkspaceContext.workspace` is deliberately narrowed to the columns EVERY
 * app's workspace table has. A route needing one of its own — issues reads
 * `storage_limit_bytes` — reads the row itself rather than widening the shared
 * interface with a field only one app has ever had.
 */
const WS_COLUMNS = {
  id: scaffoldWorkspaces.id,
  name: scaffoldWorkspaces.name,
  slug: scaffoldWorkspaces.slug,
  owner_id: scaffoldWorkspaces.owner_id,
  updated_at: scaffoldWorkspaces.updated_at,
} as const

/**
 * One workspace by slug or numeric id, asserting the caller is a member.
 *
 * Null for "does not exist" AND for "you are not a member", deliberately: the
 * two are one answer so the API cannot be used to confirm which workspaces
 * exist. The route layer turns it into a 404 — never a 403, which would leak
 * existence to somebody who has no business knowing.
 */
export async function getWorkspaceForUser(
  slugOrId: string,
  userId: number
): Promise<WorkspaceMembershipRef | null> {
  const numeric = /^\d+$/.test(slugOrId) ? Number(slugOrId) : null

  const rows = await getDb()
    .select({ ...WS_COLUMNS, member_role: scaffoldWorkspaceMembers.role })
    .from(scaffoldWorkspaces)
    .innerJoin(
      scaffoldWorkspaceMembers,
      eq(scaffoldWorkspaceMembers.workspace_id, scaffoldWorkspaces.id)
    )
    .where(
      and(
        eq(scaffoldWorkspaceMembers.user_id, userId),
        numeric === null
          ? eq(scaffoldWorkspaces.slug, slugOrId)
          : eq(scaffoldWorkspaces.id, numeric)
      )
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null
  // `role` is `varchar` in Postgres and therefore `string` to Drizzle; the CHECK
  // constraint is what makes the narrowing true. Asserted rather than validated
  // because a row that violated the constraint could not have been inserted.
  const { member_role, ...ws } = row
  return { ...ws, member_role: member_role as 'owner' | 'member' }
}

/** Every workspace this person belongs to, oldest first. */
export async function listWorkspacesForUser(userId: number): Promise<WorkspaceMembershipRef[]> {
  const rows = await getDb()
    .select({ ...WS_COLUMNS, member_role: scaffoldWorkspaceMembers.role })
    .from(scaffoldWorkspaces)
    .innerJoin(
      scaffoldWorkspaceMembers,
      eq(scaffoldWorkspaceMembers.workspace_id, scaffoldWorkspaces.id)
    )
    .where(eq(scaffoldWorkspaceMembers.user_id, userId))
    .orderBy(asc(scaffoldWorkspaces.id))
  return rows.map(({ member_role, ...ws }) => ({
    ...ws,
    member_role: member_role as 'owner' | 'member',
  }))
}

/** The people in a workspace, with their platform identity. */
export async function listWorkspaceMembers(workspaceId: number): Promise<WorkspaceMemberRef[]> {
  return await getDb()
    .select({
      id: scaffoldWorkspaceMembers.id,
      workspace_id: scaffoldWorkspaceMembers.workspace_id,
      user_id: scaffoldWorkspaceMembers.user_id,
      role: scaffoldWorkspaceMembers.role,
      joined_at: scaffoldWorkspaceMembers.joined_at,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      deleted_at: users.deleted_at,
    })
    .from(scaffoldWorkspaceMembers)
    .innerJoin(users, eq(users.id, scaffoldWorkspaceMembers.user_id))
    .where(eq(scaffoldWorkspaceMembers.workspace_id, workspaceId))
    .orderBy(asc(scaffoldWorkspaceMembers.joined_at))
}

/** A workspace-safe slug from a person's name or email local part. */
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
 * none. **The whole of this app's bootstrap, and its only writer of
 * `scaffold.workspaces`.**
 *
 * ---------------------------------------------------------------------------
 * ONE TRANSACTION, AND IT IS THE POINT OF THE FUNCTION
 * ---------------------------------------------------------------------------
 * A workspace with no membership row locks its own owner out of their data:
 * every read here goes through `getWorkspaceForUser`, which joins on membership.
 * It is also exactly the shape a partial failure leaves behind. So the two
 * writes are one transaction or they are a bug waiting for a bad night.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SAFE TO CALL ON EVERY SIGN-IN
 * ---------------------------------------------------------------------------
 * It returns the existing workspace when there is one, so it is idempotent
 * rather than "call it only for new accounts". That is not a convenience: the
 * callers cannot both know. The Google provider learns `was_new` from
 * `upsertUserFromOAuth`; the credentials provider has no equivalent and cannot
 * tell a first sign-in from a thousandth.
 *
 * Keying on MEMBERSHIP rather than on account age is also what makes the
 * invitation flow correct — somebody who accepted an invitation already belongs
 * somewhere and must not be handed a second workspace of their own.
 *
 * ---------------------------------------------------------------------------
 * IT MUST NOT THROW INTO A SIGN-IN
 * ---------------------------------------------------------------------------
 * `lib/auth.ts` wraps it in a try/catch, because a sign-in that fails because a
 * workspace could not be minted is a person locked out of an account that
 * exists. Idempotence is what makes that safe: the next sign-in retries.
 *
 * The cost of best-effort is that a bug in here is INVISIBLE from the response —
 * `apps/sales` shipped a version whose transaction-internal re-check named an
 * unjoined table, and every sign-up returned 201 while landing without a
 * workspace. It was found by looking at the database after running the flow, not
 * by a unit test, and not by the status code. Look at the rows.
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
    // Re-check INSIDE the transaction. Two sign-ins racing — a browser tab and a
    // `bk login` in the same second — would otherwise both see no membership and
    // both mint a workspace, and the loser is a row nobody ever opens.
    //
    // Note the projection: `scaffoldWorkspaceMembers.workspace_id`, NOT
    // `scaffoldWorkspaces.id`. This query does not join the workspaces table,
    // and Drizzle throws at RUNTIME rather than at compile time when a
    // projection names an unjoined table. tsc will not save you here.
    const already = await tx
      .select({ id: scaffoldWorkspaceMembers.workspace_id })
      .from(scaffoldWorkspaceMembers)
      .where(eq(scaffoldWorkspaceMembers.user_id, userId))
      .limit(1)
    if (already[0]) {
      const ws = await getWorkspaceForUser(String(already[0].id), userId)
      if (ws) return { workspace: ws, created: false }
    }

    // Slug collision: `slug` is UNIQUE and two people called Anna would collide.
    // The suffix comes from the attempt counter rather than a random string so
    // the slug stays typeable — somebody has to be able to say it out loud.
    let slug = base
    for (let attempt = 0; attempt < 25; attempt++) {
      const clash = await tx
        .select({ id: scaffoldWorkspaces.id })
        .from(scaffoldWorkspaces)
        .where(eq(scaffoldWorkspaces.slug, slug))
        .limit(1)
      if (!clash[0]) break
      slug = `${base}-${attempt + 2}`
    }

    const [ws] = await tx
      .insert(scaffoldWorkspaces)
      .values({ name: `${label}'s workspace`, slug, owner_id: userId })
      .returning(WS_COLUMNS)

    await tx
      .insert(scaffoldWorkspaceMembers)
      .values({ workspace_id: ws.id, user_id: userId, role: 'owner' })

    return { workspace: { ...ws, member_role: 'owner' as const }, created: true }
  })
}

/**
 * Add somebody to a workspace, or leave them where they are.
 *
 * `ON CONFLICT DO NOTHING` against `uq_scaffold_workspace_members_ws_user`
 * rather than SELECT-then-INSERT: two clicks on the same accept link are a race,
 * and the unique index is the only thing that can settle it.
 */
export async function addMember(
  workspaceId: number,
  userId: number,
  role: 'owner' | 'member' = 'member'
): Promise<void> {
  await getDb()
    .insert(scaffoldWorkspaceMembers)
    .values({ workspace_id: workspaceId, user_id: userId, role })
    .onConflictDoNothing()
}

/** One membership row, or null. Used by the owner-only route gates. */
export async function getMembership(
  workspaceId: number,
  userId: number
): Promise<{ role: string } | null> {
  const rows = await getDb()
    .select({ role: scaffoldWorkspaceMembers.role })
    .from(scaffoldWorkspaceMembers)
    .where(
      and(
        eq(scaffoldWorkspaceMembers.workspace_id, workspaceId),
        eq(scaffoldWorkspaceMembers.user_id, userId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}
