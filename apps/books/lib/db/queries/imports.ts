// The bank import door — write path #1 of the spec's "deliberately few".
//
// ===========================================================================
// ONE FILE, ONE TRANSACTION, WHOLE OR NOT AT ALL
// ===========================================================================
// A camt.053 statement is the bank's own account of a period. It lands whole:
// every new line staged in the right journal, the pull recorded, the
// register's last_import moved — or none of it, with the refusal naming the
// line that broke it. A half-imported statement is exactly the gap
// investigation the sources register exists to prevent.
//
// ===========================================================================
// WHAT HAPPENS TO EACH LINE
// ===========================================================================
//   1. CONVERGE   same (source, bank_ref) already in the book: skip, count.
//   2. STAGE      entry (double-entry: bank side filled, other side NULL) or
//                 ri_entry (credit -> recette, debit -> depense) — always
//                 staged, always unrecognized first.
//   3. SUGGEST    `matchesRule` runs at arrival — the phase 2 promise kept.
//                 A clean hit marks the row `inferred` with its rule. The
//                 machine never applies: a human (or their agent) confirms
//                 via resolve, exactly as on the worklist.
//   4. REMEMBER   the fx story when the bank converted (0011's writer).
//
// Numbering: `seq` comes from books.counters (initialised from the existing
// maximum, so seeded books and imports share one sequence); `entry_no` stays
// gapless per (book, year) by taking MAX+1 inside the same transaction. The
// counters row lock serialises two concurrent imports of the same workspace.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksEntry,
  booksEntryLine,
  booksRiEntry,
  booksEntity,
  booksExercice,
  booksSource,
  booksSourcePull,
  booksCounters,
} from '../schema'
import { parseCamt053, verifyCamt, CamtRefused, type CamtLine } from '../../import/camt053'
import { listRules } from './rules'
import { matchesRule } from '../../derive/recognition'

export class ImportRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public problems: string[] = []
  ) {
    super(message)
  }
}

export interface ImportSummary {
  source: number
  file: string
  journal: 'grand_livre' | 'recettes_depenses'
  period: { from: string | null; to: string | null }
  opening: string
  closing: string
  lines_total: number
  imported: number
  inferred: number
  unrecognized: number
  /** Lines already in the book from an earlier statement: converged, not duplicated. */
  already_known: number
  with_fx: number
  /** Workspace #numbers of the newly staged rows, in file order. */
  staged: number[]
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** Next workspace seq for an entity type, seeded from the table's own maximum. */
async function nextSeq(tx: Tx, workspaceId: number, entityType: 'entry' | 'ri_entry'): Promise<number> {
  const table = entityType === 'entry' ? 'entry' : 'ri_entry'
  const r = await tx.execute(sql`
    INSERT INTO ${booksCounters} (workspace_id, entity_type, last_value)
    VALUES (
      ${workspaceId}, ${entityType},
      COALESCE((SELECT MAX(seq) FROM ${sql.raw(`books.${table}`)} WHERE workspace_id = ${workspaceId}), 0) + 1
    )
    ON CONFLICT (workspace_id, entity_type)
      DO UPDATE SET last_value = GREATEST(
        ${booksCounters}.last_value,
        COALESCE((SELECT MAX(seq) FROM ${sql.raw(`books.${table}`)} WHERE workspace_id = ${workspaceId}), 0)
      ) + 1
    RETURNING last_value
  `)
  return Number((r.rows[0] as { last_value: number }).last_value)
}

export async function importCamt(
  workspaceId: number,
  sourceSeq: number,
  fileName: string,
  xml: string,
  fileSha256: string
): Promise<ImportSummary> {
  // Parse and verify OUTSIDE the transaction: a refused file touches nothing.
  let stmt
  try {
    stmt = parseCamt053(xml)
  } catch (e) {
    if (e instanceof CamtRefused) throw new ImportRefused(e.code, e.message)
    throw e
  }
  const problems = verifyCamt(stmt)
  if (problems.length > 0) {
    throw new ImportRefused('does_not_reconcile', 'the file does not reconcile against itself', problems)
  }
  if (stmt.currency !== 'CHF') {
    throw new ImportRefused(
      'not_chf',
      `a ${stmt.currency} statement cannot land in a CHF book — foreign-currency ACCOUNTS are not built (fx on single movements is, 0011)`
    )
  }

  const db = getDb()
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(booksSource)
      .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, sourceSeq)))
      .limit(1)
    if (!source) throw new ImportRefused('source_not_found', `no source #${sourceSeq}`, ['bk books source list shows the numbers'])
    if (source.retired) throw new ImportRefused('source_retired', `source #${sourceSeq} is retired`, ['a retired source takes no new files'])
    if (source.entity_id === null) {
      throw new ImportRefused('source_unattached', `source #${sourceSeq} belongs to no book`, ['attach it to a book first'])
    }

    const [entity] = await tx.select().from(booksEntity).where(eq(booksEntity.id, source.entity_id)).limit(1)
    if (!entity) throw new ImportRefused('source_unattached', `source #${sourceSeq}'s book is gone`)
    const simplified = entity.bookkeeping_regime === 'simplified'
    const journal = simplified ? ('recettes_depenses' as const) : ('grand_livre' as const)

    const ledgerAccount = (source.ledger_accounts ?? [])[0] ?? null
    if (!simplified && !ledgerAccount) {
      throw new ImportRefused('no_ledger_account', `source #${sourceSeq} names no ledger account`, [
        'a double-entry book must know which account this feed IS (e.g. 1020)',
      ])
    }

    // Exercices, by year of booking date. Refuse lines outside an open year
    // BEFORE anything lands — whole or not at all.
    const exercices = await tx
      .select()
      .from(booksExercice)
      .where(eq(booksExercice.entity_id, entity.id))
    const byYear = new Map(exercices.map((x) => [x.year, x]))
    const yearProblems: string[] = []
    for (const l of stmt.lines) {
      const x = byYear.get(Number(l.booked.slice(0, 4)))
      if (!x) yearProblems.push(`${l.ref}: booked ${l.booked}, and the book has no exercice ${l.booked.slice(0, 4)}`)
      else if (x.status === 'closed') yearProblems.push(`${l.ref}: booked ${l.booked} into CLOSED exercice ${x.year}`)
    }
    if (yearProblems.length > 0) {
      throw new ImportRefused('no_open_exercice', 'lines fall outside an open exercice', [
        ...yearProblems,
        'open the year first: bk books exercice create',
      ])
    }

    // Which refs already landed (an overlapping statement converges).
    const refs = stmt.lines.map((l) => l.ref)
    const existing = new Set<string>()
    if (refs.length > 0) {
      if (simplified) {
        const rows = await tx
          .select({ ref: booksRiEntry.bank_ref })
          .from(booksRiEntry)
          .where(and(eq(booksRiEntry.source_id, source.id), inArray(booksRiEntry.bank_ref, refs)))
        for (const r of rows) if (r.ref) existing.add(r.ref)
      } else {
        const rows = await tx
          .select({ ref: booksEntry.bank_ref })
          .from(booksEntry)
          .where(and(eq(booksEntry.source_id, source.id), inArray(booksEntry.bank_ref, refs)))
        for (const r of rows) if (r.ref) existing.add(r.ref)
      }
    }

    const rules = await listRules(entity.id, { active: true })
    const matchable = rules.map((r) => ({
      id: r.id,
      source_id: r.source_id,
      active: r.active,
      pattern: r.pattern as { counterparty?: string | null; amount_chf?: number | null; tolerance_chf?: number | null } | null,
    }))

    // entry_no: gapless per (book, year). MAX+1 inside this transaction.
    const nextEntryNo = new Map<number, number>()
    const entryNoFor = async (exerciceId: number): Promise<number> => {
      if (!nextEntryNo.has(exerciceId)) {
        const r = await tx.execute(sql`
          SELECT COALESCE(MAX(entry_no), 0) AS n FROM books.entry WHERE exercice_id = ${exerciceId}`)
        nextEntryNo.set(exerciceId, Number((r.rows[0] as { n: number }).n))
      }
      const n = (nextEntryNo.get(exerciceId) ?? 0) + 1
      nextEntryNo.set(exerciceId, n)
      return n
    }

    const staged: number[] = []
    let inferred = 0
    let withFx = 0

    for (const line of stmt.lines) {
      if (existing.has(line.ref)) continue

      const exercice = byYear.get(Number(line.booked.slice(0, 4)))!
      const fired = matchable.filter((r) =>
        matchesRule(
          { source_id: source.id, raw_label: line.label, lines: [{ debit: line.amount, credit: 0 }] },
          r
        )
      )
      const recognition = fired.length > 0 ? 'inferred' : 'unrecognized'
      const matchedRuleId = fired.length > 0 ? fired[0].id : null
      if (fired.length > 0) inferred++
      if (line.fx) withFx++

      if (simplified) {
        const seq = await nextSeq(tx, workspaceId, 'ri_entry')
        await tx.insert(booksRiEntry).values({
          workspace_id: workspaceId,
          entity_id: entity.id,
          exercice_id: exercice.id,
          seq,
          date: line.booked,
          direction: line.direction === 'credit' ? 'recette' : 'depense',
          amount: line.amount,
          raw_label: line.label,
          counterparty: line.counterparty,
          recognition,
          matched_rule_id: matchedRuleId,
          evidence_tier: 'bare',
          fx: line.fx,
          bank_ref: line.ref,
          source_id: source.id,
        })
        staged.push(seq)
      } else {
        const seq = await nextSeq(tx, workspaceId, 'entry')
        const [e] = await tx
          .insert(booksEntry)
          .values({
            workspace_id: workspaceId,
            entity_id: entity.id,
            exercice_id: exercice.id,
            seq,
            entry_no: await entryNoFor(exercice.id),
            date: line.booked,
            status: 'staged',
            source_id: source.id,
            raw_label: line.label,
            counterparty: line.counterparty,
            recognition,
            matched_rule_id: matchedRuleId,
            evidence_tier: 'bare',
            fx: line.fx,
            bank_ref: line.ref,
          })
          .returning({ id: booksEntry.id })
        // The bank side is a FACT (this feed IS that account); the other side
        // is honestly NULL until somebody says what the money was for.
        const bankSide = { entry_id: e.id, account_no: ledgerAccount, position: 1 }
        const openSide = { entry_id: e.id, account_no: null as string | null, position: 2 }
        if (line.direction === 'credit') {
          await tx
            .insert(booksEntryLine)
            .values([
              { ...bankSide, debit: line.amount, credit: '0' },
              { ...openSide, debit: '0', credit: line.amount },
            ])
        } else {
          await tx
            .insert(booksEntryLine)
            .values([
              { ...openSide, debit: line.amount, credit: '0', position: 1 },
              { ...bankSide, debit: '0', credit: line.amount, position: 2 },
            ])
        }
        staged.push(seq)
      }
    }

    // The pull record: first delivery is the record; a re-import converges.
    await tx.execute(sql`
      INSERT INTO ${booksSourcePull} (workspace_id, source_id, file, period, format, hash, pulled)
      VALUES (
        ${workspaceId}, ${source.id}, ${fileName},
        ${stmt.from && stmt.to ? `${stmt.from} → ${stmt.to}` : null},
        'camt.053', ${'sha256:' + fileSha256}, CURRENT_DATE
      )
      ON CONFLICT (source_id, file) DO NOTHING
    `)

    const lastDate = stmt.to ?? stmt.lines.at(-1)?.booked ?? null
    if (lastDate) {
      await tx
        .update(booksSource)
        .set({
          last_import: sql`GREATEST(COALESCE(${booksSource.last_import}, '1900-01-01'::date), ${lastDate}::date)`,
          updated_at: new Date(),
        })
        .where(eq(booksSource.id, source.id))
    }

    return {
      source: source.seq,
      file: fileName,
      journal,
      period: { from: stmt.from, to: stmt.to },
      opening: stmt.opening,
      closing: stmt.closing,
      lines_total: stmt.lines.length,
      imported: staged.length,
      inferred,
      unrecognized: staged.length - inferred,
      already_known: stmt.lines.length - staged.length,
      with_fx: withFx,
      staged,
    }
  })
}

/**
 * Posting: staged -> posted, after review — write path #4 of the spec.
 *
 * The route flips ONE column and the 0004 guard speaks at COMMIT: balanced,
 * at least two lines, every line mapped to an account. This function only
 * adds the refusals that deserve better words than a trigger's.
 */
export class PostRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export async function postEntry(
  workspaceId: number,
  entrySeq: number
): Promise<{ number: number; entry_no: number; status: string; already: boolean }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(booksEntry)
      .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, entrySeq), isNull(booksEntry.deleted_at)))
      .limit(1)
    if (!entry) {
      throw new PostRefused('entry_not_found', `no entry #${entrySeq}`, 'bk books entry list shows the numbers — note that an RI journal has no posting lifecycle')
    }
    if (entry.status === 'posted') {
      return { number: entry.seq, entry_no: entry.entry_no, status: 'posted', already: true }
    }

    const lines = await tx.select().from(booksEntryLine).where(eq(booksEntryLine.entry_id, entry.id))
    const unmapped = lines.filter((l) => l.account_no === null).length
    if (unmapped > 0) {
      throw new PostRefused(
        'unresolved_lines',
        `entry #${entrySeq} has ${unmapped} line(s) with no account`,
        'resolve it first: bk books resolve <n> --account <no> --explanation <what it was>'
      )
    }

    await tx.update(booksEntry).set({ status: 'posted', updated_at: new Date() }).where(eq(booksEntry.id, entry.id))
    // 0004's deferred guard asserts balance and mapping again at COMMIT —
    // the database has the last word, this function just words it earlier.
    return { number: entry.seq, entry_no: entry.entry_no, status: 'posted', already: false }
  })
}
