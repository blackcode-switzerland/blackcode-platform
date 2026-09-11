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
// MULTIPLE WORKSPACES PER PERSON, AND THE UI SAYS SO NOW (2026-09-11)
// ---------------------------------------------------------------------------
// This section used to read:
//
//   > ONE WORKSPACE PER PERSON, AND THE UI NEVER SAYS THE WORD
//   >
//   > PLAN.md §1: no switcher, no picker, no create-workspace page, no
//   > workspace settings. The TABLES are fully multi-workspace — every row
//   > carries a `workspace_id` — so making sales multi-workspace later is a UI
//   > change rather than a migration. What is hidden is the offer, not the
//   > capability.
//   >
//   > `ensureWorkspaceForUser` below is the whole of the bootstrap, and it is
//   > deliberately the ONLY writer of `sales.workspaces`.
//
// Both halves were true until this date. D-3 — "a workspace is the company;
// you are granted into one, you do not open one from a sales context" — is
// REVERSED here the same way it already was in `apps/issues`: this app gets
// create, rename (name only — the slug stays immutable, see `updateWorkspace`
// below for why), transfer-ownership and delete, with the same web + CLI +
// route parity every other capability in this app carries.
//
// `ensureWorkspaceForUser` is no longer the only writer — `createWorkspace`,
// `updateWorkspace` and `deleteWorkspace` below are the other three — but it
// stays the ONLY writer reachable with no prior membership, i.e. the sign-in
// bootstrap, and it now calls the same `pickAvailableSlug` helper
// `createWorkspace` does rather than keeping its own copy of that loop.

import { and, asc, eq, sql } from 'drizzle-orm'
import type {
  WorkspaceMemberRef,
  WorkspaceMembershipRef,
  WorkspaceRef,
} from '@blackcode/platform-api'
import type { PlatformTx } from '@blackcode/platform-db'
import { getDb } from '../client'
import { salesUserSettings, salesWorkspaceMembers, salesWorkspaces, users } from '../schema'
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

/** A membership, plus WHO owns the workspace. */
export type WorkspaceMembershipWithOwner = WorkspaceMembershipRef & {
  /** The owner's display name, their email if they have no name, or null if
   *  the owner row cannot be resolved at all (a deleted account, `owner_id`
   *  null). Never the empty string — see the switcher for why. */
  owner_label: string | null
}

/**
 * The same list, with each workspace's OWNER resolved to something readable.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SECOND FUNCTION AND NOT A WIDER `WorkspaceMembershipRef`
 * ---------------------------------------------------------------------------
 * `WorkspaceMembershipRef` lives in `@blackcode/platform-api` and `apps/issues`
 * implements it too. Adding a required `owner_label` to it would make every
 * caller in both apps produce a field that exists for one label in one sales
 * sidebar — a platform change to serve a UI copy decision. So this app asks its
 * own question with its own query and maps the answer where it is used
 * (`app/dashboard/[ws]/layout.tsx`), which is the smaller change and the one
 * that does not reach across the boundary.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OWNER AND NOT THE ROLE
 * ---------------------------------------------------------------------------
 * The switcher said `Your workspace` / `Member`, and `Member` does not answer
 * the question people actually have. Real screenshot, 2026-08-12:
 *
 *     My Workspace                 ✓
 *     Member
 *     Balathanusan 1's worksp…
 *     Your workspace
 *
 * "My Workspace" is somebody ELSE'S — it is named in the first person by
 * whoever created it, so it reads as yours, and the line under it says
 * "Member", which describes YOUR ROLE rather than WHOSE it is. The one label
 * that disambiguates two similarly-named workspaces is the owner's name.
 *
 * LEFT JOIN, not inner. `sales.workspaces.owner_id` is NOT NULL — checked in
 * `information_schema`, not inferred from the schema file — so the join cannot
 * miss for a null pointer. It can still miss on a HARD-deleted `platform.users`
 * row, and the FK has no cascade that would clean the workspace up with it.
 *
 * An inner join would then silently drop a workspace the person is a member of,
 * which is infinitely worse than an unlabelled row: they would lose the ability
 * to switch into it, and the layout above uses this same list to decide a 404.
 * The unresolved case renders as `Member`, which is what it said before this
 * change — never blank.
 */
export async function listWorkspacesWithOwnerForUser(
  userId: number
): Promise<WorkspaceMembershipWithOwner[]> {
  const rows = await getDb()
    .select({
      ...WS_COLUMNS,
      role: salesWorkspaceMembers.role,
      owner_name: users.name,
      owner_email: users.email,
    })
    .from(salesWorkspaceMembers)
    .innerJoin(salesWorkspaces, eq(salesWorkspaces.id, salesWorkspaceMembers.workspace_id))
    .leftJoin(users, eq(users.id, salesWorkspaces.owner_id))
    .where(eq(salesWorkspaceMembers.user_id, userId))
    .orderBy(asc(salesWorkspaces.updated_at))

  return rows.map(({ role, owner_name, owner_email, ...ws }) => ({
    ...ws,
    member_role: role as 'owner' | 'member',
    // Name, then email, then null. `?.trim() ||` rather than `??` on purpose:
    // `platform.users.name` is nullable AND can hold an empty string, and a
    // person whose name is "" would otherwise render as a blank line where the
    // label used to say something. Blank is worse than "Member".
    owner_label: owner_name?.trim() || owner_email?.trim() || null,
  }))
}

/**
 * Remember which workspace this person is working in.
 *
 * Upsert on the primary key, so a person who has never had a settings row and
 * one who is switching for the tenth time take the same path.
 *
 * MEMBERSHIP IS CHECKED BY THE CALLER, not here — the route resolves the target
 * through `getWorkspaceForUser` (which joins membership) before calling this, so
 * a workspace you cannot reach never gets written. Re-checking here would be a
 * second query for a fact already established one line earlier.
 */
export async function setActiveWorkspaceForUser(
  userId: number,
  workspaceId: number
): Promise<void> {
  await getDb()
    .insert(salesUserSettings)
    .values({ user_id: userId, active_workspace_id: workspaceId })
    .onConflictDoUpdate({
      target: salesUserSettings.user_id,
      set: { active_workspace_id: workspaceId, updated_at: new Date() },
    })
}

/**
 * The workspace this person was last in — or their fallback.
 *
 * ── THE MEMBERSHIP RE-CHECK IS THE POINT, NOT A PRECAUTION ─────────────────
 * The stored pointer is a workspace id, and the foreign key guarantees only
 * that the workspace still EXISTS. It cannot express "and they are still in
 * it", so a person removed from a shared workspace would otherwise keep being
 * sent to it — landing on a page that 404s, with the sidebar still naming it.
 *
 * So the pointer is resolved through the membership list rather than read
 * directly: if it is not in there, it is treated as absent.
 *
 * The fallback is the FIRST membership, which for the common case is a person's
 * own workspace: `listWorkspacesForUser` orders oldest-first, and your own is
 * minted at sign-in, before you can accept an invitation into anyone else's.
 * The previous version took the LAST, which was a positional guess made when
 * nobody could have two — it now means "the most recently updated workspace
 * somebody else owns", which is not a sensible place to open.
 */
export async function getActiveWorkspaceForUser(
  userId: number
): Promise<WorkspaceMembershipRef | null> {
  const [mine, storedId] = await Promise.all([
    listWorkspacesForUser(userId),
    getStoredActiveWorkspaceId(userId),
  ])
  return resolveActiveWorkspace(mine, storedId)
}

/**
 * The DECISION, separated from the two queries that feed it.
 *
 * Pure and exported so its test can call THIS function rather than a copy of it.
 * The first version of that test reimplemented the resolution in the test file
 * and asserted on the reimplementation — green forever, whatever this function
 * did. That is the shape CLAUDE.md's finding #10 describes: a guard that has
 * quietly stopped pointing at the thing it names.
 *
 * `memberships` must be oldest-first, which is what `listWorkspacesForUser`
 * returns; the fallback depends on it.
 */
export function resolveActiveWorkspace(
  memberships: WorkspaceMembershipRef[],
  storedId: number | null
): WorkspaceMembershipRef | null {
  if (memberships.length === 0) return null
  if (storedId != null) {
    const remembered = memberships.find((w) => w.id === storedId)
    if (remembered) return remembered
  }
  return memberships[0]
}

/**
 * The RAW stored pointer — null when nothing has been chosen.
 *
 * Split out from `getActiveWorkspaceForUser` because the two callers need
 * different answers, and collapsing them loses the distinction that matters.
 * The WorkspaceSource always wants a workspace, so it falls back; `/dashboard`
 * must tell "they chose this" from "we picked one for them", because it only
 * skips the picker for the first. A single function returning the fallback
 * cannot express that, and a caller comparing against `mine[0]` to infer it
 * would be wrong the moment somebody deliberately chooses their first
 * workspace.
 *
 * No membership check here — this is the stored value, nothing more. Callers
 * that act on it resolve it against the membership list.
 */
export async function getStoredActiveWorkspaceId(userId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: salesUserSettings.active_workspace_id })
    .from(salesUserSettings)
    .where(eq(salesUserSettings.user_id, userId))
    .limit(1)
  return row?.id ?? null
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
// Create, rename, transfer, delete — the D-3 reversal
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

/**
 * Find an available slug starting from `base`, suffixing `-2`, `-3`, … on
 * collision — the exact loop `ensureWorkspaceForUser` used to carry as its own
 * inline copy, factored out here so it and `createWorkspace` share one
 * implementation instead of two that can drift.
 *
 * MUST be called with a transaction handle, and the check-then-write MUST run
 * inside the same transaction as the insert that claims the slug —
 * `ensureWorkspaceForUser`'s header explains why: two writers racing on the
 * same base would otherwise both see no collision and both try to claim it,
 * and `slug` is UNIQUE, so the loser fails loudly instead of silently getting
 * a different slug than the one this function told it was free.
 *
 * No `excludeId` parameter. `updateWorkspace` never calls this — the slug is
 * immutable for a sales workspace (see that function's header) — so the only
 * two callers that ever need a FRESH slug are minting a brand new row.
 */
async function pickAvailableSlug(tx: PlatformTx, base: string): Promise<string> {
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
  return slug
}

export interface CreateWorkspaceInput {
  name: string
}

/**
 * Create a new sales workspace, owned by the caller.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — D-3 REVERSED (2026-09-11)
 * ---------------------------------------------------------------------------
 * Until this date `ensureWorkspaceForUser` was the only writer of
 * `sales.workspaces`, minting exactly one workspace per person at sign-in. That
 * matched D-3: "a workspace is the company, you are granted into one, you do
 * not open one from a sales context." The product decision reversing D-3 is
 * documented on `app/api/workspaces/route.ts` and `components/workspace-
 * switcher.tsx`; what belongs here is the SHAPE, ported from
 * `apps/issues/lib/db/queries/workspaces.ts`'s `createWorkspace` — insert the
 * workspace, insert the owner membership, record both events, one transaction.
 *
 * No `sales.counters` row is inserted here, unlike issues' `workspace_counters`
 * insert: this app's counters are upserted lazily, per (workspace, entity
 * type), on first use (`lib/db/queries/counters.ts`'s `allocateSeq`), so there
 * is nothing to pre-create.
 *
 * No `logo_url`: `sales.workspaces` has no such column (see `salesWorkspaces`
 * in the schema file for why), so there is no field to accept here.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  actor: Actor
): Promise<WorkspaceRef> {
  return await getDb().transaction(async (tx) => {
    const base = slugify(input.name)
    const slug = await pickAvailableSlug(tx, base)

    const [ws] = await tx
      .insert(salesWorkspaces)
      .values({ name: input.name, slug, owner_id: actor.userId })
      .returning(WS_COLUMNS)
    if (!ws) throw new Error('workspace insert returned nothing')

    await tx.insert(salesWorkspaceMembers).values({
      workspace_id: ws.id,
      user_id: actor.userId,
      role: 'owner',
    })

    // Both events, same shape `removeMember` above uses: `subjectUrn: null`,
    // explicitly, rather than left to fall through to `resolveSubjectUrn`'s
    // default derivation. A workspace and a membership are not numbered
    // entities INSIDE a workspace — they ARE the workspace, or a fact about who
    // is in it — so neither has a `bc:sales:{ws}/…` address of its own to
    // derive. Leaving `subjectUrn` unset here would call `resolveSubjectUrn`,
    // which does not recognise either type and would silently return null
    // anyway — spelling it out says that is the correct answer, not an
    // oversight.
    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'workspace',
      entityId: ws.id,
      action: 'created',
      diff: { after: { name: ws.name, slug: ws.slug } },
      subjectUrn: null,
    })
    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'workspace_member',
      entityId: actor.userId,
      action: 'member_added',
      meta: { user_id: actor.userId, role: 'owner', via: 'workspace_create' },
      subjectUrn: null,
    })

    return ws
  })
}

export interface UpdateWorkspaceInput {
  name: string
}

/**
 * Rename a workspace. NAME ONLY — there is no `slug` field on this input type,
 * on purpose.
 *
 * ---------------------------------------------------------------------------
 * WHY SLUG IS IMMUTABLE HERE AND IS NOT IN `apps/issues`
 * ---------------------------------------------------------------------------
 * `apps/issues`' `updateWorkspace` renames the slug AND cascades that rename
 * into `platform.entities` via `renameWorkspaceEntities` — a URN embeds the
 * workspace slug, and that table is the denormalized index issues maintains so
 * every app can resolve one. Sales has no such projection:
 * multiAppFinalRefactor Phase 3 ended this app's write to `platform.entities`
 * entirely (see this file's own header and `lib/db/queries/events.ts`).
 *
 * What sales DOES denormalize is `sales.events.subject_urn` — a plain text
 * column, not an index with a rename cascade. A slug change would leave every
 * historical event's `subject_urn` pointing at a slug that no longer resolves,
 * and there is no reconciliation mechanism for that column: it is built once,
 * at write time, from `sales.*`, and never touched again (see
 * `resolveSubjectUrn`'s header). Building one is a real project of its own — it
 * touches every row in `sales.events`, not just the renamed workspace's — and
 * nothing in this change asked for it. Making the slug immutable avoids
 * inventing a cascade nobody requested rather than shipping one that is
 * subtly wrong.
 *
 * The CLI's shared `bk <app> workspace edit --slug` flag still exists (it is
 * one command shared by every app, in `cli/internal/appverbs/workspace.go`) and
 * will happily send `{"slug": "…"}` here. The ROUTE rejects it with a 400
 * `slug_immutable` and a suggestion naming the reason — see
 * `app/api/workspaces/[ws]/route.ts`. Do not "fix" this by forking the shared
 * CLI command; the asymmetry is intentional and documented in two places on
 * purpose (that route, and `cli/internal/commands/sales/appverbs.go`).
 */
export async function updateWorkspace(
  workspaceId: number,
  patch: UpdateWorkspaceInput,
  actor: Actor
): Promise<WorkspaceRef | null> {
  return await getDb().transaction(async (tx) => {
    const beforeRows = await tx
      .select(WS_COLUMNS)
      .from(salesWorkspaces)
      .where(eq(salesWorkspaces.id, workspaceId))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const [row] = await tx
      .update(salesWorkspaces)
      .set({ name: patch.name, updated_at: new Date() })
      .where(eq(salesWorkspaces.id, workspaceId))
      .returning(WS_COLUMNS)
    if (!row) return null

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'updated',
      diff: { before: { name: before.name }, after: { name: row.name } },
      // See `createWorkspace` above for why this is explicit rather than left
      // to `resolveSubjectUrn`'s default derivation.
      subjectUrn: null,
    })
    return row
  })
}

/**
 * Permanently delete a workspace and everything this app holds in it.
 *
 * No event is recorded — ported from `apps/issues`' `deleteWorkspace`, which
 * carries the same absence. There is nothing left to attach an event to once
 * the workspace row is gone: `sales.events.workspace_id` has a foreign key on
 * `sales.workspaces.id` `ON DELETE CASCADE` (migration 0004), so a "deleted"
 * event recorded in the same transaction would be destroyed by the very
 * statement it is describing.
 *
 * The cascade is the whole of the safety here, and it is the reason this
 * function is one statement: every content table's `workspace_id` foreign key
 * was swapped from `platform.workspaces` to `sales.workspaces`, `ON DELETE
 * CASCADE`, in migration `0004_sales_owns_its_workspaces.sql` — verify that
 * migration's twelve `ALTER TABLE … ADD CONSTRAINT` statements before touching
 * this function, NOT the Drizzle schema file's `.references()` calls, which
 * still point every one of those tables' `workspace_id` at
 * `.references(() => workspaces.id, …)` — the PLATFORM table. That is stale
 * TypeScript metadata left over from before Phase 2's constraint swap
 * (CLAUDE.md finding #20's lesson exactly: "check the catalog, not the repo").
 * It is a pre-existing mismatch this change did not introduce; flagged rather
 * than fixed here, because correcting a dozen `.references()` calls is a
 * project of its own and nothing in this change depends on them being right —
 * the migrations are hand-written SQL, not generated from this schema file.
 */
export async function deleteWorkspace(id: number): Promise<boolean> {
  const result = await getDb().delete(salesWorkspaces).where(eq(salesWorkspaces.id, id))
  return (result.rowCount ?? 0) > 0
}

/**
 * Transfer ownership: bumps the current owner to 'member', promotes the target
 * to 'owner', updates `sales.workspaces.owner_id`. The target must already be a
 * member — throws `not_a_member` if not, `workspace_not_found` if the workspace
 * is gone. Ported from `apps/issues`' `transferOwnership`; there is no
 * `app_access` role to keep in sync here — that table never existed for sales,
 * membership was always the whole grant (Phase 5's point, for every app).
 */
export async function transferOwnership(
  workspaceId: number,
  newOwnerUserId: number,
  actor: Actor
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const wsRows = await tx
      .select({ id: salesWorkspaces.id, owner_id: salesWorkspaces.owner_id })
      .from(salesWorkspaces)
      .where(eq(salesWorkspaces.id, workspaceId))
      .limit(1)
    if (!wsRows[0]) throw new Error('workspace_not_found')

    const memberRow = await tx
      .select({ id: salesWorkspaceMembers.id })
      .from(salesWorkspaceMembers)
      .where(
        and(
          eq(salesWorkspaceMembers.workspace_id, workspaceId),
          eq(salesWorkspaceMembers.user_id, newOwnerUserId)
        )
      )
      .limit(1)
    if (!memberRow[0]) throw new Error('not_a_member')

    if (wsRows[0].owner_id === newOwnerUserId) return

    const previousOwner = wsRows[0].owner_id

    await tx
      .update(salesWorkspaceMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(salesWorkspaceMembers.workspace_id, workspaceId),
          eq(salesWorkspaceMembers.user_id, previousOwner)
        )
      )
    await tx
      .update(salesWorkspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(salesWorkspaceMembers.workspace_id, workspaceId),
          eq(salesWorkspaceMembers.user_id, newOwnerUserId)
        )
      )
    await tx
      .update(salesWorkspaces)
      .set({ owner_id: newOwnerUserId, updated_at: new Date() })
      .where(eq(salesWorkspaces.id, workspaceId))

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'ownership_transferred',
      meta: { previous_owner_user_id: previousOwner, new_owner_user_id: newOwnerUserId },
      // See `createWorkspace` above for why this is explicit.
      subjectUrn: null,
    })
  })
}

// ---------------------------------------------------------------------------
// The bootstrap
// ---------------------------------------------------------------------------

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
    // collide. `pickAvailableSlug` — the same helper `createWorkspace` uses —
    // suffixes from the sequence rather than a random string so the slug stays
    // typeable, a person has to be able to say it out loud to a colleague. This
    // used to be its own inline copy of that loop; factored out 2026-09-11 so
    // the two writers of `sales.workspaces` cannot drift apart on it.
    const slug = await pickAvailableSlug(tx, base)

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
 * share a SALES workspace with, minus themselves — plus, for a super admin,
 * every account on the platform.
 *
 * For an ordinary owner the privacy guard is the join, not a filter applied
 * afterwards: a person you share no sales workspace with is not discoverable
 * here at all. That is the same rule `platform-db`'s version enforces,
 * restricted to this app's tenancy, which is the change from before Phase 2 —
 * an issues colleague is no longer a sales suggestion.
 *
 * The super admin is the deliberate exception; `includePlatform` is why the
 * caller decides it. See the route's header for what changed on 2026-08-11 and
 * why the earlier refusal did not survive contact with the actual job.
 */
export interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
  /**
   * True when this person is here ONLY because the caller is a super admin —
   * no shared sales workspace. The UI groups them separately, because "somebody
   * you work with" and "somebody with a blackcode login" are different claims
   * and one of them is a directory.
   */
  from_platform: boolean
}

export async function listInviteCandidates(input: {
  userId: number
  currentWorkspaceId: number
  /**
   * Decided by the CALLER. Who counts as a super admin is
   * `@blackcode/platform-auth`'s question — `SUPER_ADMINS` plus the whitelist —
   * and a db query module has no business importing that, exactly as
   * `platform-db`'s copy of this argues.
   */
  includePlatform: boolean
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
      from_platform: false,
    }
    if (!entry.shared_workspaces.includes(r.workspace_name)) {
      entry.shared_workspaces.push(r.workspace_name)
    }
    byUser.set(r.user_id, entry)
  }

  // A super admin additionally sees every live account. `byUser.has` first, so
  // somebody who IS a shared colleague keeps `from_platform: false` and their
  // workspace names — the platform pass adds people, it never re-labels one.
  //
  // `platform.users` is read, not written, and this app's role has SELECT on it
  // — the same grant the `sharedRows` join above already relies on.
  if (input.includePlatform) {
    const platformRows = await db.execute(sql`
      SELECT u.id AS user_id, u.email, u.name, u.avatar_url
      FROM platform.users u
      WHERE u.deleted_at IS NULL AND u.id <> ${input.userId}
    `)
    for (const r of platformRows.rows as {
      user_id: number
      email: string
      name: string | null
      avatar_url: string | null
    }[]) {
      if (byUser.has(r.user_id)) continue
      byUser.set(r.user_id, {
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        avatar_url: r.avatar_url,
        already_member: memberIds.has(r.user_id),
        invited: pendingEmails.has(r.email.toLowerCase()),
        shared_workspaces: [],
        from_platform: true,
      })
    }
  }

  return [...byUser.values()].sort((a, b) => {
    // Joinable people first, then the ones already in — a list whose top rows
    // are all "Already in" reads as having nothing to offer.
    if (a.already_member !== b.already_member) return a.already_member ? 1 : -1
    return (a.name ?? a.email).localeCompare(b.name ?? b.email)
  })
}
