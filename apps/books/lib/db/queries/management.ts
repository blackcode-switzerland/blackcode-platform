// Phase 4B: the management layer — recorded analyses, cost categories, the
// analytique breakdown and the tax snapshot.
//
// ===========================================================================
// AN ANALYSIS IS FILED, NEVER EDITED
// ===========================================================================
// `bk books analyse record` is the agent write-back contract made real: an
// outside agent reads the data, answers a question, and files the answer WITH
// its `based_on` snapshot of what it read. The table is append-only (0013
// revokes UPDATE/DELETE from the app role) and this module offers neither. A
// drifted answer is answered again, in a new row; both rows stand.
//
// ===========================================================================
// CATEGORIES ARE CONFIGURATION, WITH A WRITE DOOR OF THEIR OWN
// ===========================================================================
// (No ordinal here: three documents counted "the writes" three different ways.
// The canonical enumeration lives in docs/changelog/books.md, once.)
//
// The breakdown's buckets. Seeded with the mockup's five, creatable from the
// UI and the CLI (decided with Mustneer, 2026-08-19). Three integrity rules
// the create enforces because nothing else could: every account named must
// exist in the entity's chart; no account may sit in two ACTIVE categories —
// a franc that appears in two bars is counted twice; and no class-3 account
// may pose as a cost — revenue in a charge bucket is the same quiet
// misstatement with the sign flipped.
//
// Everything else here is a READ over postings, derived at request time
// (lib/derive/management.ts), never stored.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksAnalysis,
  booksAnalytiqueCategory,
  booksTaxParams,
  booksEntity,
  booksEntry,
  booksEntryLine,
  booksOpeningBalance,
  type BooksAnalysis,
  type BooksAnalytiqueCategory,
  type BooksEntity,
  type BooksExercice,
  type BooksTaxParams,
  type StoredBasedOn,
  type StoredBiText,
  type StoredFigure,
  type StoredSpeech,
} from '../schema'
import { nextSeq } from './imports'
import { getBilan, getCr, listAccounts, listRiEntries } from './statutory'
import { fromCentimes, toCentimes } from '../../derive'
import {
  costBreakdown,
  costBreakdownRi,
  crByMonth,
  monthlyFlows,
  monthlyFlowsRi,
  pmCapitalTax,
  pmProfitTax,
  vatPosition,
  type BreakdownInputLine,
  type CategoryBreakdown,
  type MonthlyCr,
  type MonthlyFlow,
  type TaxParams,
  type VatEntry,
} from '../../derive/management'

export class ManagementRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Analyses — list, show, record
// ---------------------------------------------------------------------------

export interface AnalysisWithEntity {
  analysis: BooksAnalysis
  entitySlug: string
}

export async function listAnalyses(workspaceId: number, entityId?: number): Promise<AnalysisWithEntity[]> {
  const conds = [eq(booksAnalysis.workspace_id, workspaceId)]
  if (entityId) conds.push(eq(booksAnalysis.entity_id, entityId))
  const rows = await getDb()
    .select({ analysis: booksAnalysis, entitySlug: booksEntity.slug })
    .from(booksAnalysis)
    .innerJoin(booksEntity, eq(booksEntity.id, booksAnalysis.entity_id))
    .where(and(...conds))
    .orderBy(desc(booksAnalysis.asked), desc(booksAnalysis.seq))
  return rows
}

export async function getAnalysis(workspaceId: number, seq: number): Promise<AnalysisWithEntity | null> {
  const [row] = await getDb()
    .select({ analysis: booksAnalysis, entitySlug: booksEntity.slug })
    .from(booksAnalysis)
    .innerJoin(booksEntity, eq(booksEntity.id, booksAnalysis.entity_id))
    .where(and(eq(booksAnalysis.workspace_id, workspaceId), eq(booksAnalysis.seq, seq)))
    .limit(1)
  return row ?? null
}

export interface RecordAnalysisData {
  entitySlug: string
  askedBy: string
  agent: string
  question: StoredSpeech
  verdict: StoredSpeech
  figures?: StoredFigure[]
  basedOn?: StoredBasedOn[]
  scenarioLabel?: StoredSpeech | null
  runwayAfterMonths?: number | null
}

/** True for a non-empty string or an object with a non-empty fr or en half. */
function speaks(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0
  if (v && typeof v === 'object') {
    const o = v as { fr?: unknown; en?: unknown }
    return speaks(o.fr) || speaks(o.en)
  }
  return false
}

/**
 * File one analysis. The row is permanent the moment this returns: there is
 * no edit and no delete, by design and by grant.
 */
export async function recordAnalysis(
  workspaceId: number,
  data: RecordAnalysisData
): Promise<AnalysisWithEntity> {
  const db = getDb()
  const [entity] = await db
    .select()
    .from(booksEntity)
    .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, data.entitySlug)))
    .limit(1)
  if (!entity) {
    throw new ManagementRefused('entity_not_found', `no book "${data.entitySlug}"`, 'bk books entity list names them')
  }

  if (!speaks(data.question)) {
    throw new ManagementRefused('missing_question', 'an analysis records a question somebody asked', 'pass the question, as text or {fr, en}')
  }
  if (!speaks(data.verdict)) {
    throw new ManagementRefused('missing_verdict', 'an analysis without a verdict is not an answer', 'pass the verdict, as text or {fr, en}')
  }
  if (!data.askedBy?.trim() || !data.agent?.trim()) {
    throw new ManagementRefused('missing_provenance', 'who asked, and which agent answered — both are part of the record', 'pass asked_by and agent')
  }

  const figures = data.figures ?? []
  const basedOn = data.basedOn ?? []
  if (!Array.isArray(figures) || !Array.isArray(basedOn)) {
    throw new ManagementRefused('bad_shape', 'figures and based_on are arrays', 'see bk books analyse record --help')
  }
  for (const b of basedOn) {
    const o = b as { label?: unknown; value?: unknown }
    if (!o || typeof o !== 'object' || !speaks(o.label) || o.value === undefined || o.value === null || o.value === '') {
      throw new ManagementRefused(
        'based_on_incomplete',
        'every based_on item needs a label and a value: the snapshot of what the agent read is the point of the record',
        'each item is {label, value, href?}'
      )
    }
  }

  return db.transaction(async (tx) => {
    const seq = await nextSeq(tx, workspaceId, 'analysis')
    const [row] = await tx
      .insert(booksAnalysis)
      .values({
        workspace_id: workspaceId,
        entity_id: entity.id,
        seq,
        asked_by: data.askedBy.trim(),
        agent: data.agent.trim(),
        scenario_label: data.scenarioLabel ?? null,
        runway_after_months:
          data.runwayAfterMonths === undefined || data.runwayAfterMonths === null
            ? null
            : String(data.runwayAfterMonths),
        question: data.question,
        verdict: data.verdict,
        figures,
        based_on: basedOn,
      })
      .returning()
    return { analysis: row, entitySlug: entity.slug }
  })
}

// ---------------------------------------------------------------------------
// Categories — list, create
// ---------------------------------------------------------------------------

export async function listCategories(entityId: number): Promise<BooksAnalytiqueCategory[]> {
  return getDb()
    .select()
    .from(booksAnalytiqueCategory)
    .where(eq(booksAnalytiqueCategory.entity_id, entityId))
    .orderBy(asc(booksAnalytiqueCategory.seq))
}

export interface CreateCategoryData {
  entitySlug: string
  key: string
  label: unknown
  accounts: string[]
}

/**
 * Create one cost category. Refuses an account the chart does not hold, an
 * account another ACTIVE category already claims — one franc, one bar — and a
 * class-3 account: revenue in a cost bucket would be counted as a charge.
 */
export async function createCategory(
  workspaceId: number,
  data: CreateCategoryData
): Promise<BooksAnalytiqueCategory> {
  const db = getDb()
  const [entity] = await db
    .select()
    .from(booksEntity)
    .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, data.entitySlug)))
    .limit(1)
  if (!entity) {
    throw new ManagementRefused('entity_not_found', `no book "${data.entitySlug}"`, 'bk books entity list names them')
  }
  if (entity.bookkeeping_regime === 'simplified') {
    throw new ManagementRefused(
      'ri_no_categories',
      `"${data.entitySlug}" keeps recettes-dépenses: its dépenses carry their own category, there is no account mapping to configure`,
      'set the category on the entry itself'
    )
  }
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(data.key ?? '')) {
    throw new ManagementRefused('bad_key', 'a category key is lowercase letters, digits and underscores, starting with a letter', 'e.g. marketing, it_ai, autres')
  }
  if (!speaks(data.label)) {
    throw new ManagementRefused('missing_label', 'a category needs a label a human reads', 'pass text or {fr, en}')
  }
  if (!Array.isArray(data.accounts) || data.accounts.length === 0 || !data.accounts.every((a) => typeof a === 'string' && a.trim())) {
    throw new ManagementRefused('missing_accounts', 'a category is a set of ledger accounts — name at least one', 'bk books account list shows the chart')
  }

  const chart = await listAccounts(entity.id)
  const known = new Set(chart.map((a) => a.no))
  const unknown = data.accounts.filter((a) => !known.has(a))
  if (unknown.length > 0) {
    throw new ManagementRefused(
      'unknown_account',
      `not in this book's chart: ${unknown.join(', ')}`,
      'bk books account list shows the chart'
    )
  }
  const crAccounts = new Set(chart.filter((a) => a.statement === 'cr').map((a) => a.no))
  const nonCr = data.accounts.filter((a) => !crAccounts.has(a))
  if (nonCr.length > 0) {
    throw new ManagementRefused(
      'not_a_flow_account',
      `on the bilan, not the compte de résultat: ${nonCr.join(', ')}`,
      'a category counts flows; a bilan account here would chart balance movements as charges'
    )
  }
  // `statement === 'cr'` admits class 3, and a revenue line inside a cost
  // bucket makes the breakdown count produits as charges — the bars carry no
  // sign, so nothing downstream could ever tell.
  const revenueAccounts = new Set(chart.filter((a) => Number(a.class) === 3).map((a) => a.no))
  const revenue = data.accounts.filter((a) => revenueAccounts.has(a))
  if (revenue.length > 0) {
    throw new ManagementRefused(
      'revenue_not_a_cost',
      `class 3 is revenue, not a charge: ${revenue.join(', ')}`,
      'a category buckets costs; produits already carry their own line on the compte de résultat'
    )
  }

  const existing = await listCategories(entity.id)
  if (existing.some((c) => c.key === data.key)) {
    throw new ManagementRefused('duplicate_key', `category "${data.key}" already exists on this book`, 'keys are unique per book; retire the old one first if it is being replaced')
  }
  const claimed = new Map<string, string>()
  for (const c of existing) {
    if (c.retired) continue
    for (const a of c.accounts as string[]) claimed.set(a, c.key)
  }
  const overlaps = data.accounts.filter((a) => claimed.has(a))
  if (overlaps.length > 0) {
    throw new ManagementRefused(
      'accounts_claimed',
      `already counted by another category: ${overlaps.map((a) => `${a} (${claimed.get(a)})`).join(', ')}`,
      'one franc, one bar — an account belongs to at most one active category'
    )
  }

  // A category label is CONFIGURATION, so it is normalized rather than kept
  // verbatim (unlike an analysis, which is a record): the wire always carries
  // {fr, en}, and a client typing it as an object never meets a bare string —
  // including a half-spoken {fr}-only object, whose other half is filled in.
  const given = data.label as string | { fr?: string; en?: string }
  const label: StoredBiText =
    typeof given === 'string'
      ? { fr: given, en: given }
      : { fr: (given.fr ?? given.en)!, en: (given.en ?? given.fr)! }

  return db.transaction(async (tx) => {
    const seq = await nextSeq(tx, workspaceId, 'category')
    const [row] = await tx
      .insert(booksAnalytiqueCategory)
      .values({
        workspace_id: workspaceId,
        entity_id: entity.id,
        seq,
        key: data.key,
        label,
        accounts: data.accounts,
      })
      .returning()
    return row
  })
}

// ---------------------------------------------------------------------------
// The analytique read — breakdown and flows for one (entity, exercice)
// ---------------------------------------------------------------------------

export interface AnalytiqueResult {
  categories: CategoryBreakdown[]
  monthly_flows: MonthlyFlow[]
}

async function breakdownLines(entityId: number, exerciceId: number): Promise<BreakdownInputLine[]> {
  const rows = await getDb()
    .select({
      account_no: booksEntryLine.account_no,
      debit: booksEntryLine.debit,
      credit: booksEntryLine.credit,
      status: booksEntry.status,
      date: booksEntry.date,
      counterparty: booksEntry.counterparty,
      raw_label: booksEntry.raw_label,
      entry_number: booksEntry.seq,
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
  return rows.map((r) => ({ ...r, counterparty: r.counterparty ?? r.raw_label }))
}

// ---------------------------------------------------------------------------
// The compte de résultat, month by month — ticket #64
// ---------------------------------------------------------------------------

/**
 * The annual statement is the one the law defines; this is how an operator
 * reads it. See `crByMonth` in `derive/management.ts` for why it lives with the
 * management derivations rather than the statutory ones.
 *
 * Refused for a simplified book, exactly as `getCr` is: art. 957 al. 2
 * bookkeeping has no compte de résultat to break down. Its monthly picture is
 * `monthly_flows` on the analytique, which that regime does serve.
 */
export async function getCrByMonth(
  entity: BooksEntity,
  exercice: BooksExercice
): Promise<MonthlyCr[]> {
  if (entity.bookkeeping_regime === 'simplified') {
    throw new ManagementRefused(
      'no_cr_for_simplified',
      `"${entity.slug}" keeps recettes-dépenses: it has no compte de résultat to break down`,
      'bk books analytique serves this book\'s monthly recettes and dépenses'
    )
  }
  const [lines, accounts] = await Promise.all([
    breakdownLines(entity.id, exercice.id),
    listAccounts(entity.id),
  ])
  const chart = accounts.map((a) => ({
    no: a.no,
    class: Number(a.class),
    statement: a.statement,
    statement_position: a.statement_position,
  }))
  return crByMonth(lines, chart, { starts_on: exercice.starts_on, ends_on: exercice.ends_on })
}

export async function getAnalytique(entity: BooksEntity, exercice: BooksExercice): Promise<AnalytiqueResult> {
  if (entity.bookkeeping_regime === 'simplified') {
    const rows = await listRiEntries(entity.id, exercice.id)
    return {
      categories: costBreakdownRi(
        rows.map((r) => ({
          seq: r.seq,
          date: r.date,
          direction: r.direction,
          amount: r.amount,
          counterparty: r.counterparty,
          raw_label: r.raw_label,
          category: r.category,
        }))
      ),
      monthly_flows: monthlyFlowsRi(rows),
    }
  }

  const [lines, accounts, cats] = await Promise.all([
    breakdownLines(entity.id, exercice.id),
    listAccounts(entity.id),
    listCategories(entity.id),
  ])
  const chart = accounts.map((a) => ({
    no: a.no,
    class: Number(a.class),
    statement: a.statement,
    statement_position: a.statement_position,
  }))
  return {
    categories: costBreakdown(
      cats.filter((c) => !c.retired).map((c) => ({ key: c.key, label: c.label, accounts: c.accounts as string[] })),
      lines
    ),
    monthly_flows: monthlyFlows(lines, chart),
  }
}

// ---------------------------------------------------------------------------
// The tax snapshot — derived, cited, and honest about configuration
// ---------------------------------------------------------------------------

export interface TaxSnapshot {
  profit: string
  equity: string
  vat: ReturnType<typeof vatPosition> | null
  /** Null when the entity has no tax parameters: "not configured", never someone else's rates. */
  tax: {
    canton: string
    commune: string
    profit_tax: ReturnType<typeof pmProfitTax>
    capital_tax: ReturnType<typeof pmCapitalTax>
    /** The parameter record verbatim: rates, citations, confirmed flags, open questions. */
    params: unknown
  } | null
  configured: boolean
}

export async function getTaxSnapshot(entity: BooksEntity, exercice: BooksExercice): Promise<TaxSnapshot> {
  if (entity.bookkeeping_regime === 'simplified') {
    throw new ManagementRefused(
      'no_tax_snapshot_for_simplified',
      `"${entity.slug}" keeps recettes-dépenses: its result is taxed as its owner's personal income, which this app does not model`,
      'the patrimoine view is the personal picture; income tax belongs to the fiduciary (b/tax later)'
    )
  }

  const [cr, bilan] = await Promise.all([getCr(entity.id, exercice.id), getBilan(entity.id, exercice.id)])

  // Equity, the mockup's way: the passif groups whose heading is Capitaux
  // propres — including the injected resultat de l'exercice.
  let equity = 0n
  for (const g of bilan.groups) {
    if (g.side !== 'passif') continue
    const fr = (g.group as { fr?: string }).fr ?? ''
    if (!fr.startsWith('Capitaux propres')) continue
    for (const l of g.lines) equity += toCentimes(l.amount)
  }

  // VAT — only for a registered entity, and exact.
  let vat: TaxSnapshot['vat'] = null
  if (entity.vat_registered) {
    const [openingRow] = await getDb()
      .select()
      .from(booksOpeningBalance)
      .where(
        and(
          eq(booksOpeningBalance.entity_id, entity.id),
          eq(booksOpeningBalance.exercice_id, exercice.id),
          eq(booksOpeningBalance.account_no, '2200')
        )
      )
      .limit(1)
    const entries = await getDb().execute(sql`
      SELECT e.status, e.tva_amount, e.tva_input_claimed,
             bool_or(l.account_no = '3400' AND l.credit > 0) AS credits_revenue
        FROM books.entry e
        JOIN books.entry_line l ON l.entry_id = e.id
       WHERE e.entity_id = ${entity.id}
         AND e.exercice_id = ${exercice.id}
         AND e.deleted_at IS NULL
         AND e.tva_amount IS NOT NULL
       GROUP BY e.id
    `)
    vat = vatPosition(
      toCentimes(openingRow?.amount ?? null),
      entries.rows.map((r) => ({
        status: String(r.status),
        tva_amount: r.tva_amount as string | null,
        tva_input_claimed: Boolean(r.tva_input_claimed),
        credits_revenue: Boolean(r.credits_revenue),
      })) as VatEntry[]
    )
  }

  const [paramsRow] = await getDb()
    .select()
    .from(booksTaxParams)
    .where(eq(booksTaxParams.entity_id, entity.id))
    .limit(1)

  let tax: TaxSnapshot['tax'] = null
  if (paramsRow) {
    const p = paramsRow.params as unknown as TaxParams
    const profitCentimes = toCentimes(cr.resultat)
    const profitTax = pmProfitTax(profitCentimes, p)
    const capitalTax = pmCapitalTax(equity, Number(profitTax.cantonal) + Number(profitTax.communal), p)
    tax = {
      canton: paramsRow.canton,
      commune: paramsRow.commune,
      profit_tax: profitTax,
      capital_tax: capitalTax,
      params: paramsRow.params,
    }
  }

  return {
    profit: cr.resultat,
    equity: fromCentimes(equity),
    vat,
    tax,
    configured: !!paramsRow,
  }
}

// ---------------------------------------------------------------------------
// The wire shapes
// ---------------------------------------------------------------------------

export function publicAnalysis({ analysis: a, entitySlug }: AnalysisWithEntity) {
  return {
    number: a.seq,
    entity: entitySlug,
    asked: a.asked.toISOString(),
    asked_by: a.asked_by,
    agent: a.agent,
    scenario_label: a.scenario_label,
    runway_after_months: a.runway_after_months === null ? null : Number(a.runway_after_months),
    question: a.question,
    verdict: a.verdict,
    figures: a.figures,
    based_on: a.based_on,
  }
}

export function publicCategory(c: BooksAnalytiqueCategory, entitySlug: string) {
  return {
    number: c.seq,
    entity: entitySlug,
    key: c.key,
    label: c.label,
    accounts: c.accounts,
    retired: c.retired,
  }
}

/** Seed/tests helper: the tax params row for one entity. */
export async function getTaxParams(entityId: number): Promise<BooksTaxParams | null> {
  const [row] = await getDb().select().from(booksTaxParams).where(eq(booksTaxParams.entity_id, entityId)).limit(1)
  return row ?? null
}
