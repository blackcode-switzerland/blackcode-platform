// The sources register: reads, and the wire shapes.
//
// Status is computed at read time from cadence against `last_import` — see
// `lib/derive/sources.ts` for why there is deliberately no status column.
// `today` travels in from the route so the derivation stays pure and the tests
// stay honest; a route passes the real date, a test passes a fixed one.

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksSource,
  booksSourcePull,
  booksRunbook,
  booksDriveManifest,
  booksEntity,
  booksEntry,
  booksEntryLine,
  booksExercice,
  booksOpeningBalance,
  type BooksSource,
  type BooksSourcePull,
  type BooksRunbook,
  type BooksDriveManifest,
} from '../schema'
import { sourceStatus, sourceWindows } from '../../derive/sources'
import { reconcile, type Reconciliation } from '../../derive/reconcile'
import type { DelimitedMapping } from '../../import/delimited'
import { nextSeq } from './imports'
import { accountsNotInChart } from './chart-guard'

export async function listSources(workspaceId: number, entityId?: number): Promise<BooksSource[]> {
  const conds = [eq(booksSource.workspace_id, workspaceId)]
  if (entityId) conds.push(eq(booksSource.entity_id, entityId))
  return getDb()
    .select()
    .from(booksSource)
    .where(and(...conds))
    .orderBy(asc(booksSource.seq))
}

export async function getSourceBySeq(workspaceId: number, seq: number): Promise<BooksSource | null> {
  const [row] = await getDb()
    .select()
    .from(booksSource)
    .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, seq)))
    .limit(1)
  return row ?? null
}

export async function pullsOf(sourceId: number): Promise<BooksSourcePull[]> {
  return getDb()
    .select()
    .from(booksSourcePull)
    .where(eq(booksSourcePull.source_id, sourceId))
    .orderBy(desc(booksSourcePull.pulled))
}

export async function runbookOf(sourceId: number): Promise<BooksRunbook | null> {
  const [row] = await getDb()
    .select()
    .from(booksRunbook)
    .where(eq(booksRunbook.source_id, sourceId))
    .limit(1)
  return row ?? null
}

export async function manifestOf(sourceId: number): Promise<BooksDriveManifest[]> {
  return getDb()
    .select()
    .from(booksDriveManifest)
    .where(eq(booksDriveManifest.source_id, sourceId))
    .orderBy(desc(booksDriveManifest.drive_created_time))
}

/** Slug of the entity a source belongs to, or null for the unattributed one. */
export async function entitySlugsById(workspaceId: number): Promise<Map<number, string>> {
  const rows = await getDb()
    .select({ id: booksEntity.id, slug: booksEntity.slug })
    .from(booksEntity)
    .where(eq(booksEntity.workspace_id, workspaceId))
  return new Map(rows.map((r) => [r.id, r.slug]))
}

// ===========================================================================
// THE WIRE SHAPES
// ===========================================================================

export function publicSource(s: BooksSource, today: string, entitySlug: string | null) {
  return {
    number: s.seq,
    name: s.name,
    type: s.type,
    layer: s.layer,
    entity: entitySlug,
    method: s.method,
    expected: s.expected,
    last_import: s.last_import,
    retired: s.retired,
    ledger_accounts: s.ledger_accounts,
    /** Computed, never stored. The register's whole point. */
    status: sourceStatus(s, today),
    windows: sourceWindows(s.expected),
    notes_freeform: s.notes_freeform,
  }
}

export function publicPull(p: BooksSourcePull) {
  return {
    file: p.file,
    period: p.period,
    format: p.format,
    hash: p.hash,
    drive_ref: p.drive_ref,
    pulled: p.pulled,
    // What the statement said it closed at — 0018. Null for a pull recorded by
    // hand, and for anything imported before that migration.
    closing_balance: p.closing_balance,
    closing_on: p.closing_on,
  }
}

/**
 * The bank reconciliation for one source: the ledger against what the bank last
 * reported. See `derive/reconcile.ts` for why this reports rather than refuses.
 *
 * It reads the MOST RECENT pull that carries a closing balance, not simply the
 * most recent pull — `source record-pull` writes a row with no statement behind
 * it, and a hand-recorded pull must not blank out a real reconciliation.
 */
export async function reconcileSource(source: BooksSource): Promise<Reconciliation> {
  const accounts = (source.ledger_accounts ?? []) as string[]
  if (accounts.length === 0 || source.entity_id === null) {
    return reconcile({ accounts, closing_balance: null, closing_on: null, openings: [], lines: [] })
  }

  const db = getDb()

  // A simplified book posts no lines, so summing them would report 0.00 and a
  // drift equal to the whole statement, forever. `reconcile` says so instead.
  const [book] = await db
    .select({ regime: booksEntity.bookkeeping_regime })
    .from(booksEntity)
    .where(eq(booksEntity.id, source.entity_id))
    .limit(1)
  if (book?.regime === 'simplified') {
    return reconcile({ keeps_ledger: false, accounts, closing_balance: null, closing_on: null, openings: [], lines: [] })
  }

  const [pull] = await db
    .select()
    .from(booksSourcePull)
    .where(and(eq(booksSourcePull.source_id, source.id), sql`${booksSourcePull.closing_balance} IS NOT NULL`))
    .orderBy(desc(booksSourcePull.closing_on))
    .limit(1)

  if (!pull) {
    return reconcile({ accounts, closing_balance: null, closing_on: null, openings: [], lines: [] })
  }

  // The query builder rather than raw SQL for the account list: a JS array
  // interpolated into `= ANY(...)` is parameterised as a string, not as a
  // Postgres array, and the route answered 500 until this was `inArray`.
  const openings = await db
    .select({ account_no: booksOpeningBalance.account_no, amount: booksOpeningBalance.amount })
    .from(booksOpeningBalance)
    .innerJoin(booksExercice, eq(booksExercice.id, booksOpeningBalance.exercice_id))
    .where(
      and(
        eq(booksExercice.entity_id, source.entity_id),
        sql`${pull.closing_on}::date BETWEEN ${booksExercice.starts_on} AND ${booksExercice.ends_on}`
      )
    )

  const lines = await db
    .select({
      account_no: booksEntryLine.account_no,
      debit: booksEntryLine.debit,
      credit: booksEntryLine.credit,
      date: booksEntry.date,
      status: booksEntry.status,
    })
    .from(booksEntryLine)
    .innerJoin(booksEntry, eq(booksEntry.id, booksEntryLine.entry_id))
    .where(
      and(
        eq(booksEntry.entity_id, source.entity_id),
        isNull(booksEntry.deleted_at),
        inArray(booksEntryLine.account_no, accounts)
      )
    )

  return reconcile({
    accounts,
    closing_balance: pull.closing_balance,
    closing_on: pull.closing_on,
    openings,
    lines,
  })
}

export function publicRunbook(r: BooksRunbook) {
  return {
    version: r.version,
    updated: r.updated,
    login_url: r.login_url,
    /** A vault reference. If a real secret ever appears here, that is the bug. */
    credential_ref: r.credential_ref,
    steps: r.steps,
    output: r.output,
  }
}

export function publicManifestRow(m: BooksDriveManifest, pieceSeq: number | null) {
  return {
    file_id: m.file_id,
    name: m.name,
    mime_type: m.mime_type,
    created_time: m.drive_created_time,
    fetched: m.fetched,
    state: m.state,
    archived: m.archived,
    archive_ref: m.archive_ref,
    /** The piece this file became, as its workspace #number. */
    piece: pieceSeq,
  }
}

// ---------------------------------------------------------------------------
// The register's write half (phase 4A) — what the Companion maintains
// ---------------------------------------------------------------------------
// Sources, runbooks and pull records are OPERATIONAL state (0008's grants
// doctrine): creating and editing them is normal register upkeep, not record
// mutation. The pulls themselves stay records — recordPull only ever adds.

/**
 * A source may only feed accounts this book's chart carries.
 *
 * 0016 put `trg_line_account_in_chart` on posting LINES, which catches a ghost
 * account at the first post — in a double-entry book. A simplified book never
 * posts a line, so its sources went unchecked entirely: found 2026-08-20, an RI
 * book carrying a card feed on account `1090`, which its 25-account chart has
 * never had and never will. The register pointed at nothing and nothing said so.
 *
 * Checked on the day the source is written rather than at the first import, for
 * the same reason `mappingRefusal` is: a feed that could never reconcile should
 * be refused while somebody is still looking at it.
 */
async function refuseGhostAccounts(
  tx: Parameters<typeof accountsNotInChart>[0],
  entityId: number,
  accounts: string[]
): Promise<void> {
  if (accounts.length === 0) return
  const ghosts = await accountsNotInChart(tx, entityId, accounts)
  if (ghosts.length > 0) {
    throw new SourceRefused(
      'account_not_in_chart',
      `this book's chart has no account ${ghosts.join(', ')}`,
      'bk books account list shows the chart — a card wants its OWN class 2 account, added with bk books account create'
    )
  }
}

export class SourceRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface CreateSourceData {
  entitySlug: string
  name: string
  type: string
  expected?: string | null
  ledgerAccounts?: string[]
  method?: string | null
  notes?: Record<string, unknown> | null
}

export async function createSource(workspaceId: number, data: CreateSourceData): Promise<BooksSource> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [entity] = await tx
      .select()
      .from(booksEntity)
      .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, data.entitySlug)))
      .limit(1)
    if (!entity) throw new SourceRefused('bad_entity', `no book with slug "${data.entitySlug}"`, 'bk books entity list')

    await refuseGhostAccounts(tx, entity.id, data.ledgerAccounts ?? [])

    const seq = await nextSeq(tx, workspaceId, 'source')
    const [row] = await tx
      .insert(booksSource)
      .values({
        workspace_id: workspaceId,
        entity_id: entity.id,
        seq,
        name: data.name,
        type: data.type,
        expected: data.expected ?? null,
        ledger_accounts: data.ledgerAccounts ?? [],
        method: data.method ?? null,
        notes_freeform: data.notes ?? null,
      })
      .returning()
    return row
  })
}

export interface UpdateSourceData {
  name?: string
  expected?: string | null
  ledgerAccounts?: string[]
  method?: string | null
  notes?: Record<string, unknown> | null
  retired?: boolean
  /** The source this one settles into — DATA-MODEL §10's chain. `null` clears. */
  drawsFromSeq?: number | null
  /** How to read this source's delimited export. `null` clears (camt.053). */
  importMapping?: DelimitedMapping | null
}

export async function updateSource(workspaceId: number, seq: number, data: UpdateSourceData): Promise<BooksSource> {
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (data.name !== undefined) patch.name = data.name
  if (data.expected !== undefined) patch.expected = data.expected
  if (data.ledgerAccounts !== undefined) {
    const [current] = await getDb()
      .select({ entity_id: booksSource.entity_id })
      .from(booksSource)
      .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, seq)))
      .limit(1)
    if (!current) throw new SourceRefused('source_not_found', `no source #${seq}`, 'bk books source list shows the numbers')
    if (current.entity_id !== null) await refuseGhostAccounts(getDb(), current.entity_id, data.ledgerAccounts)
    patch.ledger_accounts = data.ledgerAccounts
  }
  if (data.method !== undefined) patch.method = data.method
  if (data.notes !== undefined) patch.notes_freeform = data.notes
  if (data.retired !== undefined) patch.retired = data.retired

  if (data.importMapping !== undefined) {
    if (data.importMapping !== null) {
      const bad = mappingRefusal(data.importMapping)
      if (bad) throw new SourceRefused('bad_mapping', bad, 'bk guide books/money-in shows a worked mapping')
    }
    patch.import_mapping = data.importMapping
  }

  // The chain is set by SOURCE NUMBER, never by database id: #numbers are what
  // `bk books source list` shows and what a person can read back.
  if (data.drawsFromSeq !== undefined) {
    if (data.drawsFromSeq === null) patch.draws_from = null
    else {
      if (data.drawsFromSeq === seq) {
        throw new SourceRefused(
          'draws_from_itself',
          `source #${seq} cannot settle into itself`,
          'name the account it settles INTO — usually the bank'
        )
      }
      const [parent] = await getDb()
        .select({ id: booksSource.id })
        .from(booksSource)
        .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, data.drawsFromSeq)))
        .limit(1)
      if (!parent) {
        throw new SourceRefused(
          'draws_from_not_found',
          `no source #${data.drawsFromSeq} to settle into`,
          'bk books source list shows the numbers'
        )
      }
      patch.draws_from = parent.id
    }
  }

  const [row] = await getDb()
    .update(booksSource)
    .set(patch)
    .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, seq)))
    .returning()
  if (!row) throw new SourceRefused('source_not_found', `no source #${seq}`, 'bk books source list shows the numbers')
  return row
}

/**
 * Is this mapping usable at all? Shape only — whether it FITS a given file is
 * `parseDelimited`'s answer, and it names the header it actually found.
 *
 * Checked here so a mapping that could never read anything is refused on the
 * day it is written, rather than on the morning somebody imports with it.
 */
function mappingRefusal(m: DelimitedMapping): string | null {
  if (typeof m.delimiter !== 'string' || m.delimiter.length !== 1) {
    return 'delimiter must be exactly one character (write a tab as "\\t")'
  }
  if (typeof m.header !== 'boolean') return 'header must be true or false'
  if (!m.columns || typeof m.columns.date !== 'string' || typeof m.columns.label !== 'string') {
    return 'columns.date and columns.label are required: a line with no date or no narrative cannot be booked or recognized'
  }
  const pair = m.columns.debit !== undefined || m.columns.credit !== undefined
  if (pair === (m.columns.amount !== undefined)) {
    return 'name EITHER columns.amount OR a columns.debit/columns.credit pair — never both and never neither'
  }
  if (!['YYYY-MM-DD', 'DD.MM.YYYY', 'MM/DD/YYYY'].includes(m.date_format)) {
    return 'date_format must be YYYY-MM-DD, DD.MM.YYYY or MM/DD/YYYY — no free-form dates'
  }
  if (m.decimal !== '.' && m.decimal !== ',') return 'decimal must be "." or ","'
  if (m.positive_means !== 'credit' && m.positive_means !== 'debit') {
    return 'positive_means must be "credit" or "debit": say which way a positive number runs, because the file cannot'
  }
  return null
}

export interface RecordPullData {
  file: string
  period?: string | null
  format?: string | null
  hash?: string | null
  driveRef?: string | null
  pulled?: string | null
}

/**
 * Record a pull the door did not make itself — the Stripe CSV, the PDF the
 * Companion parked in Drive. Idempotent on (source, file): the first delivery
 * is the record, a retry converges.
 */
export async function recordPull(
  workspaceId: number,
  sourceSeq: number,
  data: RecordPullData
): Promise<{ pull: BooksSourcePull; created: boolean }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(booksSource)
      .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, sourceSeq)))
      .limit(1)
    if (!source) throw new SourceRefused('source_not_found', `no source #${sourceSeq}`, 'bk books source list shows the numbers')
    if (source.retired) throw new SourceRefused('source_retired', `source #${sourceSeq} is retired`, 'a retired source takes no new pulls')

    const inserted = await tx
      .insert(booksSourcePull)
      .values({
        workspace_id: workspaceId,
        source_id: source.id,
        file: data.file,
        period: data.period ?? null,
        format: data.format ?? null,
        hash: data.hash ?? null,
        drive_ref: data.driveRef ?? null,
        pulled: data.pulled ?? sql`CURRENT_DATE`,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length > 0) {
      const pulledDate = data.pulled ?? null
      await tx
        .update(booksSource)
        .set({
          last_import: pulledDate
            ? sql`GREATEST(COALESCE(${booksSource.last_import}, '1900-01-01'::date), ${pulledDate}::date)`
            : sql`GREATEST(COALESCE(${booksSource.last_import}, '1900-01-01'::date), CURRENT_DATE)`,
          updated_at: new Date(),
        })
        .where(eq(booksSource.id, source.id))
      return { pull: inserted[0], created: true }
    }

    const [existing] = await tx
      .select()
      .from(booksSourcePull)
      .where(and(eq(booksSourcePull.source_id, source.id), eq(booksSourcePull.file, data.file)))
      .limit(1)
    return { pull: existing, created: false }
  })
}

export interface SetRunbookData {
  version?: string
  updated?: string | null
  loginUrl?: string | null
  credentialRef?: string | null
  steps?: unknown[]
  output?: string | null
}

/**
 * Set or update a source's runbook — one per source, versioned in place
 * (history belongs to git, 0008's header). `credential_ref` is a REFERENCE;
 * anything that looks like a secret is refused at the door, because this
 * table must never hold one.
 */
export async function setRunbook(workspaceId: number, sourceSeq: number, data: SetRunbookData): Promise<BooksRunbook> {
  const ref = data.credentialRef ?? null
  if (ref && !/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    throw new SourceRefused(
      'credential_not_a_ref',
      'credential_ref must be a REFERENCE (vault://…, op://…), never a credential',
      'store the secret in the vault and pass its address'
    )
  }

  const db = getDb()
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(booksSource)
      .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, sourceSeq)))
      .limit(1)
    if (!source) throw new SourceRefused('source_not_found', `no source #${sourceSeq}`, 'bk books source list shows the numbers')

    const values = {
      workspace_id: workspaceId,
      source_id: source.id,
      version: data.version ?? '1.0',
      updated: data.updated ?? sql`CURRENT_DATE`,
      login_url: data.loginUrl ?? null,
      credential_ref: ref,
      steps: data.steps ?? [],
      output: data.output ?? null,
    }
    const [row] = await tx
      .insert(booksRunbook)
      .values(values)
      .onConflictDoUpdate({
        target: booksRunbook.source_id,
        set: { ...values, updated_at: new Date() },
      })
      .returning()
    return row
  })
}
