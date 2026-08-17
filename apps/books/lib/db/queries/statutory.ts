// The reads phase 1 serves, and the one write the CLI needs.
//
// ===========================================================================
// THE API SHAPE IS THE MOCKUP'S SHAPE
// ===========================================================================
// The columns are FLAT and the payload is NESTED, on purpose. `piece_drive_ref`
// becomes `piece.drive_ref`, `tva_rate` becomes `tva.rate`, because the frontend
// codes against `bbooks-data.js` and every rename it has to absorb is a component
// somebody rewrites for nothing.
//
// The nesting happens in the `public*` functions at the bottom of this file, which
// are the ONLY place a database row becomes a wire object. Route handlers call
// them and never spread a row.
//
// `drive_ref` keeps that name even though the column is `piece_drive_ref` and even
// though phase 3 replaces the pipeline behind it. The frontend should not have to
// care that it changed.
//
// ===========================================================================
// SEQ IS EXPOSED AS `number`. THE SERIAL `id` IS NEVER EXPOSED.
// ===========================================================================
// `bk books entry show 42` takes the workspace #number, and a URN carries it.
// `entry_no` is exposed too and separately, because it is the statutory journal
// number and a reader comparing against a filing needs it.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksAccount,
  booksCounters,
  booksEntity,
  booksEntry,
  booksEntryLine,
  booksExercice,
  booksOpeningBalance,
  booksPatrimoine,
  booksRiEntry,
  type BooksAccount,
  type BooksEntity,
  type BooksExercice,
} from '../schema'
import {
  bilanFor,
  crFor,
  riTotals,
  toCentimes,
  fromCentimes,
  type BilanResult,
  type CrResult,
  type ChartAccount,
  type PostingLine,
} from '../../derive'

// ---------------------------------------------------------------------------
// Books and years
// ---------------------------------------------------------------------------

export async function listEntities(workspaceId: number): Promise<BooksEntity[]> {
  return getDb()
    .select()
    .from(booksEntity)
    .where(and(eq(booksEntity.workspace_id, workspaceId), isNull(booksEntity.deleted_at)))
    .orderBy(asc(booksEntity.seq))
}

export async function getEntityBySlug(
  workspaceId: number,
  slug: string
): Promise<BooksEntity | null> {
  const [row] = await getDb()
    .select()
    .from(booksEntity)
    .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, slug)))
    .limit(1)
  return row ?? null
}

/**
 * Create a book.
 *
 * The #number comes from `books.counters`, allocated inside the transaction so two
 * concurrent creates cannot collide on it.
 *
 * There is no validation here that an SA must keep double-entry books: migration
 * 0004 has a CHECK, so the illegal state cannot be represented and a check here
 * would be a second, weaker copy of it.
 */
export async function createEntity(
  workspaceId: number,
  data: {
    slug: string
    name: string
    legal_form: string
    bookkeeping_regime: string
    seat?: string | null
  }
): Promise<BooksEntity> {
  return getDb().transaction(async (tx) => {
    const seq = await allocateSeq(tx, workspaceId, 'entity')
    const [row] = await tx
      .insert(booksEntity)
      .values({
        workspace_id: workspaceId,
        seq,
        slug: data.slug,
        name: data.name,
        legal_form: data.legal_form,
        bookkeeping_regime: data.bookkeeping_regime,
        seat: data.seat ?? null,
      })
      .returning()
    return row
  })
}

export async function listExercices(
  workspaceId: number,
  entityId?: number
): Promise<BooksExercice[]> {
  const where = entityId
    ? and(eq(booksExercice.workspace_id, workspaceId), eq(booksExercice.entity_id, entityId))
    : eq(booksExercice.workspace_id, workspaceId)
  return getDb().select().from(booksExercice).where(where).orderBy(desc(booksExercice.year))
}

export async function createExercice(
  workspaceId: number,
  data: { entityId: number; year: number }
): Promise<BooksExercice> {
  const [row] = await getDb()
    .insert(booksExercice)
    .values({
      workspace_id: workspaceId,
      entity_id: data.entityId,
      year: data.year,
      // Calendar year. `entity.fiscal_year` records the convention and every
      // seeded book uses `calendar`; a non-calendar year is a phase 2 conversation
      // rather than a silent guess here.
      starts_on: `${data.year}-01-01`,
      ends_on: `${data.year}-12-31`,
    })
    .returning()
  return row
}

/** Resolve `?entity=slug&exercice=2026` to ids, or explain what is missing. */
export async function resolveScope(
  workspaceId: number,
  entitySlug: string | null,
  year: number | null
): Promise<{ entity: BooksEntity; exercice: BooksExercice } | { error: string; suggestion: string }> {
  const entities = await listEntities(workspaceId)
  if (entities.length === 0) {
    return { error: 'no books exist in this workspace', suggestion: 'create one with `bk books entity create`' }
  }
  const entity = entitySlug ? entities.find((e) => e.slug === entitySlug) : entities[0]
  if (!entity) {
    return {
      error: `no book with slug "${entitySlug}"`,
      suggestion: `known books: ${entities.map((e) => e.slug).join(', ')}`,
    }
  }
  const years = await listExercices(workspaceId, entity.id)
  if (years.length === 0) {
    return {
      error: `book "${entity.slug}" has no exercice`,
      suggestion: 'create one with `bk books exercice create --year 2026`',
    }
  }
  const exercice = year ? years.find((x) => x.year === year) : years[0]
  if (!exercice) {
    return {
      error: `book "${entity.slug}" has no exercice ${year}`,
      suggestion: `known years: ${years.map((x) => x.year).join(', ')}`,
    }
  }
  return { entity, exercice }
}

// ---------------------------------------------------------------------------
// The chart, and the raw material the derivations need
// ---------------------------------------------------------------------------

export async function listAccounts(entityId: number): Promise<BooksAccount[]> {
  return getDb()
    .select()
    .from(booksAccount)
    .where(eq(booksAccount.entity_id, entityId))
    .orderBy(asc(booksAccount.no))
}

/**
 * Every posting line for one (entity, exercice), with its entry's status.
 *
 * The status travels WITH the line because `movement` filters on it: a derivation
 * that received lines without knowing whether they were posted would silently put
 * staged money on a statutory statement.
 */
async function postingLines(entityId: number, exerciceId: number): Promise<PostingLine[]> {
  const rows = await getDb()
    .select({
      account_no: booksEntryLine.account_no,
      debit: booksEntryLine.debit,
      credit: booksEntryLine.credit,
      status: booksEntry.status,
    })
    .from(booksEntryLine)
    .innerJoin(booksEntry, eq(booksEntry.id, booksEntryLine.entry_id))
    .where(
      and(
        eq(booksEntry.entity_id, entityId),
        eq(booksEntry.exercice_id, exerciceId),
        isNull(booksEntry.deleted_at)
      )
    )
  return rows
}

async function openingMap(entityId: number, exerciceId: number): Promise<Map<string, bigint>> {
  const rows = await getDb()
    .select()
    .from(booksOpeningBalance)
    .where(
      and(
        eq(booksOpeningBalance.entity_id, entityId),
        eq(booksOpeningBalance.exercice_id, exerciceId)
      )
    )
  // A missing account means zero, not an error: the sole proprietorship has no
  // opening balances at all, which is correct rather than incomplete data.
  return new Map(rows.map((r) => [r.account_no, toCentimes(r.amount)]))
}

function chartOf(accounts: BooksAccount[]): ChartAccount[] {
  return accounts.map((a) => ({
    no: a.no,
    class: Number(a.class),
    statement: a.statement,
    statement_position: a.statement_position,
  }))
}

// ---------------------------------------------------------------------------
// The statements
// ---------------------------------------------------------------------------

export async function getBilan(entityId: number, exerciceId: number): Promise<BilanResult> {
  const [lines, accounts, openings] = await Promise.all([
    postingLines(entityId, exerciceId),
    listAccounts(entityId),
    openingMap(entityId, exerciceId),
  ])
  return bilanFor(lines, chartOf(accounts), openings)
}

export async function getCr(entityId: number, exerciceId: number): Promise<CrResult> {
  const [lines, accounts] = await Promise.all([
    postingLines(entityId, exerciceId),
    listAccounts(entityId),
  ])
  return crFor(lines, chartOf(accounts))
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface EntryWithLines {
  entry: typeof booksEntry.$inferSelect
  lines: (typeof booksEntryLine.$inferSelect)[]
}

export async function listEntries(
  entityId: number,
  exerciceId: number,
  opts: { status?: string; recognition?: string; account?: string; limit?: number } = {}
): Promise<EntryWithLines[]> {
  const db = getDb()
  const conds = [
    eq(booksEntry.entity_id, entityId),
    eq(booksEntry.exercice_id, exerciceId),
    isNull(booksEntry.deleted_at),
  ]
  if (opts.status) conds.push(eq(booksEntry.status, opts.status))
  if (opts.recognition) conds.push(eq(booksEntry.recognition, opts.recognition))

  const entries = await db
    .select()
    .from(booksEntry)
    .where(and(...conds))
    .orderBy(asc(booksEntry.entry_no))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))

  if (entries.length === 0) return []
  const ids = entries.map((e) => e.id)
  const lines = await db
    .select()
    .from(booksEntryLine)
    .where(sql`${booksEntryLine.entry_id} IN ${ids}`)
    .orderBy(asc(booksEntryLine.position))

  const byEntry = new Map<number, (typeof booksEntryLine.$inferSelect)[]>()
  for (const l of lines) {
    const list = byEntry.get(l.entry_id) ?? []
    list.push(l)
    byEntry.set(l.entry_id, list)
  }

  let out = entries.map((e) => ({ entry: e, lines: byEntry.get(e.id) ?? [] }))
  // Filtering by account is done here rather than in SQL because an entry is
  // shown WHOLE: the grand livre lists every line of any entry that touches the
  // account, not just the matching line.
  if (opts.account) {
    out = out.filter((r) => r.lines.some((l) => l.account_no === opts.account))
  }
  return out
}

export async function getEntryByNumber(
  workspaceId: number,
  number: number
): Promise<EntryWithLines | null> {
  const db = getDb()
  const [entry] = await db
    .select()
    .from(booksEntry)
    .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, number)))
    .limit(1)
  if (!entry) return null
  const lines = await db
    .select()
    .from(booksEntryLine)
    .where(eq(booksEntryLine.entry_id, entry.id))
    .orderBy(asc(booksEntryLine.position))
  return { entry, lines }
}

export async function listRiEntries(
  entityId: number,
  exerciceId: number
): Promise<(typeof booksRiEntry.$inferSelect)[]> {
  return getDb()
    .select()
    .from(booksRiEntry)
    .where(
      and(
        eq(booksRiEntry.entity_id, entityId),
        eq(booksRiEntry.exercice_id, exerciceId),
        isNull(booksRiEntry.deleted_at)
      )
    )
    .orderBy(asc(booksRiEntry.date))
}

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------

export interface OverviewBook {
  slug: string
  name: string
  legal_form: string
  exercice: number | null
  /** Present for double-entry books. A sole proprietorship has no bilan, ever. */
  bilan: { actif: string; passif: string; balanced: boolean; resultat: string } | null
  /** Present for the single-entry book instead. */
  ri: { recettes: string; depenses: string; resultat: string } | null
  entries: number
  /** Entries needing a human. This is the Reconnaissance worklist's count. */
  unrecognized: number
  staged: number
}

/**
 * One row per book, with whichever statement its legal form actually has.
 *
 * `bilan` and `ri` are deliberately separate nullable fields rather than one
 * polymorphic `result`. An RI has no balance sheet under art. 957 al. 2, and a
 * shared shape would invite a caller to render one.
 */
export async function getOverview(workspaceId: number): Promise<OverviewBook[]> {
  const entities = await listEntities(workspaceId)
  const out: OverviewBook[] = []

  for (const e of entities) {
    const years = await listExercices(workspaceId, e.id)
    const x = years[0]
    if (!x) {
      out.push({
        slug: e.slug,
        name: e.name,
        legal_form: e.legal_form,
        exercice: null,
        bilan: null,
        ri: null,
        entries: 0,
        unrecognized: 0,
        staged: 0,
      })
      continue
    }

    const simplified = e.bookkeeping_regime === 'simplified'
    let bilan: OverviewBook['bilan'] = null
    let ri: OverviewBook['ri'] = null

    if (simplified) {
      const rows = await listRiEntries(e.id, x.id)
      const t = riTotals(rows.map((r) => ({ direction: r.direction, amount: r.amount })))
      ri = t
    } else {
      const b = await getBilan(e.id, x.id)
      bilan = {
        actif: b.totalActif,
        passif: b.totalPassif,
        balanced: b.balanced,
        resultat: b.resultat,
      }
    }

    const counts = await getDb()
      .select({
        total: sql<number>`count(*)::int`,
        unrecognized: sql<number>`count(*) FILTER (WHERE ${booksEntry.recognition} = 'unrecognized')::int`,
        staged: sql<number>`count(*) FILTER (WHERE ${booksEntry.status} = 'staged')::int`,
      })
      .from(booksEntry)
      .where(
        and(
          eq(booksEntry.entity_id, e.id),
          eq(booksEntry.exercice_id, x.id),
          isNull(booksEntry.deleted_at)
        )
      )

    out.push({
      slug: e.slug,
      name: e.name,
      legal_form: e.legal_form,
      exercice: x.year,
      bilan,
      ri,
      entries: counts[0]?.total ?? 0,
      unrecognized: counts[0]?.unrecognized ?? 0,
      staged: counts[0]?.staged ?? 0,
    })
  }

  return out
}

export async function getPatrimoine(
  entityId: number
): Promise<(typeof booksPatrimoine.$inferSelect)[]> {
  return getDb()
    .select()
    .from(booksPatrimoine)
    .where(eq(booksPatrimoine.entity_id, entityId))
    .orderBy(desc(booksPatrimoine.as_of))
}

// ---------------------------------------------------------------------------
// #number allocation
// ---------------------------------------------------------------------------

/**
 * Next workspace #number for an entity type.
 *
 * `ON CONFLICT DO UPDATE ... RETURNING` in one statement, so the read and the
 * increment cannot interleave. Two concurrent creates get two numbers.
 */
async function allocateSeq(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  workspaceId: number,
  entityType: string
): Promise<number> {
  const r = await tx.execute(sql`
    INSERT INTO ${booksCounters} (workspace_id, entity_type, last_value)
    VALUES (${workspaceId}, ${entityType}, 1)
    ON CONFLICT (workspace_id, entity_type)
      DO UPDATE SET last_value = ${booksCounters}.last_value + 1
    RETURNING last_value
  `)
  return Number((r.rows[0] as { last_value: number }).last_value)
}

// ===========================================================================
// THE WIRE SHAPES — the only place a row becomes a payload
// ===========================================================================

export function publicEntity(e: BooksEntity) {
  return {
    number: e.seq,
    slug: e.slug,
    name: e.name,
    legal_form: e.legal_form,
    seat: e.seat,
    bookkeeping_regime: e.bookkeeping_regime,
    regime_election: e.regime_election,
    regime_note: e.regime_note,
    fiscal_year: e.fiscal_year,
    // Nested to match the mockup, where VAT is a block rather than four columns.
    vat: {
      registered: e.vat_registered,
      method: e.vat_method,
      filing: e.vat_filing,
      note: e.vat_note,
    },
    audit_status: e.audit_status,
    fte_count: e.fte_count,
    accent: e.accent,
  }
}

export function publicExercice(x: BooksExercice) {
  return {
    year: x.year,
    starts_on: x.starts_on,
    ends_on: x.ends_on,
    status: x.status,
  }
}

export function publicAccount(a: BooksAccount) {
  return {
    no: a.no,
    class: Number(a.class),
    label: a.label,
    statement: a.statement,
    statement_position: a.statement_position,
  }
}

export function publicEntry({ entry: e, lines }: EntryWithLines) {
  return {
    number: e.seq,
    /** The statutory journal number. Not interchangeable with `number`. */
    entry_no: e.entry_no,
    date: e.date,
    status: e.status,
    source_id: e.source_id,
    raw_label: e.raw_label,
    counterparty: e.counterparty,
    explanation: e.explanation,
    lines: lines.map((l) => ({
      account: l.account_no,
      debit: l.debit,
      credit: l.credit,
    })),
    recognition: e.recognition,
    matched_rule_id: e.matched_rule_id,
    evidence_tier: e.evidence_tier,
    evidence_note: e.evidence_note,
    // Nested, and `input_claimed` stays its own field: a bank record can support a
    // profit-tax deduction and can never support an input VAT claim, so the tier
    // must never be read as implying this.
    tva: {
      rate: e.tva_rate,
      amount: e.tva_amount,
      input_claimed: e.tva_input_claimed,
      note: e.tva_note,
    },
    related_party: e.related_party,
    // `drive_ref` keeps the mockup's name. Phase 3 replaces the pipeline behind it
    // and the frontend should not have to notice.
    piece: e.piece_drive_ref
      ? { drive_ref: e.piece_drive_ref, hash: e.piece_hash, captured: e.piece_captured }
      : null,
    reverses_entry_id: e.reverses_entry_id,
    history: e.history,
  }
}

export function publicRiEntry(r: typeof booksRiEntry.$inferSelect) {
  return {
    number: r.seq,
    date: r.date,
    direction: r.direction,
    amount: r.amount,
    category: r.category,
    raw_label: r.raw_label,
    counterparty: r.counterparty,
    explanation: r.explanation,
    recognition: r.recognition,
    evidence_tier: r.evidence_tier,
    evidence_note: r.evidence_note,
    piece: r.piece_drive_ref
      ? { drive_ref: r.piece_drive_ref, hash: r.piece_hash, captured: r.piece_captured }
      : null,
  }
}

export function publicPatrimoine(p: typeof booksPatrimoine.$inferSelect) {
  const items = (p.items as { label: unknown; amount: number }[]) ?? []
  let total = 0n
  for (const i of items) total += toCentimes(i.amount)
  return {
    number: p.seq,
    as_of: p.as_of,
    compiled: p.compiled,
    items,
    /** Derived, never stored. */
    total: fromCentimes(total),
    note: p.note,
  }
}
