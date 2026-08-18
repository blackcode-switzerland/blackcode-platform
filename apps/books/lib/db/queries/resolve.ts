// Resolve: the first mutation in the app, and the pattern every later one copies.
//
// ===========================================================================
// RESOLUTION ANSWERS THE QUESTION. IT DOES NOT ERASE WHERE THE ANSWER CAME FROM.
// ===========================================================================
// The old state goes into `history` BEFORE anything changes, in the same
// transaction, forever. "The resolved row still shows: was unrecognized" is a
// phase 2 acceptance criterion, and it is the b/ platform's standing rule —
// never merge an inferred record into a confirmed one.
//
// ===========================================================================
// WHAT RESOLVE MAY TOUCH SPLITS EXACTLY ALONG 0004'S FREEZE LINE
// ===========================================================================
// Interpretation is open on every entry, posted or staged: counterparty,
// explanation, recognition, matched rule, evidence note. That is what lets
// seeded entry 1009 — POSTED, unrecognized, the frozen-UBS outflow — be
// resolved months later, and it is why 0005 refused to revoke UPDATE.
//
// The ACCOUNT is different. On a STAGED entry, assigning the account to the
// null-account line is the whole point of resolving (1012, 1013: money moved,
// nobody had said what it was). On a POSTED entry the lines are accounting
// facts, frozen by trigger, and this module REFUSES the attempt itself rather
// than letting the trigger do it, so the caller gets "a correction is a
// reversing entry" instead of a constraint error.
//
// One transaction for everything: history, fields, line account, and the rule
// a resolution teaches. A resolution that half-applied would be a record that
// lies about its own provenance.

import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../client'
import { booksEntry, booksEntryLine, booksRule, type BooksEntry } from '../schema'
import { insertRule, type CreateRuleData, type Tx } from './rules'

export interface ResolveData {
  /** Required: what this money was. The mockup's bilingual shape or plain text. */
  explanation: Record<string, unknown>
  /** known_one_off unless a rule is being taught (then known_recurring). */
  recognition?: 'known_one_off' | 'known_recurring'
  counterparty?: string | null
  /** STAGED entries only: the account for the line that has none. */
  account?: string | null
  evidenceNote?: Record<string, unknown> | null
  /** Teach a rule from this resolution. Pattern defaults come from the entry. */
  rule?: {
    counterparty: string
    amount_chf?: number | null
    tolerance_chf?: number | null
    interval?: string | null
    learnedFrom?: string | null
  } | null
}

export class ResolveRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

/**
 * Resolve one entry, by workspace #number. Returns the updated row and the
 * taught rule's #number when one was created.
 */
export async function resolveEntry(
  workspaceId: number,
  entryNumber: number,
  data: ResolveData
): Promise<{ entry: BooksEntry; taughtRuleSeq: number | null }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(booksEntry)
      .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, entryNumber)))
      .limit(1)
    if (!entry) {
      throw new ResolveRefused('not_found', `no entry #${entryNumber}`, 'bk books worklist lists the numbers')
    }
    if (entry.deleted_at) {
      throw new ResolveRefused('deleted', `entry #${entryNumber} is deleted`, 'nothing to resolve')
    }

    if (data.account && entry.status === 'posted') {
      throw new ResolveRefused(
        'posted_lines_frozen',
        `entry #${entryNumber} is posted: its lines are accounting facts and the account cannot be changed`,
        'a correction is a reversing entry; resolve may still set explanation, counterparty and recognition'
      )
    }

    // ---- history first: the old state, kept forever ----------------------
    // Append-only array. A pre-existing non-array history (the mockup seeds
    // narrative objects) becomes the first element rather than being replaced:
    // provenance is permanent includes the provenance we imported.
    const was = {
      at: new Date().toISOString(),
      event: 'resolved',
      was: {
        recognition: entry.recognition,
        counterparty: entry.counterparty,
        explanation: entry.explanation,
        matched_rule_id: entry.matched_rule_id,
      },
    }
    const prior = entry.history
    const history = Array.isArray(prior) ? [...prior, was] : prior ? [prior, was] : [was]

    // ---- the rule this resolution teaches, if any ------------------------
    let taughtRuleSeq: number | null = null
    let taughtRuleId: number | null = null
    if (data.rule) {
      const ruleData: CreateRuleData = {
        entityId: entry.entity_id,
        // The PAIR: the rule is born keyed to the source the entry came
        // through. A rule taught by a WIR payment explains WIR payments.
        sourceId: entry.source_id,
        pattern: {
          counterparty: data.rule.counterparty,
          amount_chf: data.rule.amount_chf ?? null,
          tolerance_chf: data.rule.tolerance_chf ?? null,
          interval: data.rule.interval ?? null,
        },
        explanation: data.explanation,
        accountNo: data.account ?? firstAccountOf(await linesOf(tx, entry.id)),
        learnedFrom: data.rule.learnedFrom ?? 'manual',
        createdFromEntryId: entry.id,
      }
      const rule = await insertRule(tx, workspaceId, ruleData)
      taughtRuleSeq = rule.seq
      taughtRuleId = rule.id
    }

    // ---- the entry itself -------------------------------------------------
    const recognition = data.recognition ?? (data.rule ? 'known_recurring' : 'known_one_off')
    const [updated] = await tx
      .update(booksEntry)
      .set({
        explanation: data.explanation,
        recognition,
        counterparty: data.counterparty === undefined ? entry.counterparty : data.counterparty,
        evidence_note: data.evidenceNote === undefined ? entry.evidence_note : data.evidenceNote,
        matched_rule_id: taughtRuleId ?? entry.matched_rule_id,
        history,
      })
      .where(eq(booksEntry.id, entry.id))
      .returning()

    // ---- the staged line that had no meaning ------------------------------
    if (data.account && entry.status === 'staged') {
      await tx
        .update(booksEntryLine)
        .set({ account_no: data.account })
        .where(and(eq(booksEntryLine.entry_id, entry.id), isNull(booksEntryLine.account_no)))
    }

    return { entry: updated, taughtRuleSeq }
  })
}

async function linesOf(tx: Tx, entryId: number) {
  return tx.select().from(booksEntryLine).where(eq(booksEntryLine.entry_id, entryId))
}

/** The first non-null account on the entry's lines, for a taught rule's target. */
function firstAccountOf(lines: { account_no: string | null }[]): string | null {
  return lines.find((l) => l.account_no !== null)?.account_no ?? null
}

/** Deactivate a rule. Rules are never deleted: an entry may cite one forever. */
export async function deactivateRule(workspaceId: number, ruleSeq: number): Promise<boolean> {
  const r = await getDb()
    .update(booksRule)
    .set({ active: false })
    .where(and(eq(booksRule.workspace_id, workspaceId), eq(booksRule.seq, ruleSeq)))
    .returning({ id: booksRule.id })
  return r.length > 0
}

/** The refusal codes this module can raise, for callers mapping them to HTTP. */
export const RESOLVE_REFUSALS = ['not_found', 'deleted', 'posted_lines_frozen'] as const
export type ResolveRefusalCode = (typeof RESOLVE_REFUSALS)[number]
