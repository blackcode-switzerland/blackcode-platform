// Labels — `bk sales label list | view | create | edit | delete | attach | detach`.
//
// ---------------------------------------------------------------------------
// THE TABLE IS THIS APP'S, AND THAT IS WHAT REPLACED THE SCOPE (Phase 3)
// ---------------------------------------------------------------------------
// A label used to live in `platform.labels`, one table serving both apps, with
// an `app` column and a predicate — `app IS NULL OR app = 'sales'` — threaded
// through every read and every write. That predicate is D-14's workaround for a
// shared table, and it was real protection there: a read that forgot it returned
// the issues app's labels while `bk sales label list` promised otherwise.
//
// It lives in `sales.labels` now, and **the helper that carried the predicate is
// deleted rather than ported**. Over a table that cannot hold another app's row
// it is a no-op that reads as protection, which is CLAUDE.md's entire subject.
// The scope is the schema, and `sales.prospect_salesLabels.label_id` has a foreign
// key into `sales.labels` (migration 0005) so an attachment cannot name a
// foreign label either — enforced by Postgres rather than by a WHERE clause
// somebody has to remember.
//
// ---------------------------------------------------------------------------
// AND WHY THIS IS NOT A SHARED FACTORY
// ---------------------------------------------------------------------------
// `attach`/`detach` name an ENTITY, and an entity belongs to one app —
// `internal/appverbs/appverbs.go` makes the same split on the CLI side, keeping
// `bk issues label attach` in the issues package for exactly this reason. The
// CRUD half could be shared one day; the attach half cannot, and splitting one
// noun across two layers to share three functions is not a trade worth making
// while there are two apps.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { salesLabels, prospectLabels, prospects } from '../schema'
import type { SalesLabel } from '../schema'
import { recordEvent } from './events'
import { LABELS_PER_PROSPECT_MAX } from '@/lib/limits'
import type { Actor } from '@/lib/actor'

export interface LabelRow extends SalesLabel {
  /** How many of THIS app's prospects carry it. */
  usage: number
}

export async function listLabels(workspaceId: number): Promise<LabelRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(salesLabels)
    .where(eq(salesLabels.workspace_id, workspaceId))
    .orderBy(asc(salesLabels.name))
  if (rows.length === 0) return []

  const counts = await db
    .select({ label_id: prospectLabels.label_id, n: sql<number>`count(*)::int` })
    .from(prospectLabels)
    .innerJoin(prospects, eq(prospects.id, prospectLabels.prospect_id))
    .where(
      and(
        inArray(
          prospectLabels.label_id,
          rows.map((r) => r.id)
        ),
        eq(prospects.workspace_id, workspaceId),
        isNull(prospects.deleted_at)
      )
    )
    .groupBy(prospectLabels.label_id)
  const used = new Map(counts.map((c) => [c.label_id, Number(c.n)]))
  return rows.map((r) => ({ ...r, usage: used.get(r.id) ?? 0 }))
}

export async function getLabel(workspaceId: number, labelId: number): Promise<LabelRow | null> {
  const all = await listLabels(workspaceId)
  return all.find((l) => l.id === labelId) ?? null
}

export async function createLabel(
  workspaceId: number,
  input: { name: string; color?: string | null; description?: string | null },
  actor: Actor
): Promise<SalesLabel> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(salesLabels)
      .values({
        workspace_id: workspaceId,
        name: input.name,
        color: input.color ?? undefined,
        description: input.description ?? null,
        // No `app` column to set. D-29's "a label is scoped on creation and
        // sharing is a deliberate act" was a rule about a shared table; here
        // every row is this app's and there is nothing to declare.
        created_by: actor.userId,
      })
      .returning()
    if (!row) throw new Error('label insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name },
      // A label is not a projected entity; it has no cross-app address.
      subjectUrn: null,
    })
    return row
  })
}

export async function updateLabel(
  workspaceId: number,
  labelId: number,
  input: { name?: string; color?: string | null; description?: string | null },
  actor: Actor
): Promise<SalesLabel | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = {}
    if (input.name !== undefined) values.name = input.name
    if (input.color !== undefined) values.color = input.color
    if (input.description !== undefined) values.description = input.description
    if (Object.keys(values).length === 0) return null

    const [row] = await tx
      .update(salesLabels)
      .set(values)
      // The scope is in the WHERE, not checked afterwards: an issues label must
      // not be renameable from here, and a guard that reads then writes has a
      // window between the two.
      .where(and(eq(salesLabels.id, labelId), eq(salesLabels.workspace_id, workspaceId)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name },
      subjectUrn: null,
    })
    return row
  })
}

export async function deleteLabel(
  workspaceId: number,
  labelId: number,
  actor: Actor
): Promise<SalesLabel | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(salesLabels)
      .where(and(eq(salesLabels.id, labelId), eq(salesLabels.workspace_id, workspaceId)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'purged',
      meta: { name: row.name },
      subjectUrn: null,
    })
    return row
  })
}

export type AttachResult =
  | { ok: true; attached: boolean; label: SalesLabel }
  | { ok: false; reason: 'label_not_found' }
  | { ok: false; reason: 'too_many'; max: number }

/** Attach a label to a prospect. Idempotent — attaching twice is one state. */
export async function attachLabel(
  workspaceId: number,
  prospectId: number,
  labelId: number,
  actor: Actor
): Promise<AttachResult> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [label] = await tx
      .select()
      .from(salesLabels)
      .where(and(eq(salesLabels.id, labelId), eq(salesLabels.workspace_id, workspaceId)))
      .limit(1)
    // A 404 rather than a silent no-op: attaching an issues label to a prospect
    // is the exact mistake `salesLabels.app` exists to prevent, and it has to be
    // visible to the caller who tried.
    if (!label) return { ok: false, reason: 'label_not_found' } as const

    const current = await tx
      .select({ label_id: prospectLabels.label_id })
      .from(prospectLabels)
      .where(eq(prospectLabels.prospect_id, prospectId))
    if (current.some((c) => c.label_id === labelId)) {
      return { ok: true, attached: false, label } as const
    }
    if (current.length >= LABELS_PER_PROSPECT_MAX) {
      return { ok: false, reason: 'too_many', max: LABELS_PER_PROSPECT_MAX } as const
    }

    await tx
      .insert(prospectLabels)
      .values({ prospect_id: prospectId, label_id: labelId })
      .onConflictDoNothing()
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: prospectId,
      action: 'labeled',
      meta: { label: label.name },
    })
    return { ok: true, attached: true, label } as const
  })
}

export async function detachLabel(
  workspaceId: number,
  prospectId: number,
  labelId: number,
  actor: Actor
): Promise<boolean> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const removed = await tx
      .delete(prospectLabels)
      .where(
        and(eq(prospectLabels.prospect_id, prospectId), eq(prospectLabels.label_id, labelId))
      )
      .returning({ label_id: prospectLabels.label_id })
    if (removed.length === 0) return false
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: prospectId,
      action: 'unlabeled',
      meta: { label_id: labelId },
    })
    return true
  })
}
