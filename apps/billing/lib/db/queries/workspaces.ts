// This app's workspaces and memberships — `billing.workspaces`,
// `billing.workspace_members`.
//
// It also holds this app's answer to the empty-workspace dead end that
// `docs/2026-08-multi-app-refactor.md` §9.1 leaves open — see
// `createWorkspaceForUser` below, which is where the decision is written down.
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
import { billingWorkspaceMembers, billingWorkspaces, users } from '../schema'

/**
 * The five columns shared code reads. Projected explicitly, never `SELECT *`.
 *
 * `WorkspaceContext.workspace` is deliberately narrowed to the columns EVERY
 * app's workspace table has. A route needing one of its own — issues reads
 * `storage_limit_bytes` — reads the row itself rather than widening the shared
 * interface with a field only one app has ever had.
 */
const WS_COLUMNS = {
  id: billingWorkspaces.id,
  name: billingWorkspaces.name,
  slug: billingWorkspaces.slug,
  owner_id: billingWorkspaces.owner_id,
  updated_at: billingWorkspaces.updated_at,
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
    .select({ ...WS_COLUMNS, member_role: billingWorkspaceMembers.role })
    .from(billingWorkspaces)
    .innerJoin(
      billingWorkspaceMembers,
      eq(billingWorkspaceMembers.workspace_id, billingWorkspaces.id)
    )
    .where(
      and(
        eq(billingWorkspaceMembers.user_id, userId),
        numeric === null
          ? eq(billingWorkspaces.slug, slugOrId)
          : eq(billingWorkspaces.id, numeric)
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
    .select({ ...WS_COLUMNS, member_role: billingWorkspaceMembers.role })
    .from(billingWorkspaces)
    .innerJoin(
      billingWorkspaceMembers,
      eq(billingWorkspaceMembers.workspace_id, billingWorkspaces.id)
    )
    .where(eq(billingWorkspaceMembers.user_id, userId))
    .orderBy(asc(billingWorkspaces.id))
  return rows.map(({ member_role, ...ws }) => ({
    ...ws,
    member_role: member_role as 'owner' | 'member',
  }))
}

/** The people in a workspace, with their platform identity. */
export async function listWorkspaceMembers(workspaceId: number): Promise<WorkspaceMemberRef[]> {
  return await getDb()
    .select({
      id: billingWorkspaceMembers.id,
      workspace_id: billingWorkspaceMembers.workspace_id,
      user_id: billingWorkspaceMembers.user_id,
      role: billingWorkspaceMembers.role,
      joined_at: billingWorkspaceMembers.joined_at,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      deleted_at: users.deleted_at,
    })
    .from(billingWorkspaceMembers)
    .innerJoin(users, eq(users.id, billingWorkspaceMembers.user_id))
    .where(eq(billingWorkspaceMembers.workspace_id, workspaceId))
    .orderBy(asc(billingWorkspaceMembers.joined_at))
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
 * `billing.workspaces`.**
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

  return await getDb().transaction(async (tx) => {
    // Re-check INSIDE the transaction. Two sign-ins racing — a browser tab and a
    // `bk login` in the same second — would otherwise both see no membership and
    // both mint a workspace, and the loser is a row nobody ever opens.
    //
    // Note the projection: `billingWorkspaceMembers.workspace_id`, NOT
    // `billingWorkspaces.id`. This query does not join the workspaces table,
    // and Drizzle throws at RUNTIME rather than at compile time when a
    // projection names an unjoined table. tsc will not save you here.
    const already = await tx
      .select({ id: billingWorkspaceMembers.workspace_id })
      .from(billingWorkspaceMembers)
      .where(eq(billingWorkspaceMembers.user_id, userId))
      .limit(1)
    if (already[0]) {
      const ws = await getWorkspaceForUser(String(already[0].id), userId)
      if (ws) return { workspace: ws, created: false }
    }

    const workspace = await mintWorkspace(tx, userId, `${label}'s workspace`, slugify(label))
    return { workspace, created: true }
  })
}

/**
 * The INSERT pair, shared by the two callers that mint a workspace.
 *
 * Extracted rather than copied because the slug-collision loop and the
 * membership row are the parts that must not diverge: a workspace with no
 * membership row locks its own owner out of their data, since every read here
 * joins on membership.
 *
 * Takes a `tx` and does not open one. Both callers already need a transaction
 * for their own reasons, and a function that opened its own would make the
 * membership insert a separate commit from the workspace insert.
 */
async function mintWorkspace(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: number,
  name: string,
  slugBase: string
): Promise<WorkspaceMembershipRef> {
  // Slug collision: `slug` is UNIQUE and two people called Anna would collide.
  // The suffix comes from the attempt counter rather than a random string so the
  // slug stays typeable — somebody has to be able to say it out loud, and it
  // appears in every URN this app prints (`bc:billing:<slug>/invoice/12`).
  let slug = slugBase
  for (let attempt = 0; attempt < 25; attempt++) {
    const clash = await tx
      .select({ id: billingWorkspaces.id })
      .from(billingWorkspaces)
      .where(eq(billingWorkspaces.slug, slug))
      .limit(1)
    if (!clash[0]) break
    slug = `${slugBase}-${attempt + 2}`
  }

  const [ws] = await tx
    .insert(billingWorkspaces)
    .values({ name, slug, owner_id: userId })
    .returning(WS_COLUMNS)

  await tx
    .insert(billingWorkspaceMembers)
    .values({ workspace_id: ws.id, user_id: userId, role: 'owner' })

  return { ...ws, member_role: 'owner' as const }
}

/** A refusal `POST /api/workspaces` turns into a 409 with its suggestion. */
export class WorkspaceRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

/**
 * Mint a workspace on request — `bk billing workspace create` and the "create a
 * workspace" action on the dashboard.
 *
 * ===========================================================================
 * THE EMPTY-WORKSPACE DECISION THIS APP TAKES (phase 0)
 * ===========================================================================
 * `docs/2026-08-multi-app-refactor.md` §9.1 is an open platform question:
 * somebody arriving on a session cookie from another blackcode app gets a valid
 * session here and NO workspace, because `ensureWorkspaceForUser` runs only in
 * the sign-in callback and in `POST /api/auth/register`, and a cookie-arriving
 * visitor takes neither path. Their only way out was to sign out and back in.
 *
 * `docs/billing-app-plan/phase-0-register-the-app.md` lists three candidate
 * answers and says to pick one here. **b/billing picks the explicit route: this
 * function, reachable from a button and from `bk`.**
 *
 * The one that was rejected is bootstrapping on first authenticated request. It
 * is the cheapest and it is wrong for this app specifically: it would mean any
 * person holding a blackcode account for any reason silently acquires tenancy in
 * the app that sends real payment slips, without ever having asked for it. A
 * workspace here is a tenant, and a tenant appearing because somebody loaded a
 * page is a tenant nobody decided to create.
 *
 * Keeping the SIGN-IN bootstrap and adding this is not a contradiction: signing
 * in at this app's own login IS asking to use it. What this closes is the dead
 * end, and it closes it with an act rather than a side effect.
 *
 * ===========================================================================
 * WHY THERE IS NO ONE-WORKSPACE-PER-PERSON CAP, UNLIKE b/books
 * ===========================================================================
 * `apps/books/lib/db/queries/workspaces.ts` refuses a second workspace, because
 * its invitation-accept flow is not open and a second workspace would be a room
 * only its creator can enter.
 *
 * The same invitation gap exists here — `Invites` is on in the CLI and
 * `InviteAccept` is off, so an invitation can be sent and not yet accepted — and
 * the cap is still wrong for this app, because a second workspace is a genuinely
 * separate TENANT rather than a second entity. A second company inside one
 * tenant is `bk billing company create`, which is the `--company` scope
 * dimension in phase 1 and is where "one more entity to bill from" belongs.
 * `docs/billing-app-plan/phase-6-seed-and-production.md` also requires two
 * workspaces owned by one person — a full one and a near-empty `demo-tenant` —
 * to prove isolation and force every empty state, which a cap would forbid.
 *
 * **The standing obligation:** when the invitation-accept flow lands, a second
 * workspace becomes shareable and nothing here needs to change. Until then, a
 * workspace somebody creates is theirs alone, and that is stated on the screen
 * that creates it rather than discovered.
 */
export async function createWorkspaceForUser(
  userId: number,
  name: string
): Promise<WorkspaceMembershipRef> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new WorkspaceRefused(
      'invalid_name',
      'a workspace needs a name',
      'bk billing workspace create --name "Acme SA"'
    )
  }
  return getDb().transaction((tx) => mintWorkspace(tx, userId, trimmed, slugify(trimmed)))
}

/**
 * Add somebody to a workspace, or leave them where they are.
 *
 * `ON CONFLICT DO NOTHING` against `uq_billing_workspace_members_ws_user`
 * rather than SELECT-then-INSERT: two clicks on the same accept link are a race,
 * and the unique index is the only thing that can settle it.
 */
export async function addMember(
  workspaceId: number,
  userId: number,
  role: 'owner' | 'member' = 'member'
): Promise<void> {
  await getDb()
    .insert(billingWorkspaceMembers)
    .values({ workspace_id: workspaceId, user_id: userId, role })
    .onConflictDoNothing()
}

/** One membership row, or null. Used by the owner-only route gates. */
export async function getMembership(
  workspaceId: number,
  userId: number
): Promise<{ role: string } | null> {
  const rows = await getDb()
    .select({ role: billingWorkspaceMembers.role })
    .from(billingWorkspaceMembers)
    .where(
      and(
        eq(billingWorkspaceMembers.workspace_id, workspaceId),
        eq(billingWorkspaceMembers.user_id, userId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}
