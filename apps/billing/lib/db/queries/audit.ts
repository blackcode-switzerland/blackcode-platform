// THE AUDIT LOG: the only writer, and the feed.
//
// ===========================================================================
// THE LOG IS THE EDIT WORKFLOW (invariant I7)
// ===========================================================================
// There is no separate history feature, no `updated_by` column anywhere in
// `billing.*`, and no "recent activity" table. Every write appends here **in the
// same transaction as the change**, so a change with no audit row is impossible
// rather than merely discouraged.
//
// `appendAudit` is the ONLY function that inserts into `billing.audit`. A second
// writer would be a second opinion about what an audit row means, and the value
// of the log is that it has exactly one.
//
// 0005's trigger and 0006's revoke make the table append-only at the database
// level: the app role holds INSERT and SELECT and nothing else. Rewriting a row
// is worse than deleting one — a deleted row leaves a gap in `seq` that both the
// unique index and a reader can notice, while an edited row leaves a plausible
// lie.
//
// ===========================================================================
// IT DOUBLES AS THIS APP'S EVENT FEED
// ===========================================================================
// `listAudit({ since })` returns rows ASCENDING from a cursor, which is how an
// outside system learns that a bill was sent or paid by somebody in a browser
// (`docs/billing-app-plan/integration-surface.md` §4).
//
// **Why a poller cannot miss a row.** `seq` comes from `allocateSeq`, whose
// upsert takes a row lock on the counter. A second writer blocks until the first
// commits or rolls back, so sequence order IS commit order — and therefore no row
// can be committed with a `seq` lower than one a poller has already passed.
//
// That property is the whole feed. If anybody ever replaces the counter upsert
// with something that does not serialise — a sequence, an advisory lock released
// early, a client-side max+1 — the feed silently starts dropping rows for
// pollers, with nothing to say so.

import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { billingAudit, users } from '../schema'
import { getDb } from '../client'
import { allocateSeq, type Tx } from './seq'
import type { ActorVia, AuditAction, AuditEntry } from '@/types'

export interface AppendAuditInput {
  workspaceId: number
  subjectType: 'invoice' | 'company' | 'recurrence'
  /** The subject's row `id`. Its `#number` is resolved at read time. */
  subjectId: number
  /** The subject's `#number`, carried so a read need not join the subject table. */
  subjectSeq: number
  actorUserId: number | null
  via: ActorVia
  action: AuditAction
  /** `items[2].unit_price`, `metadata.order_id`. Null for whole-record actions. */
  field?: string | null
  from?: string | null
  to?: string | null
  detailFr?: string | null
  detailEn?: string | null
}

/**
 * Append one row. **The only writer of `billing.audit`.**
 *
 * Takes a `Tx`, not a `db`, and that is the load-bearing part of the signature:
 * an audit row in a different transaction from the change it records is a row
 * that can be committed while the change rolls back, or the reverse. Requiring
 * the handle makes that a type error.
 */
export async function appendAudit(tx: Tx, input: AppendAuditInput): Promise<number> {
  const seq = await allocateSeq(tx, input.workspaceId, 'audit')
  await tx.insert(billingAudit).values({
    workspace_id: input.workspaceId,
    seq,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    actor_user_id: input.actorUserId,
    via: input.via,
    action: input.action,
    field: input.field ?? null,
    from_value: input.from ?? null,
    to_value: input.to ?? null,
    detail_fr: input.detailFr ?? null,
    detail_en: input.detailEn ?? null,
  })
  // `subjectSeq` is not stored: `subject_id` plus `subject_type` is the key, and
  // the #number is resolved on read. Carried in the input so a caller that
  // already has it can pass it for the detail lines, without this function
  // reaching back into the subject's table.
  void input.subjectSeq
  return seq
}

/**
 * Diff two records and append one row per changed field.
 *
 * ── ONE ROW PER FIELD, NOT ONE PER REQUEST ─────────────────────────────────
 * A PATCH that changes three fields produces three rows. That is what makes the
 * log answer "when did the due date move?" rather than only "somebody edited
 * this on Tuesday" — and it is the shape the mockup's audit panel renders.
 *
 * Paths are dotted and indexed the way the mockup writes them:
 * `items[2].unit_price`, `metadata.order_id`, `client.city`.
 *
 * Values are stringified for the log, because `from_value` and `to_value` are
 * `text`: the log is a record of what a person changed, read by people, and a
 * typed column per field type would be five columns nobody queries.
 */
export async function appendFieldChanges(
  tx: Tx,
  base: Omit<AppendAuditInput, 'action' | 'field' | 'from' | 'to'>,
  changes: Array<{ field: string; from: unknown; to: unknown }>
): Promise<void> {
  for (const c of changes) {
    await appendAudit(tx, {
      ...base,
      action: 'field_changed',
      field: c.field,
      from: stringifyValue(c.from),
      to: stringifyValue(c.to),
    })
  }
}

/**
 * `null` stays null — it is a real value in this log and means "was not set".
 * `"null"` the string would be indistinguishable from somebody typing it.
 */
function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export interface ListAuditOptions {
  /**
   * Return rows with `seq > since`, ASCENDING. The feed's cursor.
   *
   * Absent means "newest first", which is what a human panel wants. Present
   * means "oldest first from here", which is what a poller wants. The two
   * orderings are deliberate rather than a flag somebody forgot: reversing a
   * feed's order would make a poller re-read the same page forever.
   */
  since?: number
  subjectType?: 'invoice' | 'company' | 'recurrence'
  subjectId?: number
  limit?: number
}

/** One page of the log. `next_cursor` is the last `seq` returned, or null. */
export async function listAudit(
  workspaceId: number,
  opts: ListAuditOptions = {}
): Promise<{ data: AuditEntry[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const ascending = opts.since !== undefined

  const where = [eq(billingAudit.workspace_id, workspaceId)]
  if (opts.since !== undefined) where.push(gt(billingAudit.seq, opts.since))
  if (opts.subjectType) where.push(eq(billingAudit.subject_type, opts.subjectType))
  if (opts.subjectId !== undefined) where.push(eq(billingAudit.subject_id, opts.subjectId))

  const rows = await getDb()
    .select({
      seq: billingAudit.seq,
      subject_type: billingAudit.subject_type,
      subject_id: billingAudit.subject_id,
      ts: billingAudit.ts,
      actor_user_id: billingAudit.actor_user_id,
      actor_email: users.email,
      via: billingAudit.via,
      action: billingAudit.action,
      field: billingAudit.field,
      from_value: billingAudit.from_value,
      to_value: billingAudit.to_value,
      detail_fr: billingAudit.detail_fr,
      detail_en: billingAudit.detail_en,
    })
    .from(billingAudit)
    // LEFT, not inner: `actor_user_id` is `ON DELETE SET NULL`, so a closed
    // account leaves its audit rows in place with no actor. An inner join would
    // make those rows VANISH from the log, which is the one thing an append-only
    // log must never do.
    .leftJoin(users, eq(users.id, billingAudit.actor_user_id))
    .where(and(...where))
    .orderBy(ascending ? asc(billingAudit.seq) : desc(billingAudit.seq))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit
  return {
    data: page.map((r) => ({
      seq: r.seq,
      subject_type: r.subject_type as AuditEntry['subject_type'],
      // The subject's #number. `subject_id` IS the row id, and resolving it to a
      // #number per row would be one query per row; the shaping layer passes the
      // mapping in where it has one. Phase 1 serves the row id here and the
      // frontend addresses by it only within a subject it already has.
      subject_seq: r.subject_id,
      ts: r.ts.toISOString(),
      actor: {
        user_id: r.actor_user_id,
        email: r.actor_email,
        via: r.via as ActorVia,
      },
      action: r.action as AuditAction,
      field: r.field,
      from_value: r.from_value,
      to_value: r.to_value,
      detail_fr: r.detail_fr,
      detail_en: r.detail_en,
    })),
    next_cursor: hasMore ? String(page[page.length - 1]?.seq ?? '') : null,
  }
}

/** The highest `seq` in this workspace's log — the cursor a poller starts from. */
export async function auditHead(workspaceId: number): Promise<number> {
  const rows = await getDb()
    .select({ head: sql<number>`COALESCE(MAX(${billingAudit.seq}), 0)` })
    .from(billingAudit)
    .where(eq(billingAudit.workspace_id, workspaceId))
  return Number(rows[0]?.head ?? 0)
}
