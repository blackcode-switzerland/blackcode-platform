// The `platform.entities` projection, at the data layer.
//
// READ THIS BEFORE ADDING A WRITE PATH.
//
// Every function that writes takes an `Executor` and never opens a transaction of
// its own. That is the whole safety property of this phase: the entities row is
// written by the caller's transaction, so a source write that rolls back takes
// its projection row with it. A helper that opened `db.transaction()` internally
// would commit independently, and the projection would gain a row for an issue
// that does not exist — the exact silent drift Phase 6 exists to prevent.
//
// Nothing here knows an app's URL scheme, and it must not learn one. `path` is
// supplied by the app (see `entityPath` in apps/issues/lib/db/queries/entities.ts);
// platform only knows how to glue it to the app's registered `base_url`.
//
// Raw SQL with interpolated Drizzle table objects throughout, matching the
// standard set in Phase 3: `${entities}` is schema-qualified and type-checked,
// `'platform.entities'` is a string that fails in production.

import { sql } from 'drizzle-orm'
import { apps, entities, workspaces } from './schema'
import type { Executor } from './client'
import { formatUrn } from './urn'

/** The natural key — the stable identity of a projected entity. */
export interface EntityKey {
  app: string
  workspaceId: number
  entityType: string
  /** The workspace #number, never the row id. */
  number: number
}

export interface EntityContext {
  workspaceSlug: string
  /** Where the app is deployed, or null if the registry has no base_url yet. */
  baseUrl: string | null
}

export interface UpsertEntityInput extends EntityKey, EntityContext {
  title: string
  /** App-relative path to the thing, e.g. `/dashboard/kali-sa/issues/482`. */
  path: string
  /** Mirrors the source row's soft delete. */
  deletedAt?: Date | null
}

/** A projected entity as read back out. */
export interface EntityRow {
  urn: string
  app: string
  workspace_id: number
  entity_type: string
  number: number
  title: string
  url: string | null
  updated_at: string
  deleted_at: string | null
}

/**
 * Resolve what a URN needs that the caller does not have: the workspace slug and
 * the app's base_url.
 *
 * Deriving the slug here rather than threading it through every query signature
 * is deliberate. A `workspaceId` is what the whole query layer already carries;
 * adding a `workspaceSlug` parameter to a dozen functions is a dozen chances to
 * pass the wrong one, and the failure would be a URN pointing at another
 * workspace. One lookup, in the transaction, cannot be got wrong.
 *
 * Returns null only if the workspace does not exist, which inside the
 * transaction that just wrote a row to it cannot happen.
 */
export async function getEntityContext(
  tx: Executor,
  app: string,
  workspaceId: number
): Promise<EntityContext | null> {
  const res = await tx.execute(sql`
    SELECT w.slug, a.base_url
    FROM ${workspaces} w
    LEFT JOIN ${apps} a ON a.slug = ${app}
    WHERE w.id = ${workspaceId}
    LIMIT 1
  `)
  const row = res.rows[0]
  if (!row) return null
  return {
    workspaceSlug: String(row.slug),
    baseUrl: row.base_url == null ? null : String(row.base_url),
  }
}

/** Glue an app-relative path onto its registered base_url, if there is one. */
export function absoluteUrl(baseUrl: string | null, path: string): string {
  if (!baseUrl) return path
  return baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path)
}

/**
 * Write (or rewrite) one entity's projection row. Idempotent.
 *
 * Conflicts on the NATURAL key, not the urn, and overwrites the urn from it. That
 * is what makes a workspace rename a rewrite of the existing row rather than a
 * duplicate: `(workspace_id, app, entity_type, number)` is stable across renames,
 * the urn is not.
 */
export async function upsertEntity(tx: Executor, input: UpsertEntityInput): Promise<string> {
  const urn = formatUrn({
    app: input.app,
    workspaceSlug: input.workspaceSlug,
    entityType: input.entityType,
    number: input.number,
  })
  await tx.execute(sql`
    INSERT INTO ${entities}
      (urn, app, workspace_id, entity_type, number, title, url, updated_at, deleted_at)
    VALUES (
      ${urn}, ${input.app}, ${input.workspaceId}, ${input.entityType}, ${input.number},
      ${input.title}, ${absoluteUrl(input.baseUrl, input.path)}, now(), ${input.deletedAt ?? null}
    )
    ON CONFLICT (workspace_id, app, entity_type, number) DO UPDATE SET
      urn        = EXCLUDED.urn,
      title      = EXCLUDED.title,
      url        = EXCLUDED.url,
      updated_at = now(),
      deleted_at = EXCLUDED.deleted_at
  `)
  return urn
}

/**
 * Mirror a soft delete (or a restore, with `deletedAt: null`).
 *
 * The row is NOT removed: a link to something sitting in the recycle bin must
 * still resolve, and must still be there when the item is restored. Only a purge
 * removes the row — see `purgeEntity`.
 */
export async function setEntityDeletedAt(
  tx: Executor,
  key: EntityKey,
  deletedAt: Date | null
): Promise<void> {
  await tx.execute(sql`
    UPDATE ${entities}
    SET deleted_at = ${deletedAt}, updated_at = now()
    WHERE workspace_id = ${key.workspaceId}
      AND app = ${key.app}
      AND entity_type = ${key.entityType}
      AND number = ${key.number}
  `)
}

/**
 * Remove the projection row for a hard-deleted source row.
 *
 * Its links go with it, by cascade. That is the intended reading: a link to a
 * thing that no longer exists anywhere is not a relation, it is a dangling
 * pointer, and keeping it would make `bk link list` report rows that resolve to
 * nothing.
 */
export async function purgeEntity(tx: Executor, key: EntityKey): Promise<void> {
  await tx.execute(sql`
    DELETE FROM ${entities}
    WHERE workspace_id = ${key.workspaceId}
      AND app = ${key.app}
      AND entity_type = ${key.entityType}
      AND number = ${key.number}
  `)
}

/**
 * Rewrite every URN in a workspace after its slug changed.
 *
 * Must run in the same transaction as the `workspaces.slug` update. Links follow
 * automatically — their foreign keys are ON UPDATE CASCADE — which is why "a
 * link survives a rename" is a property of the schema and not of anyone
 * remembering to call something.
 *
 * `url` is rewritten too: it embeds the slug the same way the urn does. The
 * replace is anchored on the OLD slug's path segment so a slug appearing
 * elsewhere in the URL is left alone.
 */
export async function renameWorkspaceEntities(
  tx: Executor,
  workspaceId: number,
  oldSlug: string,
  newSlug: string
): Promise<number> {
  if (oldSlug === newSlug) return 0
  const res = await tx.execute(sql`
    UPDATE ${entities}
    SET urn = 'bc:' || app || ':' || ${newSlug} || '/' || entity_type || '/' || number,
        url = CASE
                WHEN url IS NULL THEN NULL
                ELSE replace(url, '/' || ${oldSlug} || '/', '/' || ${newSlug} || '/')
              END,
        updated_at = now()
    WHERE workspace_id = ${workspaceId}
    RETURNING urn
  `)
  return res.rows.length
}

// ---------- reads ----------

function toEntityRow(r: Record<string, unknown>): EntityRow {
  return {
    urn: String(r.urn),
    app: String(r.app),
    workspace_id: Number(r.workspace_id),
    entity_type: String(r.entity_type),
    number: Number(r.number),
    title: String(r.title),
    url: r.url == null ? null : String(r.url),
    updated_at: String(r.updated_at),
    deleted_at: r.deleted_at == null ? null : String(r.deleted_at),
  }
}

/** Fetch entities by URN, in one round trip. Unknown URNs are simply absent. */
export async function getEntitiesByUrns(db: Executor, urns: string[]): Promise<EntityRow[]> {
  if (urns.length === 0) return []
  const res = await db.execute(sql`
    SELECT * FROM ${entities} WHERE urn IN (${sql.join(
      urns.map((u) => sql`${u}`),
      sql`, `
    )})
  `)
  return res.rows.map(toEntityRow)
}

export interface SearchEntitiesOptions {
  workspaceId: number
  /** Free text, matched case-insensitively against the title. */
  query: string
  /** Restrict to these app slugs. Empty/undefined = every app the caller can see. */
  apps?: string[]
  /** Restrict to these entity types. */
  entityTypes?: string[]
  /** Include soft-deleted (binned) entities. Default false. */
  includeDeleted?: boolean
  limit?: number
}

/**
 * Federated search across every app's entities in one workspace.
 *
 * The point of this function is what it does NOT do: it never touches an app's
 * schema. `issues.issues` is unreadable to a future sales role, and vice versa —
 * so a query that spanned both would be impossible as a database grant, not just
 * awkward. Searching the projection is what makes `bk search` a single query
 * instead of a fan-out an agent has to assemble.
 *
 * A bare number (or `#482`) also matches the entity number, mirroring what the
 * in-app list search already does with `?search=`.
 */
export async function searchEntities(
  db: Executor,
  opts: SearchEntitiesOptions
): Promise<EntityRow[]> {
  const q = opts.query.trim()
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200)
  const like = `%${q}%`
  const asNumber = /^#?\d+$/.test(q) ? Number(q.replace(/^#/, '')) : null

  const match =
    asNumber === null
      ? sql`e.title ILIKE ${like}`
      : sql`(e.title ILIKE ${like} OR e.number = ${asNumber})`

  const appFilter =
    opts.apps && opts.apps.length > 0
      ? sql` AND e.app IN (${sql.join(
          opts.apps.map((a) => sql`${a}`),
          sql`, `
        )})`
      : sql``
  const typeFilter =
    opts.entityTypes && opts.entityTypes.length > 0
      ? sql` AND e.entity_type IN (${sql.join(
          opts.entityTypes.map((t) => sql`${t}`),
          sql`, `
        )})`
      : sql``
  const deletedFilter = opts.includeDeleted ? sql`` : sql` AND e.deleted_at IS NULL`

  const res = await db.execute(sql`
    SELECT e.* FROM ${entities} e
    WHERE e.workspace_id = ${opts.workspaceId}
      AND ${match}${appFilter}${typeFilter}${deletedFilter}
    ORDER BY e.updated_at DESC
    LIMIT ${limit}
  `)
  return res.rows.map(toEntityRow)
}

/** Every projected entity for one app in one workspace — the reconciler's input. */
export async function listProjectedEntities(
  db: Executor,
  workspaceId: number,
  app: string
): Promise<EntityRow[]> {
  const res = await db.execute(sql`
    SELECT * FROM ${entities}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
    ORDER BY entity_type, number
  `)
  return res.rows.map(toEntityRow)
}

/** How many entities are projected, per type — the cheap half of a drift check. */
export async function countProjectedEntities(
  db: Executor,
  workspaceId: number,
  app: string
): Promise<Record<string, number>> {
  const res = await db.execute(sql`
    SELECT entity_type, count(*)::int AS n
    FROM ${entities}
    WHERE workspace_id = ${workspaceId} AND app = ${app}
    GROUP BY entity_type
  `)
  const out: Record<string, number> = {}
  for (const r of res.rows) out[String(r.entity_type)] = Number(r.n)
  return out
}
