// `sales.strategies` — why a SEGMENT was chosen (#37), and the products it
// leads with.
//
// ---------------------------------------------------------------------------
// A SEPARATE MODULE FROM `catalog.ts`, AND FROM `prospect-children.ts`
// ---------------------------------------------------------------------------
// It is not catalog: a strategy is not a thing we sell. It is not a prospect
// child either — the whole point of #37 is that the reasoning is REUSABLE and
// "browsable independent of individual prospects", which is what having its own
// `seq` and its own listing means here.
//
// The prospect END of the relationship (`prospects.strategy_id`,
// `prospects.game_plan`) lives in `prospects.ts` with the rest of that table's
// columns, because that is where a reader looking at a prospect will be.
//
// ---------------------------------------------------------------------------
// `products` IS REPLACED WHOLE, NOT PATCHED MEMBER BY MEMBER
// ---------------------------------------------------------------------------
// `setStrategyProducts` deletes and re-inserts inside one transaction. The
// alternative — add/remove verbs — is three round trips to express "these
// three", and an agent that has just decided a segment leads with two products
// has to first find out which ones are there now. A caller who wants to add one
// sends the whole list including it, which is also what the CLI's `--product`
// repeatable flag naturally produces.
//
// The cost is that a concurrent edit is last-write-wins on the SET rather than
// merged. That is the right trade for a field whose whole content is a decision
// somebody made deliberately, and it is the same shape `documents` link tables
// already use.

import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../client'
import { products, prospects, strategies, strategyProducts } from '../schema'
import type { Product, Strategy } from '../schema'
import { allocateSeq } from './counters'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'
import { PAGE_SIZE_MAX } from '@blackcode/platform-api'

/** A strategy with the products it leads with, and how many prospects use it. */
export interface StrategyRow extends Strategy {
  products: Array<{ number: number; name: string }>
  /** Prospects pointing at this strategy. NOT a join for display — it is the
   *  number a reader needs before retiring a segment, and the delete route
   *  reports it back rather than silently orphaning ten deals. */
  prospect_count: number
}

async function decorate(rows: Strategy[]): Promise<StrategyRow[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)

  const [links, counts] = await Promise.all([
    db
      .select({
        strategy_id: strategyProducts.strategy_id,
        number: products.seq,
        name: products.name,
      })
      .from(strategyProducts)
      .innerJoin(products, eq(products.id, strategyProducts.product_id))
      .where(inArray(strategyProducts.strategy_id, ids))
      // By the product's own #number, so two surfaces listing the same strategy
      // list its products in the same order — the defect sales #30 was about.
      .orderBy(asc(products.seq)),
    db
      .select({ strategy_id: prospects.strategy_id, n: sql<number>`count(*)::int` })
      .from(prospects)
      .where(and(inArray(prospects.strategy_id, ids), isNull(prospects.deleted_at)))
      .groupBy(prospects.strategy_id),
  ])

  const byStrategy = new Map<number, Array<{ number: number; name: string }>>()
  for (const l of links) {
    const list = byStrategy.get(l.strategy_id) ?? []
    list.push({ number: l.number, name: l.name })
    byStrategy.set(l.strategy_id, list)
  }
  const countBy = new Map<number, number>()
  for (const c of counts) if (c.strategy_id != null) countBy.set(c.strategy_id, Number(c.n))

  return rows.map((r) => ({
    ...r,
    products: byStrategy.get(r.id) ?? [],
    prospect_count: countBy.get(r.id) ?? 0,
  }))
}

export async function listStrategies(opts: {
  workspaceId: number
  q?: string
  includeDeleted?: boolean
  limit?: number
}): Promise<StrategyRow[]> {
  const db = getDb()
  const where: SQL[] = [eq(strategies.workspace_id, opts.workspaceId)]
  if (!opts.includeDeleted) where.push(isNull(strategies.deleted_at))
  if (opts.q?.trim()) where.push(ilike(strategies.name, `%${opts.q.trim()}%`))
  const rows = await db
    .select()
    .from(strategies)
    .where(and(...where))
    // Most recently touched first, `seq` as the tiebreaker so the order is total
    // — the same rule `listProspects` states.
    .orderBy(desc(strategies.updated_at), desc(strategies.seq))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), PAGE_SIZE_MAX))
  return await decorate(rows)
}

export async function getStrategyBySeq(
  workspaceId: number,
  seq: number
): Promise<StrategyRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.workspace_id, workspaceId), eq(strategies.seq, seq)))
    .limit(1)
  if (!row) return null
  return (await decorate([row]))[0] ?? null
}

export interface StrategyInput {
  name?: string
  vertical?: string | null
  area?: string | null
  rationale?: string | null
  caseStudies?: string | null
  /** Product #numbers. `undefined` leaves the set alone; `[]` clears it. */
  productNumbers?: number[]
}

/**
 * Resolve product #numbers to row ids, refusing the whole call on the first one
 * that is not in this workspace.
 *
 * All-or-nothing on purpose. Silently dropping an unknown number would store a
 * strategy that leads with two products when the caller named three, and the
 * caller would have no way to notice — the listing would simply show two.
 */
async function resolveProductIds(workspaceId: number, numbers: number[]): Promise<number[]> {
  if (numbers.length === 0) return []
  const db = getDb()
  const found = await db
    .select({ id: products.id, seq: products.seq })
    .from(products)
    .where(
      and(
        eq(products.workspace_id, workspaceId),
        inArray(products.seq, numbers),
        isNull(products.deleted_at)
      )
    )
  const bySeq = new Map(found.map((p) => [p.seq, p.id]))
  const missing = numbers.filter((n) => !bySeq.has(n))
  if (missing.length > 0) {
    const err = new Error(`unknown products: ${missing.join(', ')}`) as Error & {
      missingProducts?: number[]
    }
    err.missingProducts = missing
    throw err
  }
  return [...new Set(numbers)].map((n) => bySeq.get(n)!)
}

export async function createStrategy(
  workspaceId: number,
  input: StrategyInput & { name: string },
  actor: Actor
): Promise<StrategyRow> {
  const productIds = await resolveProductIds(workspaceId, input.productNumbers ?? [])
  const db = getDb()
  const created = await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, workspaceId, 'strategy')
    const [row] = await tx
      .insert(strategies)
      .values({
        workspace_id: workspaceId,
        seq,
        name: input.name,
        vertical: input.vertical ?? null,
        area: input.area ?? null,
        rationale: input.rationale ?? null,
        case_studies: input.caseStudies ?? null,
        created_by: actor.userId,
      })
      .returning()
    if (!row) throw new Error('strategy insert returned nothing')

    if (productIds.length > 0) {
      await tx
        .insert(strategyProducts)
        .values(productIds.map((id) => ({ strategy_id: row.id, product_id: id })))
    }

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'strategy',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name, vertical: row.vertical },
    })
    return row
  })
  return (await decorate([created]))[0]!
}

export async function updateStrategy(
  workspaceId: number,
  seq: number,
  input: StrategyInput,
  actor: Actor
): Promise<StrategyRow | null> {
  const existing = await getStrategyBySeq(workspaceId, seq)
  if (!existing) return null
  // Resolved BEFORE the transaction opens, so an unknown product number is a
  // 404 that changed nothing rather than a rolled-back write.
  const productIds =
    input.productNumbers === undefined
      ? undefined
      : await resolveProductIds(workspaceId, input.productNumbers)

  const db = getDb()
  const updated = await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.name !== undefined) values.name = input.name
    if (input.vertical !== undefined) values.vertical = input.vertical
    if (input.area !== undefined) values.area = input.area
    if (input.rationale !== undefined) values.rationale = input.rationale
    if (input.caseStudies !== undefined) values.case_studies = input.caseStudies

    const [row] = await tx
      .update(strategies)
      .set(values)
      .where(and(eq(strategies.workspace_id, workspaceId), eq(strategies.seq, seq)))
      .returning()
    if (!row) return null

    if (productIds !== undefined) {
      // Replace the SET, in one transaction — see this file's header.
      await tx.delete(strategyProducts).where(eq(strategyProducts.strategy_id, row.id))
      if (productIds.length > 0) {
        await tx
          .insert(strategyProducts)
          .values(productIds.map((id) => ({ strategy_id: row.id, product_id: id })))
      }
    }

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'strategy',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name },
    })
    return row
  })
  if (!updated) return null
  return (await decorate([updated]))[0] ?? null
}

/**
 * Bin a strategy. SOFT — it has a #number, so `bk sales trash` can list it and
 * restore it.
 *
 * The prospects pointing at it are NOT touched and NOT unlinked: the FK is
 * `ON DELETE SET NULL`, which only fires on a hard delete (a trash purge), and a
 * soft delete that silently detached ten deals would be unrestorable — putting
 * the strategy back would not put the links back. The returned row carries
 * `prospect_count` so the caller can say how many deals are affected.
 */
export async function softDeleteStrategy(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<StrategyRow | null> {
  const db = getDb()
  const out = await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(strategies)
      .set({ deleted_at: now, updated_at: now })
      .where(
        and(
          eq(strategies.workspace_id, workspaceId),
          eq(strategies.seq, seq),
          isNull(strategies.deleted_at)
        )
      )
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'strategy',
      entityId: row.id,
      action: 'deleted',
      meta: { name: row.name, number: row.seq },
    })
    return row
  })
  // Already binned is not an error — report what is there, so a retry reads the
  // same as the first call. Same rule the catalog and prospect paths follow.
  if (out) return (await decorate([out]))[0] ?? null
  return await getStrategyBySeq(workspaceId, seq)
}

/** Every prospect linked to one strategy — what the detail view lists. */
export async function listStrategyProspects(
  workspaceId: number,
  strategyId: number
): Promise<Array<{ number: number; name: string; stage: string }>> {
  const db = getDb()
  return await db
    .select({ number: prospects.seq, name: prospects.name, stage: prospects.stage })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspace_id, workspaceId),
        eq(prospects.strategy_id, strategyId),
        isNull(prospects.deleted_at)
      )
    )
    .orderBy(asc(prospects.seq))
}

export type { Product }
