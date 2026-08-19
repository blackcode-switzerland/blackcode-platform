// Phase 5: compliance — the rules, their review, and the verdict write.
//
// ===========================================================================
// THE APP COMPUTES NO COMPLIANCE JUDGMENT, AND THAT IS THE DESIGN
// ===========================================================================
// Flags are facts: a date passed, a document is absent, arithmetic crossed a
// threshold. The Devil's Advocate is an EXTERNAL agent pass that reads the
// rules and the records and writes a structured verdict back — accepted,
// accepted_with_warning, or blocked — with the rules it triggered, the worst
// case, and what would resolve it. It never corrects anything
// (compliance/DEVILS-ADVOCATE-AGENT.md). The app stores the verdict, renders
// it, and enforces exactly ONE consequence: a blocked entry refuses to post
// (the check lives in postEntry, server side).
//
// ===========================================================================
// ALL RULES ARE DRAFT UNTIL THE FIDUCIARY SIGNS OFF
// ===========================================================================
// The 19 rules were researched against Fedlex, and research is not sign-off:
// COMPLIANCE_META says so in capitals. Review is the only write this table
// takes — approve, edit (the corrected wording lands in `edited_logic`, the
// original stays), or reject — recorded with who and when. Never deleted:
// a verdict may cite a rule forever.

import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksComplianceRule,
  booksEntity,
  booksEntry,
  booksRiEntry,
  type BooksComplianceRule,
  type StoredHistory,
  type StoredHistoryEvent,
  type StoredSpeech,
} from '../schema'

export class ComplianceRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export const VERDICTS = ['accepted', 'accepted_with_warning', 'blocked'] as const
export const REVIEW_STATES = ['approved', 'edited', 'rejected'] as const

// ---------------------------------------------------------------------------
// Rules — list and review
// ---------------------------------------------------------------------------

export async function listComplianceRules(): Promise<BooksComplianceRule[]> {
  return getDb().select().from(booksComplianceRule).orderBy(asc(booksComplianceRule.rule_id))
}

export async function getComplianceRule(ruleId: string): Promise<BooksComplianceRule | null> {
  const [row] = await getDb()
    .select()
    .from(booksComplianceRule)
    .where(eq(booksComplianceRule.rule_id, ruleId))
    .limit(1)
  return row ?? null
}

export interface ReviewRuleData {
  state: (typeof REVIEW_STATES)[number]
  /** Required when state is `edited`: the fiduciary's corrected check logic. */
  editedLogic?: string | null
  note?: string | null
  by: string
}

/**
 * The fiduciary's sign-off, one rule at a time. Draft is where rules are BORN,
 * not a state a review sets — reviewing backwards to draft would erase the
 * fact that somebody looked.
 */
export async function reviewComplianceRule(ruleId: string, data: ReviewRuleData): Promise<BooksComplianceRule> {
  const rule = await getComplianceRule(ruleId)
  if (!rule) {
    throw new ComplianceRefused('rule_not_found', `no compliance rule "${ruleId}"`, 'bk books compliance list names all 19')
  }
  if (!REVIEW_STATES.includes(data.state)) {
    throw new ComplianceRefused('bad_state', `"${data.state}" is not a review verdict`, `one of: ${REVIEW_STATES.join(', ')} — draft is where rules are born, not a state a review sets`)
  }
  if (data.state === 'edited' && !data.editedLogic?.trim()) {
    throw new ComplianceRefused('edited_needs_logic', 'an edit without the corrected wording is an approval wearing a different name', 'pass the corrected check logic')
  }
  if (!data.by?.trim()) {
    throw new ComplianceRefused('missing_reviewer', 'a sign-off records who signed', 'pass the reviewer')
  }

  const [row] = await getDb()
    .update(booksComplianceRule)
    .set({
      review_state: data.state,
      edited_logic: data.state === 'edited' ? data.editedLogic!.trim() : rule.edited_logic,
      review_note: data.note ?? rule.review_note,
      reviewed_by: data.by.trim(),
      reviewed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(booksComplianceRule.rule_id, ruleId))
    .returning()
  return row
}

// ---------------------------------------------------------------------------
// Verdicts — the Devil's Advocate's write
// ---------------------------------------------------------------------------

export interface VerdictData {
  /** Names a simplified book when the number lives in its RI journal. */
  entity?: string | null
  verdict: (typeof VERDICTS)[number]
  /** The rule_ids that triggered. Every one must exist. */
  rules: string[]
  worstCase?: unknown
  resolves?: unknown
  by: string
}

/** History is append-only; a pre-existing narrative object becomes the first element — resolve.ts's rule. */
function appendHistory(prior: unknown, event: StoredHistoryEvent): StoredHistory {
  const was = Array.isArray(prior)
    ? (prior as (StoredHistoryEvent | StoredSpeech)[])
    : prior
      ? [prior as StoredSpeech]
      : []
  return [...was, event]
}

/**
 * Write one verdict onto one record. Interpretation, open on posted entries
 * by 0004's design — and history-first like resolve, so a verdict that
 * REPLACES an earlier one leaves the earlier one in the trail. The agent
 * never corrects the record; `blocked`'s one consequence is enforced at
 * posting, not here.
 */
export async function recordVerdict(
  workspaceId: number,
  entryNumber: number,
  data: VerdictData
): Promise<{ journal: 'grand_livre' | 'recettes_depenses'; number: number; verdict: unknown }> {
  if (!VERDICTS.includes(data.verdict)) {
    throw new ComplianceRefused('bad_verdict', `"${data.verdict}" is not a verdict`, `one of: ${VERDICTS.join(', ')}`)
  }
  if (!Array.isArray(data.rules) || data.rules.length === 0) {
    throw new ComplianceRefused('missing_rules', 'a verdict names the rules that triggered — flags are facts, not moods', 'pass at least one rule_id')
  }
  if (!data.by?.trim()) {
    throw new ComplianceRefused('missing_reviewer', 'a verdict records which agent gave it', 'pass the reviewer')
  }
  const known = new Set((await listComplianceRules()).map((r) => r.rule_id))
  const unknown = data.rules.filter((r) => !known.has(r))
  if (unknown.length > 0) {
    throw new ComplianceRefused('unknown_rule', `no such rule: ${unknown.join(', ')}`, 'bk books compliance list names all 19')
  }

  const verdict = {
    verdict: data.verdict,
    rules: data.rules,
    worst_case: data.worstCase ?? null,
    resolves: data.resolves ?? null,
    at: new Date().toISOString(),
    by: data.by.trim(),
  }

  const db = getDb()
  return db.transaction(async (tx) => {
    // The piece-match lesson (#53), applied from birth: an --entity that names
    // a simplified book addresses ITS journal; the bare number addresses the
    // grand livre first, then the single RI row a workspace-unique seq allows.
    if (data.entity) {
      const [entity] = await tx
        .select()
        .from(booksEntity)
        .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, data.entity)))
        .limit(1)
      if (!entity) throw new ComplianceRefused('entity_not_found', `no book "${data.entity}"`, 'bk books entity list names them')
      if (entity.bookkeeping_regime === 'simplified') {
        const [ri] = await tx
          .select()
          .from(booksRiEntry)
          .where(and(eq(booksRiEntry.workspace_id, workspaceId), eq(booksRiEntry.entity_id, entity.id), eq(booksRiEntry.seq, entryNumber)))
          .limit(1)
        if (!ri || ri.deleted_at) {
          throw new ComplianceRefused('entry_not_found', `no entry #${entryNumber} in this book's recettes-dépenses journal`, 'bk books entry list --entity shows the numbers')
        }
        await tx
          .update(booksRiEntry)
          .set({
            verdict,
            history: appendHistory(ri.history, { at: verdict.at, event: 'verdict', was: { verdict: ri.verdict } }),
          })
          .where(eq(booksRiEntry.id, ri.id))
        return { journal: 'recettes_depenses' as const, number: ri.seq, verdict }
      }
    }

    const [entry] = await tx
      .select()
      .from(booksEntry)
      .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, entryNumber)))
      .limit(1)
    if (!entry || entry.deleted_at) {
      throw new ComplianceRefused('entry_not_found', `no entry #${entryNumber}`, 'bk books entry list shows the numbers')
    }
    if (data.entity) {
      const [entity] = await tx
        .select()
        .from(booksEntity)
        .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, data.entity)))
        .limit(1)
      if (entity && entry.entity_id !== entity.id) {
        throw new ComplianceRefused('entry_other_book', `entry #${entryNumber} belongs to another book: two legal entities' records never mix`, 'the entry list of the named book shows its numbers')
      }
    }
    await tx
      .update(booksEntry)
      .set({
        verdict,
        history: appendHistory(entry.history, { at: verdict.at, event: 'verdict', was: { verdict: entry.verdict } }),
      })
      .where(eq(booksEntry.id, entry.id))
    return { journal: 'grand_livre' as const, number: entry.seq, verdict }
  })
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

export function publicComplianceRule(r: BooksComplianceRule) {
  return {
    rule_id: r.rule_id,
    citation: r.citation,
    applies_to: r.applies_to,
    trigger_condition: r.trigger_condition,
    check_logic: r.check_logic,
    severity: r.severity,
    consequence: r.consequence,
    summary: r.summary,
    source_confidence: r.source_confidence,
    review_state: r.review_state,
    edited_logic: r.edited_logic,
    review_note: r.review_note,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
  }
}
