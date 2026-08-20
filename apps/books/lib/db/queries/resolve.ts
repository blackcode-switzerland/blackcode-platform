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
import { booksEntry, booksEntryLine, booksRiEntry, booksRule, type BooksEntry, type BooksRiEntry } from '../schema'
import { insertRule, type CreateRuleData, type Tx } from './rules'
import { accountsNotInChart, ADD_ACCOUNT_HINT } from './chart-guard'
import { tvaColumns, type TvaInput } from './tva'

export interface ResolveData {
  /** Required: what this money was. The mockup's bilingual shape or plain text. */
  explanation: Record<string, unknown>
  /** known_one_off unless a rule is being taught (then known_recurring). */
  recognition?: 'known_one_off' | 'known_recurring'
  /**
   * SIMPLIFIED books only: which side this movement falls on.
   *
   * ── WHY THE RESOLVE DOOR NEEDS THIS AND DID NOT HAVE IT ─────────────────
   * `source import` derives a direction from the bank's own credit/debit
   * indicator and can do no better — the file says money moved, not what the
   * movement WAS. `declareEntry` has taken all three values since 0009, but
   * `resolve` never took any, so a direction guessed at import could not be
   * corrected by anybody, through any verb.
   *
   * That made Andrea's rule unreachable for imported money (#59: "an own-account
   * transfer is logged but neutral"). A card settlement — the bank line that
   * pays off a card whose purchases are themselves imported — is exactly that
   * transfer, and it landed as a `depense` beside the purchases it settles, the
   * same spend counted twice. Found 2026-08-20 on `mustneer-shop`.
   *
   * Refused on a double-entry entry, where direction is carried by the lines.
   */
  direction?: 'recette' | 'depense' | 'neutral'
  counterparty?: string | null
  /** STAGED entries only: the account for the line that has none. */
  account?: string | null
  evidenceNote?: Record<string, unknown> | null
  /**
   * The VAT story. This is where it usually arrives: a bank line lands with no
   * rate, and the rate is known once somebody reads the invoice behind it.
   */
  tva?: TvaInput
  /** Teach a rule from this resolution. Pattern defaults come from the entry. */
  rule?: {
    counterparty: string
    amount_chf?: number | null
    tolerance_chf?: number | null
    interval?: string | null
    learnedFrom?: string | null
  } | null
}

const RI_DIRECTIONS = new Set(['recette', 'depense', 'neutral'])

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

    // A grand-livre entry's direction is its LINES: which account is debited
    // and which credited. There is no single side to set.
    if (data.direction !== undefined) {
      throw new ResolveRefused(
        'direction_is_ri_only',
        `entry #${entryNumber} is a double-entry entry: its direction is carried by its lines, not by a word`,
        'set the account instead (--account), or use bk books declare for a correcting entry'
      )
    }

    if (data.account && entry.status === 'posted') {
      throw new ResolveRefused(
        'posted_lines_frozen',
        `entry #${entryNumber} is posted: its lines are accounting facts and the account cannot be changed`,
        'a correction is a reversing entry; resolve may still set explanation, counterparty and recognition'
      )
    }

    // The account being filled in must exist in this book's chart. This is the
    // door most likely to meet a typo: somebody is reading a bank line and
    // typing the account it belongs to. See `chart-guard.ts`.
    if (data.account) {
      const ghosts = await accountsNotInChart(tx, entry.entity_id, [data.account])
      if (ghosts.length > 0) {
        throw new ResolveRefused(
          'unknown_account',
          `this book's chart has no account ${ghosts.join(', ')}`,
          ADD_ACCOUNT_HINT
        )
      }
    }

    // ---- VAT ---------------------------------------------------------------
    // 0004 freezes `tva_rate` and `tva_amount` on a posted entry and leaves
    // `tva_input_claimed` free, in those words: the booked figures are history,
    // whether you claim the input tax is a position that moves as evidence
    // arrives. Refuse the frozen half here so the trigger never has to speak.
    const lines = await linesOf(tx, entry.id)
    const gross = lines.reduce(
      (m, l) => Math.max(m, Number(l.debit ?? 0), Number(l.credit ?? 0)),
      0
    )
    if (
      entry.status === 'posted' &&
      data.tva &&
      ((data.tva.rate ?? null) !== null || data.tva.clear === true)
    ) {
      throw new ResolveRefused(
        'posted_tva_frozen',
        `entry #${entryNumber} is posted: the VAT rate and amount are booked figures`,
        'a correction is a reversing entry; --tva-input-claimed and --evidence-tier may still change'
      )
    }
    const tva = tvaColumns(data.tva, gross.toFixed(2), {
      rate: entry.tva_rate,
      amount: entry.tva_amount,
    })

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
    // ── #67: AN OMITTED FLAG MUST NOT REWRITE A FIELD ─────────────────────
    // This was `data.recognition ?? (data.rule ? 'known_recurring' : ...)`, so
    // a SECOND resolve that did not repeat `--recognition` silently pushed a
    // `known_recurring` entry back to `known_one_off`. No error, no notice, and
    // the reported case reached it by claiming input tax when the pièce turned
    // up — a call that has nothing to do with recognition at all.
    //
    // The default belongs to the FIRST resolve, which is the one deciding what
    // an unrecognized line was. After that the stored value stands until
    // somebody says otherwise.
    const recognition =
      data.recognition ??
      (entry.recognition === 'unrecognized'
        ? data.rule
          ? 'known_recurring'
          : 'known_one_off'
        : entry.recognition)
    const [updated] = await tx
      .update(booksEntry)
      .set({
        explanation: data.explanation,
        recognition,
        counterparty: data.counterparty === undefined ? entry.counterparty : data.counterparty,
        evidence_note: data.evidenceNote === undefined ? entry.evidence_note : data.evidenceNote,
        matched_rule_id: taughtRuleId ?? entry.matched_rule_id,
        history,
        ...(tva ?? {}),
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

/**
 * Resolve one RI entry — phase 4A closes the gap phase 2 left open: the
 * worklist has served RI rows since then, but nothing could resolve one.
 *
 * Same doctrine, one deliberate difference: there is NO account to fill,
 * because an RI entry has no lines — `data.account` is refused with words
 * rather than ignored. Rule teaching keys to the row's `source_id` (0012):
 * an imported RI line knows its feed, so the pair doctrine finally works for
 * simplified books too; a pre-import row teaches a sourceless rule, which is
 * exactly what rule 107 always was.
 */
export async function resolveRiEntry(
  workspaceId: number,
  entityId: number,
  entryNumber: number,
  data: ResolveData
): Promise<{ entry: BooksRiEntry; taughtRuleSeq: number | null }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(booksRiEntry)
      .where(
        and(
          eq(booksRiEntry.workspace_id, workspaceId),
          eq(booksRiEntry.entity_id, entityId),
          eq(booksRiEntry.seq, entryNumber)
        )
      )
      .limit(1)
    if (!row) {
      throw new ResolveRefused('not_found', `no entry #${entryNumber} in this book's recettes-dépenses journal`, 'bk books worklist lists the numbers')
    }
    if (row.deleted_at) {
      throw new ResolveRefused('deleted', `entry #${entryNumber} is deleted`, 'nothing to resolve')
    }
    if (data.account) {
      throw new ResolveRefused(
        'ri_no_lines',
        `entry #${entryNumber} is an RI entry: there are no lines to put an account on`,
        'a simplified book keeps recettes and dépenses, not a chart mapping — drop --account'
      )
    }
    if (data.direction !== undefined && !RI_DIRECTIONS.has(data.direction)) {
      throw new ResolveRefused(
        'bad_direction',
        `"${data.direction}" is not a direction a simplified book keeps`,
        'recette, depense, or neutral for a transfer between the owner\'s own accounts (art. 957 al. 2 CO keeps the movement, and it counts on neither side)'
      )
    }

    const was = {
      at: new Date().toISOString(),
      event: 'resolved',
      was: {
        recognition: row.recognition,
        direction: row.direction,
        counterparty: row.counterparty,
        explanation: row.explanation,
        matched_rule_id: row.matched_rule_id,
      },
    }
    const prior = row.history
    const history = Array.isArray(prior) ? [...prior, was] : prior ? [prior, was] : [was]

    let taughtRuleSeq: number | null = null
    let taughtRuleId: number | null = null
    if (data.rule) {
      const rule = await insertRule(tx, workspaceId, {
        entityId: row.entity_id,
        sourceId: row.source_id,
        pattern: {
          counterparty: data.rule.counterparty,
          amount_chf: data.rule.amount_chf ?? null,
          tolerance_chf: data.rule.tolerance_chf ?? null,
          interval: data.rule.interval ?? null,
        },
        explanation: data.explanation,
        accountNo: null,
        learnedFrom: data.rule.learnedFrom ?? 'manual',
        createdFromEntryId: row.id,
      })
      taughtRuleSeq = rule.seq
      taughtRuleId = rule.id
    }

    // The RI journal, same rule as the grand livre above (#67).
    const recognition =
      data.recognition ??
      (row.recognition === 'unrecognized'
        ? data.rule
          ? 'known_recurring'
          : 'known_one_off'
        : row.recognition)
    const [updated] = await tx
      .update(booksRiEntry)
      .set({
        explanation: data.explanation,
        recognition,
        direction: data.direction ?? row.direction,
        counterparty: data.counterparty === undefined ? row.counterparty : data.counterparty,
        evidence_note: data.evidenceNote === undefined ? row.evidence_note : data.evidenceNote,
        matched_rule_id: taughtRuleId ?? row.matched_rule_id,
        history,
        updated_at: new Date(),
      })
      .where(eq(booksRiEntry.id, row.id))
      .returning()

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
