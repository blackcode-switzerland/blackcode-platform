// `platform.links` — typed relations between two URNs, at the data layer.
//
// Links are DIRECTED and single-rowed: `A blocks B` is one row. `listLinks(B)`
// reports it as an incoming `blocks` from A. Writing an inverse row as well would
// create a second fact that can disagree with the first, and nothing would be
// responsible for keeping them equal.
//
// TENANT BOUNDARY. Both ends must be in the same workspace. This is checked here,
// in the data layer, and not only in the route: a link is the one structure in
// the platform that names two rows at once, so it is the one place where a
// cross-workspace reference could be created by accident and then read back by
// someone who should never have seen the other end's title.

import { sql } from 'drizzle-orm'
import { entities, links, users } from './schema'
import type { Executor } from './client'

export interface LinkTarget {
  fromUrn: string
  toUrn: string
  rel: string
}

/** One link, with the entity at the *other* end already resolved. */
export interface LinkRow {
  /** 'out' — this urn is the from side. 'in' — it is the to side. */
  direction: 'out' | 'in'
  rel: string
  from_urn: string
  to_urn: string
  /** The end that is NOT the urn asked about. */
  other_urn: string
  other_app: string
  other_entity_type: string
  other_number: number
  other_title: string
  other_url: string | null
  other_deleted: boolean
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

export type CreateLinkResult =
  | { ok: true; created: boolean }
  // The urn is well-formed but nothing is projected under it. For an entity in
  // this app that means it does not exist; for another app's urn it can also mean
  // that app has not written its projection yet.
  | { ok: false; reason: 'unknown_urn'; urn: string }
  | { ok: false; reason: 'cross_workspace' }
  | { ok: false; reason: 'self_link' }

/**
 * Create a link. Idempotent — the same (from, to, rel) twice is not an error.
 *
 * Both ends are resolved first rather than letting the foreign keys reject the
 * insert, because "which end was missing" is the only useful thing to tell the
 * caller, and a 23503 does not carry it.
 */
export async function createLink(
  db: Executor,
  t: LinkTarget & { createdBy?: number | null }
): Promise<CreateLinkResult> {
  if (t.fromUrn === t.toUrn) return { ok: false, reason: 'self_link' }
  const res = await db.execute(sql`
    SELECT urn, workspace_id FROM ${entities} WHERE urn IN (${t.fromUrn}, ${t.toUrn})
  `)
  const found = new Map(res.rows.map((r) => [String(r.urn), Number(r.workspace_id)]))
  if (!found.has(t.fromUrn)) return { ok: false, reason: 'unknown_urn', urn: t.fromUrn }
  if (!found.has(t.toUrn)) return { ok: false, reason: 'unknown_urn', urn: t.toUrn }
  if (found.get(t.fromUrn) !== found.get(t.toUrn)) return { ok: false, reason: 'cross_workspace' }

  const ins = await db.execute(sql`
    INSERT INTO ${links} (from_urn, to_urn, rel, created_by)
    VALUES (${t.fromUrn}, ${t.toUrn}, ${t.rel}, ${t.createdBy ?? null})
    ON CONFLICT (from_urn, to_urn, rel) DO NOTHING
    RETURNING rel
  `)
  return { ok: true, created: ins.rows.length > 0 }
}

/** Remove one link. Returns false if there was nothing to remove. */
export async function deleteLink(db: Executor, t: LinkTarget): Promise<boolean> {
  const res = await db.execute(sql`
    DELETE FROM ${links}
    WHERE from_urn = ${t.fromUrn} AND to_urn = ${t.toUrn} AND rel = ${t.rel}
    RETURNING rel
  `)
  return res.rows.length > 0
}

function toLinkRow(r: Record<string, unknown>): LinkRow {
  return {
    direction: String(r.direction) === 'out' ? 'out' : 'in',
    rel: String(r.rel),
    from_urn: String(r.from_urn),
    to_urn: String(r.to_urn),
    other_urn: String(r.other_urn),
    other_app: String(r.other_app),
    other_entity_type: String(r.other_entity_type),
    other_number: Number(r.other_number),
    other_title: String(r.other_title),
    other_url: r.other_url == null ? null : String(r.other_url),
    other_deleted: r.other_deleted != null,
    created_by: r.created_by == null ? null : Number(r.created_by),
    created_by_name: r.created_by_name == null ? null : String(r.created_by_name),
    created_at: String(r.created_at),
  }
}

/**
 * Every link touching `urn`, in both directions, with the far end resolved.
 *
 * Soft-deleted far ends are included and flagged rather than hidden: an issue
 * that blocks something now sitting in the recycle bin is exactly the situation
 * a caller needs to be told about.
 */
export async function listLinks(db: Executor, urn: string): Promise<LinkRow[]> {
  const res = await db.execute(sql`
    SELECT 'out' AS direction, l.rel, l.from_urn, l.to_urn, l.created_by, l.created_at,
           e.urn AS other_urn, e.app AS other_app, e.entity_type AS other_entity_type,
           e.number AS other_number, e.title AS other_title, e.url AS other_url,
           e.deleted_at AS other_deleted, u.name AS created_by_name
    FROM ${links} l
    JOIN ${entities} e ON e.urn = l.to_urn
    LEFT JOIN ${users} u ON u.id = l.created_by
    WHERE l.from_urn = ${urn}
    UNION ALL
    SELECT 'in' AS direction, l.rel, l.from_urn, l.to_urn, l.created_by, l.created_at,
           e.urn AS other_urn, e.app AS other_app, e.entity_type AS other_entity_type,
           e.number AS other_number, e.title AS other_title, e.url AS other_url,
           e.deleted_at AS other_deleted, u.name AS created_by_name
    FROM ${links} l
    JOIN ${entities} e ON e.urn = l.from_urn
    LEFT JOIN ${users} u ON u.id = l.created_by
    WHERE l.to_urn = ${urn}
    ORDER BY created_at DESC
  `)
  return res.rows.map(toLinkRow)
}

/** How many links touch each of these URNs — used to badge list output. */
export async function countLinksFor(db: Executor, urns: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (urns.length === 0) return out
  const list = sql.join(
    urns.map((u) => sql`${u}`),
    sql`, `
  )
  const res = await db.execute(sql`
    SELECT urn, count(*)::int AS n FROM (
      SELECT from_urn AS urn FROM ${links} WHERE from_urn IN (${list})
      UNION ALL
      SELECT to_urn AS urn FROM ${links} WHERE to_urn IN (${list})
    ) t
    GROUP BY urn
  `)
  for (const r of res.rows) out.set(String(r.urn), Number(r.n))
  return out
}
