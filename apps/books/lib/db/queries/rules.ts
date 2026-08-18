// Recognition rules: list, create, and the wire shape.
//
// A rule is the app REMEMBERING a human's judgment. It is data like any other —
// the only special thing about it is provenance: `created_from_entry_id` records
// which entry taught it, and that link is what makes "why does this match?"
// answerable forever (phase-2-recognition.md, Notes: provenance is permanent).

import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { booksRule, booksEntry, booksCounters, type BooksRule } from '../schema'
import { sql } from 'drizzle-orm'

export async function listRules(
  entityId: number,
  opts: { active?: boolean } = {}
): Promise<BooksRule[]> {
  const conds = [eq(booksRule.entity_id, entityId)]
  if (opts.active !== undefined) conds.push(eq(booksRule.active, opts.active))
  return getDb()
    .select()
    .from(booksRule)
    .where(and(...conds))
    .orderBy(asc(booksRule.seq))
}

export interface CreateRuleData {
  entityId: number
  sourceId: number | null
  pattern: { counterparty: string; amount_chf?: number | null; tolerance_chf?: number | null; interval?: string | null }
  explanation?: Record<string, unknown> | null
  accountNo?: string | null
  /** contract | subscription | manual. What kind of relationship taught this. */
  learnedFrom?: string | null
  createdFromEntryId?: number | null
  note?: Record<string, unknown> | null
}

/** The transaction handle `getDb().transaction` hands its callback. */
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * Create a rule. Standalone here; `resolveEntry` calls the same insert inside
 * ITS transaction when a resolution teaches one, so the rule and the resolved
 * entry cannot exist without each other.
 */
export async function createRule(workspaceId: number, data: CreateRuleData): Promise<BooksRule> {
  return getDb().transaction(async (tx) => insertRule(tx, workspaceId, data))
}

/** The insert itself, callable inside another transaction. */
export async function insertRule(tx: Tx, workspaceId: number, data: CreateRuleData): Promise<BooksRule> {
  const r = await tx.execute(sql`
    INSERT INTO ${booksCounters} (workspace_id, entity_type, last_value)
    VALUES (${workspaceId}, 'rule', 1)
    ON CONFLICT (workspace_id, entity_type)
      DO UPDATE SET last_value = ${booksCounters}.last_value + 1
    RETURNING last_value
  `)
  const seq = Number((r.rows[0] as { last_value: number }).last_value)

  const [row] = await tx
    .insert(booksRule)
    .values({
      workspace_id: workspaceId,
      entity_id: data.entityId,
      seq,
      source_id: data.sourceId,
      active: true,
      learned_from: data.learnedFrom ?? 'manual',
      pattern: data.pattern,
      explanation: data.explanation ?? null,
      account_no: data.accountNo ?? null,
      created_from_entry_id: data.createdFromEntryId ?? null,
      // The DAY, not a timestamp: the mockup records rule birthdays as dates
      // and the column follows it.
      created_on: new Date().toISOString().slice(0, 10),
      note: data.note ?? null,
    })
    .returning()
  return row
}

/**
 * The wire shape. `created_from` is exposed as the TEACHING ENTRY'S workspace
 * #number, never the serial id — same rule as every other payload.
 */
export function publicRule(r: BooksRule, createdFromSeq: number | null = null) {
  return {
    number: r.seq,
    active: r.active,
    source_id: r.source_id,
    learned_from: r.learned_from,
    pattern: r.pattern,
    explanation: r.explanation,
    account: r.account_no,
    created_from: createdFromSeq,
    created_on: r.created_on,
    note: r.note,
  }
}

/** Map rule id -> teaching entry's seq, for `publicRule`'s created_from. */
export async function teachingSeqs(rules: BooksRule[]): Promise<Map<number, number>> {
  const ids = rules.map((r) => r.created_from_entry_id).filter((x): x is number => x !== null)
  if (ids.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: booksEntry.id, seq: booksEntry.seq })
    .from(booksEntry)
    .where(sql`${booksEntry.id} IN ${ids}`)
  const seqById = new Map(rows.map((x) => [x.id, x.seq]))
  const out = new Map<number, number>()
  for (const r of rules) {
    if (r.created_from_entry_id !== null && seqById.has(r.created_from_entry_id)) {
      out.set(r.id, seqById.get(r.created_from_entry_id)!)
    }
  }
  return out
}
