// Per-app access, at the data layer.
//
// This file answers three questions and nothing else:
//   - which apps is this workspace running, and how does each grant access?
//   - may this user use this app in this workspace?
//   - how does a new membership become a grant, in the same transaction?
//
// The *enforcement* wrapper — the one that throws a 403 with a hint an agent can
// act on — lives in @blackcode/platform-auth. Keeping the queries here means
// platform-db never has to know about HTTP, and keeping enforcement there means
// there is exactly one place that decides what a denial looks like.
//
// WHY RAW SQL. Every statement interpolates the Drizzle table object
// (`${appAccess}`), never a string literal, so it is schema-qualified and
// type-checked — the standard set in Phase 3 (the platform migration, Phase 3
// step 5). Raw SQL rather than the query builder because every function here has
// to accept both a `db` and a transaction handle, and the two builders do not
// share a type. `Executor` below is that common shape.

import { sql, type SQL } from 'drizzle-orm'
import { appAccess, apps, users, workspaceApps, workspaceMembers } from './schema'
import type { DefaultAccessMode } from './schema'

/**
 * The narrow slice of a Drizzle client this module needs.
 *
 * Both `db` and the `tx` handle inside `db.transaction()` satisfy it, for either
 * driver, which is what lets the same helper run standalone or inside a caller's
 * transaction. Same-transaction is not optional for the grant helpers: a
 * membership row that commits without its `app_access` row is precisely the
 * lockout this phase exists to prevent.
 */
export interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>
}

const OFF_VALUES = new Set(['', '0', 'false', 'no', 'off'])

/**
 * Is per-app access enforced in this process?
 *
 * Read at call time, not at module load, so a test can flip it without a module
 * cache reset — and so a serverless instance picks up a changed variable on its
 * next cold start rather than needing a redeploy to notice.
 *
 * ── WHY THE KILL SWITCH IS AN OPT-OUT, NOT AN OPT-IN ────────────────────────
 * Enforcement is on unless `PLATFORM_ENFORCE_APP_ACCESS` is explicitly falsey.
 * Opt-in would mean the intended behaviour depended on remembering to set a
 * variable in every environment — and the environment where you forget is the
 * one that silently ignores access rules. Opt-out means the safe direction needs
 * no configuration, and recovery is one variable to ADD:
 *
 *     PLATFORM_ENFORCE_APP_ACCESS=0
 *
 * That restores exactly the pre-Phase-4 behaviour (workspace membership alone
 * decides), which is the documented rollback for that phase.
 *
 * It lives HERE rather than with the 403 it gates, because it is not only about
 * the 403: `listMyWorkspaces` reads it to decide whether to filter a listing, so
 * the switch has to be reachable from a package that knows nothing about HTTP.
 * `@blackcode/platform-api` re-exports it, so both spellings work.
 */
export function isAppAccessEnforced(): boolean {
  const raw = process.env.PLATFORM_ENFORCE_APP_ACCESS
  if (raw === undefined) return true
  return !OFF_VALUES.has(raw.trim().toLowerCase())
}

export interface AppAccessTarget {
  app: string
  workspaceId: number
  userId: number
}

/** One app as seen from inside a workspace. */
export interface WorkspaceAppRow {
  slug: string
  name: string
  description: string | null
  base_url: string | null
  /** Globally enabled in `platform.apps`. A disabled app is off everywhere. */
  globally_enabled: boolean
  /** Turned on for THIS workspace (a `workspace_apps` row exists). */
  enabled: boolean
  default_access: DefaultAccessMode | null
  enabled_at: string | null
  /** How many workspace members currently hold access. */
  access_count: number
}

/** A workspace member alongside whether they may use one particular app. */
export interface AppAccessMemberRow {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  member_role: string
  has_access: boolean
  granted_at: string | null
}

/** True if `userId` may use `app` in `workspaceId`. */
export async function hasAppAccess(db: Executor, t: AppAccessTarget): Promise<boolean> {
  // The workspace_apps join is the second half of the rule: access is denied
  // both when the user has no grant AND when the workspace isn't running the app
  // at all. `apps.enabled` is the global kill switch on top of that.
  const res = await db.execute(sql`
    SELECT 1
    FROM ${appAccess} aa
    JOIN ${workspaceApps} wa
      ON wa.workspace_id = aa.workspace_id AND wa.app = aa.app
    JOIN ${apps} a ON a.slug = aa.app
    WHERE aa.workspace_id = ${t.workspaceId}
      AND aa.app = ${t.app}
      AND aa.user_id = ${t.userId}
      AND a.enabled = true
    LIMIT 1
  `)
  return res.rows.length > 0
}

/** Why a user cannot use an app here — so the caller can say something useful. */
export type AppAccessDenial =
  | { reason: 'app_unknown' }
  | { reason: 'app_globally_disabled' }
  | { reason: 'app_not_enabled_for_workspace' }
  | { reason: 'no_grant'; default_access: DefaultAccessMode }

/**
 * Distinguish the denial reasons. Called only on the failure path — the happy
 * path is `hasAppAccess` alone, one indexed lookup.
 */
export async function explainAppAccessDenial(
  db: Executor,
  t: AppAccessTarget
): Promise<AppAccessDenial> {
  const res = await db.execute(sql`
    SELECT a.enabled AS app_enabled, wa.default_access
    FROM ${apps} a
    LEFT JOIN ${workspaceApps} wa
      ON wa.app = a.slug AND wa.workspace_id = ${t.workspaceId}
    WHERE a.slug = ${t.app}
    LIMIT 1
  `)
  const row = res.rows[0]
  if (!row) return { reason: 'app_unknown' }
  if (row.app_enabled !== true) return { reason: 'app_globally_disabled' }
  if (row.default_access == null) return { reason: 'app_not_enabled_for_workspace' }
  return { reason: 'no_grant', default_access: row.default_access as DefaultAccessMode }
}

/**
 * The workspace ids where `userId` is a member AND may use `app`.
 *
 * This is what makes visibility follow access: log into one app and you see only
 * the workspaces that run it and that you can use — not every workspace you
 * happen to belong to (docs/platform-architecture.md §4.5).
 */
export async function accessibleWorkspaceIds(
  db: Executor,
  app: string,
  userId: number
): Promise<Set<number>> {
  const res = await db.execute(sql`
    SELECT aa.workspace_id
    FROM ${appAccess} aa
    JOIN ${workspaceApps} wa
      ON wa.workspace_id = aa.workspace_id AND wa.app = aa.app
    JOIN ${apps} a ON a.slug = aa.app
    WHERE aa.user_id = ${userId}
      AND aa.app = ${app}
      AND a.enabled = true
  `)
  return new Set(res.rows.map((r) => Number(r.workspace_id)))
}

/** Every app the user can reach anywhere, with the workspaces they can reach it in. */
export async function appsReachableByUser(
  db: Executor,
  userId: number
): Promise<Array<{ slug: string; name: string; base_url: string | null; workspace_ids: number[] }>> {
  const res = await db.execute(sql`
    SELECT a.slug, a.name, a.base_url,
           array_agg(aa.workspace_id ORDER BY aa.workspace_id) AS workspace_ids
    FROM ${appAccess} aa
    JOIN ${workspaceApps} wa
      ON wa.workspace_id = aa.workspace_id AND wa.app = aa.app
    JOIN ${apps} a ON a.slug = aa.app
    WHERE aa.user_id = ${userId} AND a.enabled = true
    GROUP BY a.slug, a.name, a.base_url
    ORDER BY a.slug
  `)
  return res.rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    base_url: r.base_url == null ? null : String(r.base_url),
    workspace_ids: ((r.workspace_ids as unknown[]) ?? []).map(Number),
  }))
}

/**
 * One row of the app registry, by slug. No access check — this is the ADDRESS
 * BOOK (`platform.apps`), not a grant.
 *
 * Added 2026-08-10. `/api/meta` needs it to answer for the app SERVING the
 * request: `appsReachableByUser` derives its list from `platform.app_access`,
 * and an app that owns its own workspaces has no rows there, so a user of it
 * saw an empty `apps` object — including no entry for the app they were talking
 * to, and therefore no `base_url` for it. Reachability by grant is still what
 * lists OTHER apps (docs/platform-architecture.md §4.5: an agent must not
 * discover an app its user cannot reach); the current app is not a discovery,
 * it is the thing answering.
 */
export async function getAppRegistryEntry(
  db: Executor,
  slug: string
): Promise<{ slug: string; name: string; base_url: string | null } | null> {
  const res = await db.execute(sql`
    SELECT a.slug, a.name, a.base_url FROM ${apps} a
    WHERE a.slug = ${slug} AND a.enabled = true
    LIMIT 1
  `)
  const r = res.rows[0]
  if (!r) return null
  return {
    slug: String(r.slug),
    name: String(r.name),
    base_url: r.base_url == null ? null : String(r.base_url),
  }
}

/** Registry rows joined with this workspace's state, for the Apps settings screen. */
export async function listWorkspaceApps(
  db: Executor,
  workspaceId: number
): Promise<WorkspaceAppRow[]> {
  const res = await db.execute(sql`
    SELECT a.slug, a.name, a.description, a.base_url, a.enabled AS globally_enabled,
           wa.default_access, wa.enabled_at,
           (SELECT count(*) FROM ${appAccess} aa
             WHERE aa.workspace_id = ${workspaceId} AND aa.app = a.slug) AS access_count
    FROM ${apps} a
    LEFT JOIN ${workspaceApps} wa
      ON wa.app = a.slug AND wa.workspace_id = ${workspaceId}
    ORDER BY a.slug
  `)
  return res.rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    base_url: r.base_url == null ? null : String(r.base_url),
    globally_enabled: r.globally_enabled === true,
    enabled: r.default_access != null,
    default_access: (r.default_access as DefaultAccessMode | null) ?? null,
    enabled_at: r.enabled_at == null ? null : String(r.enabled_at),
    access_count: Number(r.access_count ?? 0),
  }))
}

/** Every member of the workspace, flagged with whether they hold access to `app`. */
export async function listAppAccessMembers(
  db: Executor,
  workspaceId: number,
  app: string
): Promise<AppAccessMemberRow[]> {
  const res = await db.execute(sql`
    SELECT m.user_id, m.role AS member_role,
           u.email, u.name, u.avatar_url,
           aa.granted_at
    FROM ${workspaceMembers} m
    JOIN ${users} u ON u.id = m.user_id
    LEFT JOIN ${appAccess} aa
      ON aa.workspace_id = m.workspace_id AND aa.user_id = m.user_id AND aa.app = ${app}
    WHERE m.workspace_id = ${workspaceId}
    ORDER BY m.joined_at
  `)
  return res.rows.map((r) => ({
    user_id: Number(r.user_id),
    email: String(r.email),
    name: r.name == null ? null : String(r.name),
    avatar_url: r.avatar_url == null ? null : String(r.avatar_url),
    member_role: String(r.member_role),
    has_access: r.granted_at != null,
    granted_at: r.granted_at == null ? null : String(r.granted_at),
  }))
}

/** Is `app` turned on for this workspace, and how does it grant? */
export async function getWorkspaceApp(
  db: Executor,
  workspaceId: number,
  app: string
): Promise<{ default_access: DefaultAccessMode } | null> {
  const res = await db.execute(sql`
    SELECT default_access FROM ${workspaceApps}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
    LIMIT 1
  `)
  const row = res.rows[0]
  return row ? { default_access: row.default_access as DefaultAccessMode } : null
}

/** Grant one user access to one app. Idempotent. */
export async function grantAppAccess(
  db: Executor,
  t: AppAccessTarget,
  opts: { role?: string; grantedBy?: number | null } = {}
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${appAccess} (workspace_id, app, user_id, role, granted_by)
    VALUES (${t.workspaceId}, ${t.app}, ${t.userId}, ${opts.role ?? 'member'}, ${opts.grantedBy ?? null})
    ON CONFLICT (workspace_id, app, user_id) DO NOTHING
  `)
}

/** Revoke one user's access to one app. Returns true if a row went away. */
export async function revokeAppAccess(db: Executor, t: AppAccessTarget): Promise<boolean> {
  const res = await db.execute(sql`
    DELETE FROM ${appAccess}
    WHERE workspace_id = ${t.workspaceId} AND app = ${t.app} AND user_id = ${t.userId}
    RETURNING user_id
  `)
  return res.rows.length > 0
}

/**
 * Grant a brand-new member whatever the workspace's apps hand out by default.
 *
 * MUST be called in the same transaction as the `workspace_members` insert. An
 * `invite_only` app is deliberately skipped — that is the whole point of the
 * mode — unless `alsoGrantApp` names it, which is how an invitation *into* one
 * app grants that app regardless.
 *
 * Returns the app slugs granted, so the caller can log or report them.
 */
export async function grantDefaultAppAccess(
  tx: Executor,
  args: {
    workspaceId: number
    userId: number
    role?: string
    grantedBy?: number | null
    alsoGrantApp?: string | null
  }
): Promise<string[]> {
  const res = await tx.execute(sql`
    INSERT INTO ${appAccess} (workspace_id, app, user_id, role, granted_by)
    SELECT wa.workspace_id, wa.app, ${args.userId}, ${args.role ?? 'member'}, ${args.grantedBy ?? null}
    FROM ${workspaceApps} wa
    JOIN ${apps} a ON a.slug = wa.app
    WHERE wa.workspace_id = ${args.workspaceId}
      AND a.enabled = true
      AND (wa.default_access = 'all_members' OR wa.app = ${args.alsoGrantApp ?? null})
    ON CONFLICT (workspace_id, app, user_id) DO NOTHING
    RETURNING app
  `)
  return res.rows.map((r) => String(r.app))
}

/**
 * Turn every globally-enabled app on for a brand-new workspace and grant its
 * creator access — the default-on policy of docs/platform-architecture.md §4.5.
 *
 * MUST run in the same transaction as the workspace + membership inserts. Note it
 * enables *every* enabled app rather than only the one being used: a workspace is
 * the company, and an org created from one app is still the same org in the next.
 */
export async function enableAllAppsForWorkspace(
  tx: Executor,
  args: { workspaceId: number; ownerId: number; enabledBy?: number | null }
): Promise<string[]> {
  const res = await tx.execute(sql`
    INSERT INTO ${workspaceApps} (workspace_id, app, enabled_by, default_access)
    SELECT ${args.workspaceId}, a.slug, ${args.enabledBy ?? null}, 'all_members'
    FROM ${apps} a
    WHERE a.enabled = true
    ON CONFLICT (workspace_id, app) DO NOTHING
    RETURNING app
  `)
  const enabled = res.rows.map((r) => String(r.app))
  await grantDefaultAppAccess(tx, {
    workspaceId: args.workspaceId,
    userId: args.ownerId,
    role: 'owner',
    grantedBy: args.enabledBy ?? null,
  })
  return enabled
}

/** Enable one app for one workspace (idempotent), granting per `defaultAccess`. */
export async function enableAppForWorkspace(
  tx: Executor,
  args: {
    workspaceId: number
    app: string
    enabledBy: number
    defaultAccess?: DefaultAccessMode
  }
): Promise<void> {
  const mode = args.defaultAccess ?? 'all_members'
  await tx.execute(sql`
    INSERT INTO ${workspaceApps} (workspace_id, app, enabled_by, default_access)
    VALUES (${args.workspaceId}, ${args.app}, ${args.enabledBy}, ${mode})
    ON CONFLICT (workspace_id, app)
      DO UPDATE SET default_access = ${mode}
  `)
  if (mode === 'all_members') {
    await backfillAppAccessForMembers(tx, args.workspaceId, args.app, args.enabledBy)
  }
}

/** Turn one app off for one workspace. The cascade takes its `app_access` rows. */
export async function disableAppForWorkspace(
  tx: Executor,
  workspaceId: number,
  app: string
): Promise<boolean> {
  // app_access has no FK to workspace_apps (its FK is to the membership row), so
  // the grants are removed explicitly here. Leaving them would make re-enabling
  // silently restore access an admin thought they had removed.
  await tx.execute(sql`
    DELETE FROM ${appAccess}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
  `)
  const res = await tx.execute(sql`
    DELETE FROM ${workspaceApps}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
    RETURNING app
  `)
  return res.rows.length > 0
}

/** Change how an app grants access, without touching existing grants. */
export async function setDefaultAccess(
  db: Executor,
  workspaceId: number,
  app: string,
  mode: DefaultAccessMode,
  actorUserId: number
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE ${workspaceApps} SET default_access = ${mode}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
    RETURNING app
  `)
  if (res.rows.length === 0) return false
  // Flipping TO all_members grants every current member — otherwise the mode
  // would only apply to people who join later, which is not what it says.
  if (mode === 'all_members') {
    await backfillAppAccessForMembers(db, workspaceId, app, actorUserId)
  }
  return true
}

/** Give every current member of the workspace access to `app`. Idempotent. */
export async function backfillAppAccessForMembers(
  db: Executor,
  workspaceId: number,
  app: string,
  grantedBy: number | null
): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO ${appAccess} (workspace_id, app, user_id, role, granted_by)
    SELECT m.workspace_id, ${app}, m.user_id, m.role, ${grantedBy}
    FROM ${workspaceMembers} m
    WHERE m.workspace_id = ${workspaceId}
    ON CONFLICT (workspace_id, app, user_id) DO NOTHING
    RETURNING user_id
  `)
  return res.rows.length
}

/**
 * Keep `app_access.role` in step with a changed `workspace_members.role`.
 *
 * Called from ownership transfer. Nothing enforces on this column yet, but a row
 * that says 'owner' for a demoted member is a trap for whoever first reads it.
 */
export async function syncAppAccessRole(
  tx: Executor,
  workspaceId: number,
  userId: number,
  role: string
): Promise<void> {
  await tx.execute(sql`
    UPDATE ${appAccess} SET role = ${role}
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `)
}

/**
 * Members with no `app_access` row for `app` — the orphan check from
 * the platform migration, Phase 4 step 3 (docs/2026-08-platform-migration.md), as code rather than a pasted query.
 *
 * READ THE WINDOW THIS IS VALID IN. Before enforcement it must return an empty
 * array: every existing member was granted by the backfill, so a row here is a
 * person about to be locked out. AFTER enforcement it is no longer a pass/fail
 * check — a member with no grant is exactly what `invite_only` and a deliberate
 * revoke produce, and both are intended. Past that point this is a *report* of
 * who lacks access, not a defect list.
 *
 * It proves the *data*, in that window. Only the tests on the two membership
 * INSERT sites can prove the *code*, because a path that creates membership
 * without access writes no orphan until somebody actually walks it.
 */
export async function findOrphanedMembers(
  db: Executor,
  app: string
): Promise<Array<{ workspace_id: number; user_id: number }>> {
  const res = await db.execute(sql`
    SELECT m.workspace_id, m.user_id
    FROM ${workspaceMembers} m
    JOIN ${workspaceApps} wa
      ON wa.workspace_id = m.workspace_id AND wa.app = ${app}
    LEFT JOIN ${appAccess} aa
      ON aa.workspace_id = m.workspace_id
     AND aa.user_id      = m.user_id
     AND aa.app          = ${app}
    WHERE aa.user_id IS NULL
    ORDER BY m.workspace_id, m.user_id
  `)
  return res.rows.map((r) => ({
    workspace_id: Number(r.workspace_id),
    user_id: Number(r.user_id),
  }))
}
