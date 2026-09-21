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

import { and, asc, eq, sql } from 'drizzle-orm'
import type {
  WorkspaceMemberRef,
  WorkspaceMembershipRef,
  WorkspaceRef,
} from '@blackcode/platform-api'
import { getDb } from '../client'
import {
  billingAudit,
  billingCompany,
  billingHistory,
  billingInvoice,
  billingRecurrence,
  billingWorkspaceMembers,
  billingWorkspaces,
  users,
} from '../schema'

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
 * Callers: the sign-in callback (`lib/auth.ts`), `POST /api/auth/register`,
 * and — since phase 2 — `app/dashboard/page.tsx`, for a session that arrived
 * from another blackcode app without taking this app's sign-in path.
 *
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
 * answers and says to pick one here. Phase 0 picked the explicit route — this
 * function, reachable from a button and from `bk` — and rejected bootstrapping
 * on first authenticated request, arguing that "a tenant appearing because
 * somebody loaded a page is a tenant nobody decided to create".
 *
 * **Phase 2 (2026-09-21) reversed half of that, deliberately.** In production a
 * person signed in on another blackcode app who opened this app's dashboard got
 * a "No workspace yet" dead end and a forced step. Opening THIS app's
 * `/dashboard` is as much a decision to use it as signing in at its `/login`,
 * so `app/dashboard/page.tsx` now runs `ensureWorkspaceForUser` — the sign-in
 * bootstrap, not a second one — for a validated user with no workspace, and the
 * reasoning is written there. Nothing is minted by `/api/*` or by another app.
 *
 * This function remains the EXPLICIT act: a named workspace, a second tenant,
 * `bk billing workspace create`, and the `?new=1` screen.
 *
 * ===========================================================================
 * WHY THERE IS NO ONE-WORKSPACE-PER-PERSON CAP, UNLIKE b/books
 * ===========================================================================
 * `apps/books/lib/db/queries/workspaces.ts` refuses a second workspace, because
 * its invitation-accept flow is not open and a second workspace would be a room
 * only its creator can enter.
 *
 * The same invitation gap existed here until phase 2 (an invitation could be
 * sent and not accepted) — and the cap was wrong for this app even then, because a second workspace is a genuinely
 * separate TENANT rather than a second entity. A second company inside one
 * tenant is `bk billing company create`, which is the `--company` scope
 * dimension in phase 1 and is where "one more entity to bill from" belongs.
 * `docs/billing-app-plan/phase-6-seed-and-production.md` also requires two
 * workspaces owned by one person — a full one and a near-empty `demo-tenant` —
 * to prove isolation and force every empty state, which a cap would forbid.
 *
 * **The standing obligation was met on 2026-09-21** (phase 2): the
 * invitation-accept flow landed (`/invitations/[token]`, `POST
 * /api/invitations/accept`), so a second workspace is shareable, and nothing
 * here needed to change.
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

// ---------------------------------------------------------------------------
// Administration — rename, transfer, remove a member, delete (phase 2)
// ---------------------------------------------------------------------------
//
// Ported from `apps/sales/lib/db/queries/workspaces.ts` (never imported — apps
// do not import each other, `lib/app-isolation.test.ts`). Two differences, both
// deliberate:
//
//   1. **No event row.** Sales records these in `sales.events`. This app's only
//      log is `billing.audit`, whose `audit_subject_type_check` (0005) admits
//      `invoice`, `company` and `recurrence` and nothing else: the audit log is
//      the record of the legal documents, not of tenancy. Widening it is a
//      migration and a decision about what the statutory log is FOR, and
//      neither is this phase's.
//   2. **Delete refuses instead of cascading** — see `deleteWorkspace`.

/** The whole-row projection a PATCH answers with — the bare entity. */
export async function updateWorkspace(
  workspaceId: number,
  patch: { name: string }
): Promise<WorkspaceRef | null> {
  const [row] = await getDb()
    .update(billingWorkspaces)
    .set({ name: patch.name, updated_at: new Date() })
    .where(eq(billingWorkspaces.id, workspaceId))
    .returning(WS_COLUMNS)
  return row ?? null
}

/**
 * What a workspace holds that this app may never delete, by table.
 *
 * Every one of these five tables has a `BEFORE DELETE` trigger that raises
 * (`trg_no_hard_delete` on company, invoice, audit, recurrence — 0005, 0012;
 * `trg_history_read_only` on history — 0010), and a row-level trigger FIRES ON
 * AN `ON DELETE CASCADE` as well as on a direct DELETE. So a workspace holding
 * any row in any of them cannot be deleted by anybody, the owner role included:
 * the cascade reaches the row and the trigger aborts the whole statement.
 *
 * `invoice_line`, `counters`, `idempotency_keys`, `workspace_members` and
 * `invitations` are not here: they cascade cleanly, and an invoice line cannot
 * exist without an invoice anyway.
 */
export interface WorkspaceHoldings {
  companies: number
  invoices: number
  audit_rows: number
  imported_bills: number
  recurring_series: number
}

export async function workspaceHoldings(workspaceId: number): Promise<WorkspaceHoldings> {
  const r = await getDb().execute<{
    companies: number
    invoices: number
    audit_rows: number
    imported_bills: number
    recurring_series: number
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM ${billingCompany}    WHERE workspace_id = ${workspaceId}) AS companies,
      (SELECT COUNT(*)::int FROM ${billingInvoice}    WHERE workspace_id = ${workspaceId}) AS invoices,
      (SELECT COUNT(*)::int FROM ${billingAudit}      WHERE workspace_id = ${workspaceId}) AS audit_rows,
      (SELECT COUNT(*)::int FROM ${billingHistory}    WHERE workspace_id = ${workspaceId}) AS imported_bills,
      (SELECT COUNT(*)::int FROM ${billingRecurrence} WHERE workspace_id = ${workspaceId}) AS recurring_series
  `)
  const row = r.rows[0]
  return {
    companies: Number(row?.companies ?? 0),
    invoices: Number(row?.invoices ?? 0),
    audit_rows: Number(row?.audit_rows ?? 0),
    imported_bills: Number(row?.imported_bills ?? 0),
    recurring_series: Number(row?.recurring_series ?? 0),
  }
}

/** True when any retained record exists — i.e. the workspace can never be deleted. */
export function holdsRetainedRecords(h: WorkspaceHoldings): boolean {
  return (
    h.companies + h.invoices + h.audit_rows + h.imported_bills + h.recurring_series > 0
  )
}

/** "2 companies, 14 invoices, 31 audit rows" — only the non-zero ones. */
export function describeHoldings(h: WorkspaceHoldings): string {
  const parts: string[] = []
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  add(h.companies, 'company', 'companies')
  add(h.invoices, 'invoice', 'invoices')
  add(h.recurring_series, 'recurring series', 'recurring series')
  add(h.imported_bills, 'imported bill', 'imported bills')
  add(h.audit_rows, 'audit row', 'audit rows')
  return parts.join(', ')
}

/** Why a delete was refused, with the counts that caused it. */
export class WorkspaceRetained extends Error {
  constructor(public holdings: WorkspaceHoldings) {
    super(`this workspace holds ${describeHoldings(holdings)}`)
  }
}

/**
 * Delete a workspace — ONLY one that holds no retained record.
 *
 * ===========================================================================
 * THE DECISION: REFUSE, DO NOT CASCADE (phase 2, 2026-09-21)
 * ===========================================================================
 * `apps/sales` deletes a workspace with one statement and lets the cascade take
 * everything. Here that statement would be an attempt to destroy numbered legal
 * documents under a ten-year retention duty (art. 958f CO), and the database
 * already refuses it twice over: `REVOKE DELETE` on invoice/audit/company (0006)
 * — which a cascade does NOT consult, since referential actions run as the table
 * owner — and the `BEFORE DELETE` triggers listed at `workspaceHoldings`, which
 * a cascade DOES fire. So the cascade raises, the transaction rolls back, and
 * without this check the caller would see a 500 carrying a trigger message.
 *
 * So the check comes first and the refusal is a sentence (409
 * `workspace_retained` at the route). What IS deletable is a workspace nobody
 * ever issued from: no company, no invoice, no series, no imported bill, no
 * audit row. That is a real case — the "created by mistake" tenant, a second
 * tenant made to try things, the `demo-tenant` shape — and it is the only one.
 *
 * ── WHAT THE GRANTS ALLOW ──────────────────────────────────────────────────
 * `billing_app` holds DELETE on `billing.workspaces`, `workspace_members`,
 * `invitations`, `counters` and `idempotency_keys` (0003's blanket grant; 0006
 * revokes only invoice/audit/company, 0010 history, 0012 recurrence). Every
 * table an EMPTY workspace can have rows in is therefore deletable by the app
 * role, and the delete below works as that role — the integration suite
 * `workspace-admin.integration.test.ts` runs it as `billing_app` and reads the
 * rows back.
 *
 * ── THE RACE ───────────────────────────────────────────────────────────────
 * A company created between the check and the DELETE is caught by its own
 * trigger: the cascade reaches it and the statement aborts. Mapped to the same
 * refusal, with a fresh count, so the caller never sees the trigger's text.
 */
export async function deleteWorkspace(workspaceId: number): Promise<boolean> {
  const before = await workspaceHoldings(workspaceId)
  if (holdsRetainedRecords(before)) throw new WorkspaceRetained(before)
  try {
    const rows = await getDb()
      .delete(billingWorkspaces)
      .where(eq(billingWorkspaces.id, workspaceId))
      .returning({ id: billingWorkspaces.id })
    return rows.length > 0
  } catch (e) {
    const after = await workspaceHoldings(workspaceId)
    if (holdsRetainedRecords(after)) throw new WorkspaceRetained(after)
    throw e
  }
}

/**
 * Hand the workspace to another MEMBER. The previous owner stays, as a member.
 *
 * One transaction: a workspace whose `owner_id` and membership roles disagree
 * has two people who each look like the owner to a different check.
 */
export async function transferOwnership(workspaceId: number, newOwnerUserId: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    const wsRows = await tx
      .select({ id: billingWorkspaces.id, owner_id: billingWorkspaces.owner_id })
      .from(billingWorkspaces)
      .where(eq(billingWorkspaces.id, workspaceId))
      .for('update')
      .limit(1)
    if (!wsRows[0]) throw new Error('workspace_not_found')

    const memberRow = await tx
      .select({ id: billingWorkspaceMembers.id })
      .from(billingWorkspaceMembers)
      .where(
        and(
          eq(billingWorkspaceMembers.workspace_id, workspaceId),
          eq(billingWorkspaceMembers.user_id, newOwnerUserId)
        )
      )
      .limit(1)
    if (!memberRow[0]) throw new Error('not_a_member')
    if (wsRows[0].owner_id === newOwnerUserId) return

    await tx
      .update(billingWorkspaceMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(billingWorkspaceMembers.workspace_id, workspaceId),
          eq(billingWorkspaceMembers.user_id, wsRows[0].owner_id)
        )
      )
    await tx
      .update(billingWorkspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(billingWorkspaceMembers.workspace_id, workspaceId),
          eq(billingWorkspaceMembers.user_id, newOwnerUserId)
        )
      )
    await tx
      .update(billingWorkspaces)
      .set({ owner_id: newOwnerUserId, updated_at: new Date() })
      .where(eq(billingWorkspaces.id, workspaceId))
  })
}

/**
 * Remove somebody from a workspace. False when they were not in it.
 *
 * Refusing to remove the OWNER is the route's job — it has the workspace row
 * and can name the recovery (transfer first).
 *
 * The invoices they created stay, attributed: `created_by` and the audit log's
 * `actor_user_id` reference `platform.users`, not the membership, so removing
 * somebody from a workspace does not rewrite who issued what.
 */
export async function removeMember(workspaceId: number, userId: number): Promise<boolean> {
  const rows = await getDb()
    .delete(billingWorkspaceMembers)
    .where(
      and(
        eq(billingWorkspaceMembers.workspace_id, workspaceId),
        eq(billingWorkspaceMembers.user_id, userId)
      )
    )
    .returning({ id: billingWorkspaceMembers.id })
  return rows.length > 0
}

/**
 * Who this owner could invite without retyping an address: everyone they share
 * a BILLING workspace with — plus, for a super admin, every live account
 * (`from_platform: true`, rendered as a separate section).
 *
 * Ported from `apps/sales`' `listInviteCandidates`, whose route header argues
 * the super-admin widening. The privacy guard for an ordinary owner is the JOIN:
 * a person you share no billing workspace with is not discoverable here.
 */
export interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
  from_platform: boolean
}

export async function listInviteCandidates(input: {
  userId: number
  currentWorkspaceId: number
  /** Decided by the caller — who is a super admin is platform-auth's question. */
  includePlatform: boolean
}): Promise<InviteCandidate[]> {
  const db = getDb()
  const [currentRows, pendingRows, sharedRows] = await Promise.all([
    db
      .select({ user_id: billingWorkspaceMembers.user_id })
      .from(billingWorkspaceMembers)
      .where(eq(billingWorkspaceMembers.workspace_id, input.currentWorkspaceId)),
    db.execute<{ email: string }>(sql`
      SELECT email FROM billing.invitations
      WHERE workspace_id = ${input.currentWorkspaceId} AND status = 'pending'
    `),
    db.execute<{
      user_id: number
      email: string
      name: string | null
      avatar_url: string | null
      workspace_name: string
    }>(sql`
      SELECT u.id AS user_id, u.email, u.name, u.avatar_url, w.name AS workspace_name
      FROM billing.workspace_members mine
      JOIN billing.workspace_members theirs ON theirs.workspace_id = mine.workspace_id
      JOIN billing.workspaces w ON w.id = mine.workspace_id
      JOIN platform.users u ON u.id = theirs.user_id
      WHERE mine.user_id = ${input.userId}
        AND theirs.user_id <> ${input.userId}
        AND u.deleted_at IS NULL
    `),
  ])

  const memberIds = new Set(currentRows.map((r) => r.user_id))
  const pendingEmails = new Set(pendingRows.rows.map((r) => r.email.toLowerCase()))

  const byUser = new Map<number, InviteCandidate>()
  for (const r of sharedRows.rows) {
    const entry = byUser.get(r.user_id) ?? {
      user_id: r.user_id,
      email: r.email,
      name: r.name,
      avatar_url: r.avatar_url,
      already_member: memberIds.has(r.user_id),
      invited: pendingEmails.has(r.email.toLowerCase()),
      shared_workspaces: [],
      from_platform: false,
    }
    if (!entry.shared_workspaces.includes(r.workspace_name)) entry.shared_workspaces.push(r.workspace_name)
    byUser.set(r.user_id, entry)
  }

  if (input.includePlatform) {
    const platformRows = await db.execute<{
      user_id: number
      email: string
      name: string | null
      avatar_url: string | null
    }>(sql`
      SELECT u.id AS user_id, u.email, u.name, u.avatar_url
      FROM platform.users u
      WHERE u.deleted_at IS NULL AND u.id <> ${input.userId}
    `)
    for (const r of platformRows.rows) {
      if (byUser.has(r.user_id)) continue
      byUser.set(r.user_id, {
        ...r,
        already_member: memberIds.has(r.user_id),
        invited: pendingEmails.has(r.email.toLowerCase()),
        shared_workspaces: [],
        from_platform: true,
      })
    }
  }

  return [...byUser.values()].sort((a, b) => {
    if (a.already_member !== b.already_member) return a.already_member ? 1 : -1
    return (a.name ?? a.email).localeCompare(b.name ?? b.email)
  })
}
