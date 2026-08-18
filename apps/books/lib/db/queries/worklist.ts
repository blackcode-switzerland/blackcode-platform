// The worklist: everything that needs a human, with what the machine would say.
//
// ===========================================================================
// ONE LIST, BOTH BOOKKEEPING REGIMES
// ===========================================================================
// Unrecognized money is unrecognized whether it sits in a double-entry journal
// or an RI's recettes/dépenses book, so the worklist serves both — each row
// says which kind it is, and an RI row can never be resolved into an account
// because it has no lines to put one on.
//
// ===========================================================================
// SUGGESTIONS ARE COMPUTED LIVE, NEVER STORED
// ===========================================================================
// Each unrecognized entry is run through `matchesRule` against the book's
// active rules AT READ TIME. Storing a suggestion would create a second copy
// of the matcher's opinion that survives the rule changing under it — same
// argument as the derivations, same rule: nothing here is ever stored.
//
// A suggestion is exactly that. The machine never applies one; resolve does,
// when a human says so. Phase 3's ingest will run the same matcher at arrival
// time and mark clean hits itself — the difference is that at ingest the rule
// meets NEW money, while here it meets money a human is already looking at.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../client'
import { booksEntry, booksEntryLine, booksRiEntry, booksPieceInbox } from '../schema'
import { listRules } from './rules'
import { suggestFor, WORKLIST_STATES } from '../../derive/recognition'
import { entryAmount } from '../../derive/recognition'
import { fromCentimes, toCentimes } from '../../derive'
import { candidatesFor } from './pieces'
import type { Extraction } from '../../validate/extraction'

export interface WorklistRow {
  kind: 'entry' | 'ri_entry' | 'piece'
  number: number
  date: string
  status: string | null
  raw_label: string
  counterparty: string | null
  /**
   * Why this row needs a human. For entries and ri_entries it is the
   * recognition state (unrecognized | inferred); for pieces it is
   * `unmatched` or `needs_review` — a different vocabulary on purpose,
   * because a document is not a transaction.
   */
  recognition: string
  evidence_tier: string
  amount: string
  /** Rule #numbers that would explain this row, in rule order. Often empty. */
  suggested_rules: number[]
  /** Pieces only: entry #numbers this document could prove (amount + ±3 days). */
  suggested_entries: number[]
}

export async function getWorklist(entityId: number, exerciceId: number): Promise<WorklistRow[]> {
  const db = getDb()
  const rules = await listRules(entityId, { active: true })

  const entries = await db
    .select()
    .from(booksEntry)
    .where(
      and(
        eq(booksEntry.entity_id, entityId),
        eq(booksEntry.exercice_id, exerciceId),
        isNull(booksEntry.deleted_at),
        inArray(booksEntry.recognition, [...WORKLIST_STATES])
      )
    )
    .orderBy(asc(booksEntry.date), asc(booksEntry.seq))

  const out: WorklistRow[] = []
  for (const e of entries) {
    const lines = await db
      .select()
      .from(booksEntryLine)
      .where(eq(booksEntryLine.entry_id, e.id))
    out.push({
      kind: 'entry',
      number: e.seq,
      date: e.date,
      status: e.status,
      raw_label: e.raw_label,
      counterparty: e.counterparty,
      recognition: e.recognition,
      evidence_tier: e.evidence_tier,
      amount: fromCentimes(entryAmount({ lines })),
      suggested_entries: [],
      suggested_rules: suggestFor(
        { source_id: e.source_id, raw_label: e.raw_label, lines },
        rules.map((r) => ({
          source_id: r.source_id,
          active: r.active,
          pattern: r.pattern as { counterparty?: string | null } | null,
          seq: r.seq,
        }))
      ).map((r) => r.seq),
    })
  }

  const riRows = await db
    .select()
    .from(booksRiEntry)
    .where(
      and(
        eq(booksRiEntry.entity_id, entityId),
        eq(booksRiEntry.exercice_id, exerciceId),
        isNull(booksRiEntry.deleted_at),
        inArray(booksRiEntry.recognition, [...WORKLIST_STATES])
      )
    )
    .orderBy(asc(booksRiEntry.date), asc(booksRiEntry.seq))

  for (const r of riRows) {
    out.push({
      kind: 'ri_entry',
      number: r.seq,
      date: r.date,
      status: null,
      raw_label: r.raw_label,
      counterparty: r.counterparty,
      recognition: r.recognition,
      evidence_tier: r.evidence_tier,
      amount: r.amount,
      suggested_entries: [],
      // An RI entry has no source register yet: match against the book's
      // sourceless rules on the label alone, which is what rule 107 is.
      suggested_rules: suggestFor(
        { source_id: null, raw_label: r.raw_label, lines: [{ debit: r.amount, credit: 0 }] },
        rules.map((x) => ({
          source_id: x.source_id,
          active: x.active,
          pattern: x.pattern as { counterparty?: string | null } | null,
          seq: x.seq,
        }))
      ).map((x) => x.seq),
    })
  }

  // ---- the documents waiting for their transactions -----------------------
  // Phase 3: unmatched pieces sit on the SAME list, because document matching
  // happens here rather than in a second review queue (the spec's own words).
  // Suggestions are candidate ENTRIES: same amount to the rappen, ±3 days.
  // Scoped by ENTITY, like everything else on this list; an unattributed
  // piece (entity NULL) belongs to the inbox screen until somebody says whose
  // it is, not to a book's worklist it may not concern.
  const pieces = await getDb()
    .select()
    .from(booksPieceInbox)
    .where(and(eq(booksPieceInbox.entity_id, entityId), eq(booksPieceInbox.status, 'staged')))
    .orderBy(asc(booksPieceInbox.received), asc(booksPieceInbox.seq))

  for (const p of pieces) {
    const x = p.extraction as unknown as Extraction & { tx?: Extraction['transaction'] }
    const t = x.transaction ?? x.tx
    const candidates = await candidatesFor(p.workspace_id, p)
    out.push({
      kind: 'piece',
      number: p.seq,
      date: t?.date ?? p.received,
      status: p.status,
      raw_label: `${x.merchant?.name ?? p.file_name ?? p.drive_file_id}`,
      counterparty: x.merchant?.name ?? null,
      recognition: p.needs_review ? 'needs_review' : 'unmatched',
      evidence_tier: '',
      amount: t ? fromCentimes(toCentimes(t.total)) : '0.00',
      suggested_rules: [],
      suggested_entries: candidates.map((c) => c.number),
    })
  }

  return out
}
