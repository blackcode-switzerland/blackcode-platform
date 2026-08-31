// Prospects — the read and write paths behind `bk sales prospect …`.
//
// A prospect IS the deal (D-5), so this is the core object of the app: the
// company, the pipeline stage, the value, the owner and what we owe them next,
// in one row.
//
// ---------------------------------------------------------------------------
// EVERY WRITE OWES THREE THINGS, IN ONE TRANSACTION
// ---------------------------------------------------------------------------
//   allocateSeq     the #number, for a create        lib/db/queries/counters.ts
//   recordEvent     the activity spine               lib/db/queries/events.ts
//   projectEntity   the cross-app URN                lib/db/queries/entities.ts
//
// All three take a transaction handle and none of them opens one, so the
// enclosing `db.transaction()` is what makes them atomic with the row they
// describe. A projection written outside it commits even when the source write
// rolls back, and the result is a `bk search` hit that 404s weeks later —
// `entities.integration.test.ts` asserts that case directly.
//
// ---------------------------------------------------------------------------
// `seq`, NEVER `id`
// ---------------------------------------------------------------------------
// Every function here is addressed by the workspace #number. The serial `id`
// stays inside this file and the two it calls: once a row id reaches an agent it
// ends up in a script, and then it is a contract nobody agreed to.

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../client'
import {
  communications,
  contacts,
  salesLabels,
  meetings,
  prospectLabels,
  prospects,
  stageEntries,
  strategies,
  users,
} from '../schema'
import type { Prospect } from '../schema'
import { allocateSeq } from './counters'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

/** A label as this app hands it out. */
export interface ProspectLabel {
  id: number
  name: string
  color: string | null
}

/** The deal owner, or whoever wrote a line of history. */
export interface ActorRef {
  id: number | null
  name: string | null
  email: string | null
}

/** One prospect, joined with the two things every listing shows beside it. */
export interface ProspectRow extends Prospect {
  owner: ActorRef | null
  labels: ProspectLabel[]
  /**
   * The linked strategy's #NUMBER, resolved from `strategy_id` (migration 0010).
   *
   * `strategy_id` is a serial and must never leave this app — `lib/views.ts`'s
   * first rule. Resolving it here rather than in the view is what makes that
   * enforceable: the view has no database, so a serial reaching it would have
   * nowhere to be turned into an address and would get served.
   */
  strategy_seq: number | null
  strategy_name: string | null
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListProspectsFilter {
  workspaceId: number
  /** One or more pipeline stages. Validated by the route against `STAGES`. */
  stages?: string[]
  /** Deal owner, by `platform.users.id`. Resolved from an email by the route. */
  ownerUserId?: number
  /** The linked strategy, by `sales.strategies.id`. Resolved from its #number
   *  by the route's `resolveStrategy()` — never a serial on the wire. */
  strategyId?: number
  /** Label NAME, matched case-insensitively — an agent has the name, not the id. */
  label?: string
  /** Substring match over the company name. `bk sales search` is the full-text one. */
  q?: string
  /** Include soft-deleted rows. Off by default; the bin is `bk sales trash`. */
  includeDeleted?: boolean
  limit?: number
  /** Opaque cursor: the `seq` of the last row of the previous page. */
  cursor?: number | null
}

export interface ProspectsPage {
  data: ProspectRow[]
  next_cursor: number | null
}

/**
 * List prospects, newest activity first.
 *
 * Ordered by `updated_at DESC` — the mockup's pipeline reads as "what moved" —
 * with `seq DESC` as the tiebreaker so the order is total and a cursor cannot
 * skip or repeat a row when two prospects share a timestamp to the microsecond.
 */
export async function listProspects(filter: ListProspectsFilter): Promise<ProspectsPage> {
  const db = getDb()
  const limit = Math.min(Math.max(filter.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX)

  const where: SQL[] = [eq(prospects.workspace_id, filter.workspaceId)]
  if (!filter.includeDeleted) where.push(isNull(prospects.deleted_at))
  if (filter.stages?.length) where.push(inArray(prospects.stage, filter.stages))
  if (filter.ownerUserId != null) where.push(eq(prospects.owner_user_id, filter.ownerUserId))
  if (filter.strategyId != null) where.push(eq(prospects.strategy_id, filter.strategyId))
  if (filter.q?.trim()) where.push(ilike(prospects.name, `%${filter.q.trim()}%`))
  if (filter.cursor != null) where.push(sql`${prospects.seq} < ${filter.cursor}`)
  if (filter.label?.trim()) {
    // No app scope in this predicate any more, and its absence is the Phase 3
    // change: `sales.prospect_labels.label_id` has a foreign key into
    // `sales.labels`, so there is no foreign row for a scope to exclude.
    where.push(sql`EXISTS (
      SELECT 1 FROM ${prospectLabels} pl
      JOIN ${salesLabels} l ON l.id = pl.label_id
      WHERE pl.prospect_id = ${prospects.id}
        AND lower(l.name) = lower(${filter.label.trim()})
    )`)
  }

  // limit + 1: one row past the page tells us whether there IS a next page
  // without a second COUNT query, and it is dropped before the caller sees it.
  const rows = await db
    .select()
    .from(prospects)
    .where(and(...where))
    .orderBy(desc(prospects.updated_at), desc(prospects.seq))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const next = rows.length > limit ? (page[page.length - 1]?.seq ?? null) : null

  return { data: await decorate(page), next_cursor: next }
}

/** One prospect by #number, or null. Soft-deleted rows are returned. */
export async function getProspectBySeq(
  workspaceId: number,
  seq: number
): Promise<ProspectRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
    .limit(1)
  if (!row) return null
  const [decorated] = await decorate([row])
  return decorated ?? null
}

/** One prospect's journey — the deal ladder, oldest step first. */
export async function listJourney(prospectId: number) {
  const db = getDb()
  return await db
    .select()
    .from(stageEntries)
    .where(eq(stageEntries.prospect_id, prospectId))
    .orderBy(asc(stageEntries.occurred_at), asc(stageEntries.id))
}

/**
 * Attach owners and labels to a page of prospects.
 *
 * Two queries for the whole page rather than two per row: a listing of 50 would
 * otherwise be 101 round trips, and the shape that produces that is invisible
 * until the page is big.
 */
async function decorate(rows: Prospect[]): Promise<ProspectRow[]> {
  if (rows.length === 0) return []
  const db = getDb()

  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter((v): v is number => v != null))]
  const owners = new Map<number, ActorRef>()
  if (ownerIds.length) {
    const found = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds))
    for (const u of found) owners.set(u.id, u)
  }

  // The linked strategy, by #number. One query for the page, like the two
  // above — a per-row lookup here would make a 50-prospect listing 51 more
  // round trips, which is invisible until the workspace is big.
  const strategyIds = [
    ...new Set(rows.map((r) => r.strategy_id).filter((v): v is number => v != null)),
  ]
  const strategyBySerial = new Map<number, { seq: number; name: string }>()
  if (strategyIds.length) {
    const found = await db
      .select({ id: strategies.id, seq: strategies.seq, name: strategies.name })
      .from(strategies)
      .where(inArray(strategies.id, strategyIds))
    for (const g of found) strategyBySerial.set(g.id, { seq: g.seq, name: g.name })
  }

  const ids = rows.map((r) => r.id)
  const attached = await db
    .select({
      prospect_id: prospectLabels.prospect_id,
      id: salesLabels.id,
      name: salesLabels.name,
      color: salesLabels.color,
    })
    .from(prospectLabels)
    .innerJoin(salesLabels, eq(salesLabels.id, prospectLabels.label_id))
    .where(inArray(prospectLabels.prospect_id, ids))
  const byProspect = new Map<number, ProspectLabel[]>()
  for (const l of attached) {
    const list = byProspect.get(l.prospect_id) ?? []
    list.push({ id: l.id, name: l.name, color: l.color })
    byProspect.set(l.prospect_id, list)
  }

  return rows.map((r) => {
    const strategy = r.strategy_id != null ? strategyBySerial.get(r.strategy_id) : undefined
    return {
      ...r,
      owner: r.owner_user_id != null ? (owners.get(r.owner_user_id) ?? null) : null,
      labels: byProspect.get(r.id) ?? [],
      strategy_seq: strategy?.seq ?? null,
      strategy_name: strategy?.name ?? null,
    }
  })
}

/** `platform.users.id` for an email, or null. Used to resolve `--owner`. */
export async function findUserIdByEmail(email: string): Promise<number | null> {
  const db = getDb()
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateProspectInput {
  workspaceId: number
  actor: Actor
  name: string
  city?: string | null
  sector?: string | null
  stage?: string
  value?: string | null
  currency?: string
  ownerUserId?: number | null
  source?: string | null
  summary?: string | null
  /** Migration 0008 — the identity card (#34). */
  website?: string | null
  address?: string | null
  /** Migration 0010 — the segment this belongs to (#37) and the per-prospect
   *  angle on top of it (#35). `strategyId: null` clears the link. */
  strategyId?: number | null
  gamePlan?: string | null
}

/**
 * Create a prospect and its first journey step.
 *
 * The journey row is not decoration. `sales.stage_entries` is the deal ladder
 * the detail page renders, and a prospect created without its opening step shows
 * an empty history for a deal that demonstrably started — so it is written here,
 * in the same transaction, rather than left for the first `prospect stage` call
 * that may never come.
 */
export async function createProspect(input: CreateProspectInput): Promise<ProspectRow> {
  const db = getDb()
  const stage = input.stage ?? 'new_lead'

  const created = await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, input.workspaceId, 'prospect')
    const [row] = await tx
      .insert(prospects)
      .values({
        workspace_id: input.workspaceId,
        seq,
        name: input.name,
        city: input.city ?? null,
        sector: input.sector ?? null,
        stage,
        value: input.value ?? null,
        currency: input.currency ?? 'CHF',
        owner_user_id: input.ownerUserId ?? null,
        source: input.source ?? null,
        summary: input.summary ?? null,
        website: input.website ?? null,
        address: input.address ?? null,
        strategy_id: input.strategyId ?? null,
        game_plan: input.gamePlan ?? null,
        created_by: input.actor.userId,
      })
      .returning()
    if (!row) throw new Error('prospect insert returned nothing')

    await tx.insert(stageEntries).values({
      workspace_id: input.workspaceId,
      prospect_id: row.id,
      stage,
      status: 'current',
      occurred_at: new Date(),
      actor_user_id: input.actor.userId,
      actor_label: input.actor.label,
    })

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actor.userId,
      actorTokenId: input.actor.tokenId,
      entityType: 'prospect',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name, stage: row.stage },
    })
    return row
  })

  const [decorated] = await decorate([created])
  if (!decorated) throw new Error('prospect vanished between insert and read')
  return decorated
}

/** The fields `bk sales prospect edit` and `… assign` may change. */
export interface UpdateProspectInput {
  name?: string
  city?: string | null
  sector?: string | null
  value?: string | null
  currency?: string
  ownerUserId?: number | null
  source?: string | null
  summary?: string | null
  /** Migration 0008 — the identity card (#34). */
  website?: string | null
  address?: string | null
  /** Migration 0010 — the segment this belongs to (#37) and the per-prospect
   *  angle on top of it (#35). `strategyId: null` clears the link. */
  strategyId?: number | null
  gamePlan?: string | null
}

/**
 * Patch a prospect. Returns null when there is no such #number.
 *
 * **`stage` is deliberately not here.** Moving a deal writes a journey row and
 * may close it, which is `setProspectStage` below — a PATCH that silently did
 * half of that would leave a prospect whose ladder disagrees with its own stage
 * column, and nothing would say so.
 */
export async function updateProspect(
  workspaceId: number,
  seq: number,
  patch: UpdateProspectInput,
  actor: Actor
): Promise<ProspectRow | null> {
  const db = getDb()
  const existing = await getProspectBySeq(workspaceId, seq)
  if (!existing) return null

  const updated = await db.transaction(async (tx) => {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const values: Record<string, unknown> = { updated_at: new Date() }

    const set = <K extends keyof Prospect>(col: string, key: K, next: Prospect[K]) => {
      if (existing[key] === next) return
      before[col] = existing[key]
      after[col] = next
      values[col] = next
    }
    if (patch.name !== undefined) set('name', 'name', patch.name)
    if (patch.city !== undefined) set('city', 'city', patch.city)
    if (patch.sector !== undefined) set('sector', 'sector', patch.sector)
    if (patch.value !== undefined) set('value', 'value', patch.value)
    if (patch.currency !== undefined) set('currency', 'currency', patch.currency)
    if (patch.source !== undefined) set('source', 'source', patch.source)
    if (patch.summary !== undefined) set('summary', 'summary', patch.summary)
    if (patch.website !== undefined) set('website', 'website', patch.website)
    if (patch.address !== undefined) set('address', 'address', patch.address)
    if (patch.gamePlan !== undefined) set('game_plan', 'game_plan', patch.gamePlan)
    if (patch.strategyId !== undefined) set('strategy_id', 'strategy_id', patch.strategyId)
    if (patch.ownerUserId !== undefined) {
      set('owner_user_id', 'owner_user_id', patch.ownerUserId)
    }

    // Nothing actually changed — no row write, and no event. An activity feed
    // that records a no-op edit teaches a reader that something happened.
    if (Object.keys(after).length === 0) return existing

    const [row] = await tx
      .update(prospects)
      .set(values)
      .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
      .returning()
    if (!row) throw new Error('prospect update returned nothing')

    // An ownership change is its own verb in the feed. "assigned" answers a
    // different question from "updated" and the mockup's history shows it as
    // one.
    const ownerChanged = 'owner_user_id' in after
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: row.id,
      action: ownerChanged
        ? row.owner_user_id == null
          ? 'unassigned'
          : 'assigned'
        : 'updated',
      diff: { before, after },
      meta: { name: row.name },
    })
    return row
  })

  const [decorated] = await decorate([updated])
  return decorated ?? null
}

/**
 * Set what we owe this prospect next — all four columns at once.
 *
 * One function rather than four fields on `updateProspect`, because they are one
 * intention: a `next_action_type` with no due date is half a commitment, and the
 * Today queue filters on the date. Passing `type: null` clears the whole thing,
 * which is what "there is nothing owed" means.
 */
export async function setNextAction(
  workspaceId: number,
  seq: number,
  patch: {
    type?: string | null
    /** A resolved `YYYY-MM-DD`. */
    due?: string | null
    /** The phrase the agent wrote. Displayed in preference to the date. */
    dueLabel?: string | null
    note?: string | null
    ownerUserId?: number | null
    ownerLabel?: string | null
  },
  actor: Actor
): Promise<ProspectRow | null> {
  const db = getDb()
  const existing = await getProspectBySeq(workspaceId, seq)
  if (!existing) return null

  const updated = await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (patch.type !== undefined) values.next_action_type = patch.type
    if (patch.due !== undefined) values.next_action_due = patch.due
    if (patch.dueLabel !== undefined) values.next_action_due_label = patch.dueLabel
    if (patch.note !== undefined) values.next_action_note = patch.note
    if (patch.ownerUserId !== undefined) values.next_action_owner_user_id = patch.ownerUserId
    if (patch.ownerLabel !== undefined) values.next_action_owner_label = patch.ownerLabel

    // Clearing the type clears the rest. A due date on a prospect with no action
    // is a row the Today queue would surface with nothing to say about it.
    if (patch.type === null) {
      values.next_action_due = null
      values.next_action_due_label = null
      values.next_action_note = null
      values.next_action_owner_user_id = null
      values.next_action_owner_label = null
    }

    const [row] = await tx
      .update(prospects)
      .set(values)
      .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
      .returning()
    if (!row) throw new Error('next-action update returned nothing')

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: row.id,
      action: 'next_action_changed',
      diff: {
        before: { type: existing.next_action_type, due: existing.next_action_due },
        after: { type: row.next_action_type, due: row.next_action_due },
      },
      meta: { name: row.name },
    })
    return row
  })

  const [decorated] = await decorate([updated])
  return decorated ?? null
}

/**
 * Move a deal to another stage, and write the journey step that proves it.
 *
 * `won` and `lost` are terminal (`TERMINAL_STAGES`): they set `closed_at` and
 * may carry a reason. Moving BACK off a terminal stage clears both — a reopened
 * deal that keeps its close date reads as closed in every aggregate that filters
 * on it.
 */
export async function setProspectStage(
  workspaceId: number,
  seq: number,
  stage: string,
  opts: { note?: string | null; closedReason?: string | null; terminal: boolean; actor: Actor }
): Promise<ProspectRow | null> {
  const db = getDb()
  const existing = await getProspectBySeq(workspaceId, seq)
  if (!existing) return null

  const updated = await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(prospects)
      .set({
        stage,
        closed_at: opts.terminal ? (existing.closed_at ?? now) : null,
        closed_reason: opts.terminal ? (opts.closedReason ?? existing.closed_reason) : null,
        updated_at: now,
      })
      .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
      .returning()
    if (!row) throw new Error('prospect stage update returned nothing')

    // The step just left becomes `done`; the one just entered becomes
    // `current`. Any other row for this prospect keeps whatever it had — an
    // `upcoming` placeholder further up the ladder is still upcoming.
    await tx
      .update(stageEntries)
      .set({ status: 'done', updated_at: now })
      .where(and(eq(stageEntries.prospect_id, row.id), eq(stageEntries.status, 'current')))

    await tx.insert(stageEntries).values({
      workspace_id: workspaceId,
      prospect_id: row.id,
      stage,
      status: 'current',
      occurred_at: now,
      actor_user_id: opts.actor.userId,
      actor_label: opts.actor.label,
      note: opts.note ?? null,
    })

    await recordEvent(tx, {
      workspaceId,
      actorUserId: opts.actor.userId,
      actorTokenId: opts.actor.tokenId,
      entityType: 'prospect',
      entityId: row.id,
      action: 'stage_changed',
      diff: { before: { stage: existing.stage }, after: { stage } },
      meta: { name: row.name },
    })
    return row
  })

  const [decorated] = await decorate([updated])
  return decorated ?? null
}

/**
 * Bin a prospect: `deleted_at`, and the same on everything reached through it.
 *
 * Soft, always. A hard delete is `bk sales trash purge` and nothing else, which
 * is what makes D-19's 90-day retention a property of the data rather than of
 * whoever remembered to be careful.
 *
 * Returns null when there is no such #number, and the row itself when it was
 * ALREADY binned — an idempotent second delete is not an error, and `bk` reports
 * what it found either way.
 */
export async function softDeleteProspect(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<ProspectRow | null> {
  const db = getDb()
  const existing = await getProspectBySeq(workspaceId, seq)
  if (!existing) return null
  if (existing.deleted_at) return existing

  const deleted = await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(prospects)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
      .returning()
    if (!row) throw new Error('prospect delete returned nothing')

    // The cascade, by predicate. Only the three child tables that HAVE a
    // `deleted_at` are listed, and the ones absent are absent for a reason:
    // `stage_entries`, `objections` and `matches` are history and verdicts about
    // this prospect with no independent life, so they carry no bin state and go
    // when the row is purged. Restoring a prospect must bring back exactly what
    // this binned — `bk sales trash restore` (Phase 5) inverts these three.
    for (const child of [contacts, meetings, communications]) {
      await tx
        .update(child)
        .set({ deleted_at: now, updated_at: now })
        .where(and(eq(child.prospect_id, row.id), isNull(child.deleted_at)))
    }

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: row.id,
      action: 'deleted',
      meta: { name: row.name, number: row.seq },
    })
    return row
  })

  const [decorated] = await decorate([deleted])
  return decorated ?? null
}
