// IMPORTED HISTORY: the only writer of `billing.history`, and its reads.
//
// ===========================================================================
// THE AGENT MAPS, THIS APP STORES AND SHOWS
// ===========================================================================
// There is no importer UI and no mapping engine — BRIEF.md forbids both by
// name. An agent reads a Zoho or Invoicely export, maps each bill onto
// `ImportHistoryRow`, and posts the rows. This file checks them and writes them.
// It never guesses: a field it cannot accept is a refusal naming the row and
// the field, and an ambiguity the MAPPER could not resolve arrives as an import
// flag, in words, and is shown forever.
//
// ===========================================================================
// ALL OR NOTHING, AND A DUPLICATE IS A 409, NOT A SKIP
// ===========================================================================
// One import is one transaction. If any row is refused, nothing is written, and
// the refusal lists every problem it found — not the first — because a mapper
// fixing a 400-row file one error per round trip is a mapper that gives up.
//
// A row whose `(source, source_ref)` is already in the archive refuses the whole
// import with a 409 naming the existing row's #number. Not an upsert and not a
// merge: two exports disagreeing about one bill is something a person has to
// look at, and silently skipping it would make "imported 14" mean "imported 11
// and quietly ignored 3". Re-running the same file therefore changes nothing and
// says exactly which rows were already there.
//
// The unique index `uq_history_source_ref` is the MECHANISM; the read before the
// insert only turns what would be a bare constraint error into a sentence. Two
// imports racing past that read both reach the insert, one commits, and the
// other's unique violation is caught here and answered with the same 409 — so
// twenty concurrent imports of one row insert exactly one.
//
// ===========================================================================
// `source_ref` IS NEVER TOUCHED
// ===========================================================================
// Not trimmed, not case-folded, not reformatted. It is the only handle back to
// the system of record. Every other text field is checked for blankness without
// being rewritten either; nothing on an imported row is normalised, because the
// row's value is that it says what the source said.

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { billingCompany, billingHistory, users } from '../schema'
import { getDb } from '../client'
import { allocateSeqBlock } from './seq'
import { todayInZurich } from './lifecycle'
import type { WriteCtx } from './invoices'
import { HISTORY_SOURCES, HISTORY_STATUSES } from '@/lib/vocabularies'
import { HISTORY_LIMITS, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from '@/lib/limits'
import type {
  ActorVia,
  HistoryEntry,
  HistorySource,
  HistoryStatus,
  ImportHistoryResult,
  ImportHistoryRow,
} from '@/types'

/** A refusal with a code, a sentence and a recovery — mapped by `lib/api/refusal.ts`. */
export class HistoryRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string,
    public status: 400 | 404 | 409 = 400
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Checking a batch (pure — no database)
// ---------------------------------------------------------------------------

export interface RowProblem {
  /** Zero-based, as the mapper's array is. */
  index: number
  field: string
  reason: string
}

const ROW_KEYS = [
  'source',
  'source_ref',
  'company',
  'number',
  'client_name',
  'issue_date',
  'currency',
  'total',
  'status',
  'import_flag',
  'drive_path',
] as const

/** `numeric(14,2)`: twelve integer digits, at most two decimals, as a string. */
const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/
/** The host `platform-storage` recognises as the blob store (`assets.ts`). */
const BLOB_HOST = 'blob.vercel-storage.com'

const SOURCES = new Set(HISTORY_SOURCES.map((t) => t.value))
const STATUSES = new Set(HISTORY_STATUSES.map((t) => t.value))

/** Not blank: at least one non-space character. The value itself is kept as given. */
function hasText(v: string): boolean {
  return /\S/.test(v)
}

/**
 * Check every row and return every problem, plus the rows typed.
 *
 * Checks what can be checked without the database: shapes, vocabularies,
 * lengths, dates, and a `(source, source_ref)` appearing twice IN THIS BATCH.
 * Whether the company exists and whether a row is already archived are
 * `importHistory`'s questions.
 */
export function checkImportRows(
  raw: unknown[],
  now: Date = new Date()
): { rows: ImportHistoryRow[]; problems: RowProblem[] } {
  const problems: RowProblem[] = []
  const today = todayInZurich(now)
  const seen = new Map<string, number>()

  raw.forEach((r, index) => {
    const bad = (field: string, reason: string) => problems.push({ index, field, reason })
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      bad('(row)', 'is not an object')
      return
    }
    const row = r as Record<string, unknown>

    for (const k of Object.keys(row)) {
      if (!(ROW_KEYS as readonly string[]).includes(k)) {
        bad(k, 'is not a field of an imported bill')
      }
    }

    const str = (k: string, max?: number): string | null => {
      const v = row[k]
      if (v === undefined || v === null) {
        bad(k, 'is required')
        return null
      }
      if (typeof v !== 'string') {
        bad(k, `is ${typeof v}; it must be a string`)
        return null
      }
      if (!hasText(v)) {
        bad(k, 'is blank')
        return null
      }
      if (max !== undefined && v.length > max) {
        bad(k, `is ${v.length} characters; the limit is ${max}`)
        return null
      }
      return v
    }

    const source = str('source')
    if (source !== null && !SOURCES.has(source)) {
      bad('source', `${JSON.stringify(source)} is not a source this app knows`)
    }
    const sourceRef = str('source_ref', HISTORY_LIMITS.source_ref_max)
    str('company')
    str('number', HISTORY_LIMITS.number_max)
    str('client_name', HISTORY_LIMITS.client_name_max)

    const issueDate = str('issue_date')
    if (issueDate !== null) {
      const d = new Date(`${issueDate}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== issueDate) {
        bad('issue_date', `${JSON.stringify(issueDate)} is not a calendar date as YYYY-MM-DD`)
      } else if (issueDate > today) {
        bad('issue_date', `${issueDate} is in the future; an archived bill was issued in the past`)
      }
    }

    const currency = str('currency')
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
      bad('currency', `${JSON.stringify(currency)} is not an ISO 4217 code in capitals`)
    }

    // Money is a STRING. A JSON number has already been through a float64 by
    // the time it reaches us, and "3240.1" and "3240.10000000000002" are the
    // same double — so a number is refused rather than formatted.
    const total = row.total
    if (typeof total === 'number') {
      bad('total', `is a JSON number; send it as a string, e.g. "${total.toFixed(2)}" — money is never a float here`)
    } else if (str('total') !== null && !MONEY.test(total as string)) {
      bad('total', `${JSON.stringify(total)} is not an amount with at most two decimals`)
    }

    const status = str('status')
    if (status !== null && !STATUSES.has(status)) {
      bad('status', `${JSON.stringify(status)} is not a history status`)
    }

    const flag = row.import_flag
    if (flag !== undefined && flag !== null) {
      if (typeof flag !== 'object' || Array.isArray(flag)) {
        bad('import_flag', 'must be {"fr": "…", "en": "…"} or null')
      } else {
        const f = flag as Record<string, unknown>
        for (const k of Object.keys(f)) {
          if (k !== 'fr' && k !== 'en') bad(`import_flag.${k}`, 'is not a language this app flags in (fr, en)')
        }
        for (const lang of ['fr', 'en'] as const) {
          const v = f[lang]
          if (typeof v !== 'string' || !hasText(v)) {
            // Both or neither. A flag in one language is hidden from every
            // reader of the other, and a hidden warning is not a warning.
            bad(`import_flag.${lang}`, 'is missing; a flag is given in both languages or not at all')
          } else if (v.length > HISTORY_LIMITS.import_flag_max) {
            bad(`import_flag.${lang}`, `is ${v.length} characters; the limit is ${HISTORY_LIMITS.import_flag_max}`)
          }
        }
      }
    }

    const drive = row.drive_path
    if (drive !== undefined && drive !== null) {
      if (typeof drive !== 'string' || !hasText(drive)) {
        bad('drive_path', 'must be a path or id on Google Drive, or null when the export had no PDF')
      } else if (drive.length > HISTORY_LIMITS.drive_path_max) {
        bad('drive_path', `is ${drive.length} characters; the limit is ${HISTORY_LIMITS.drive_path_max}`)
      } else if (drive.toLowerCase().includes(BLOB_HOST)) {
        bad('drive_path', 'points at this platform’s blob store; an archived PDF stays on Drive and this app stores a path, never a file')
      }
    }

    if (source !== null && sourceRef !== null) {
      const key = `${source} ${sourceRef}`
      const first = seen.get(key)
      if (first !== undefined) {
        bad('source_ref', `repeats row ${first}'s ${source} ${JSON.stringify(sourceRef)}; one source id is one bill`)
      } else {
        seen.set(key, index)
      }
    }
  })

  return { rows: raw as ImportHistoryRow[], problems }
}

/** One line per problem, capped, for a message a person reads on stderr. */
export function describeProblems(problems: RowProblem[], cap = 10): string {
  const shown = problems.slice(0, cap).map((p) => `row ${p.index}: ${p.field} ${p.reason}`)
  const more = problems.length > cap ? `; and ${problems.length - cap} more` : ''
  return shown.join('; ') + more
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface Existing {
  source: string
  source_ref: string
  seq: number
}

/** Rows of this batch already in the archive, by exact `(source, source_ref)`. */
async function alreadyImported(workspaceId: number, rows: ImportHistoryRow[]): Promise<Existing[]> {
  const refs = [...new Set(rows.map((r) => r.source_ref))]
  const found = await getDb()
    .select({ source: billingHistory.source, source_ref: billingHistory.source_ref, seq: billingHistory.seq })
    .from(billingHistory)
    .where(and(eq(billingHistory.workspace_id, workspaceId), inArray(billingHistory.source_ref, refs)))
  const wanted = new Set(rows.map((r) => `${r.source} ${r.source_ref}`))
  return found.filter((f) => wanted.has(`${f.source} ${f.source_ref}`))
}

function alreadyImportedRefusal(existing: Existing[], batchSize: number): HistoryRefused {
  const cap = 10
  const named = existing
    .slice(0, cap)
    .map((e) => `${e.source} ${JSON.stringify(e.source_ref)} is #${e.seq}`)
    .join('; ')
  const more = existing.length > cap ? `; and ${existing.length - cap} more` : ''
  return new HistoryRefused(
    'already_imported',
    `${existing.length} of ${batchSize} rows are already in the archive, so nothing was written: ${named}${more}`,
    'remove those rows and import the rest; if the source now says something different about one of them, that is for a person to look at — bk billing history show <#>',
    409
  )
}

/** A unique violation on `uq_history_source_ref`, anywhere on the cause chain. */
function isDuplicateSourceRef(err: unknown): boolean {
  for (let x = err as { code?: unknown; constraint?: unknown; cause?: unknown } | null | undefined; x; x = x.cause as typeof x) {
    if (x.code === '23505' && x.constraint === 'uq_history_source_ref') return true
  }
  return false
}

/**
 * Import a batch. All of it, or none of it.
 *
 * The order of refusals is the order a mapper can act on: the body's shape,
 * then every row problem at once, then unknown companies, then rows already in
 * the archive. Only then is anything allocated or written.
 */
export async function importHistory(ctx: WriteCtx, body: unknown, now: Date = new Date()): Promise<ImportHistoryResult> {
  const rawRows =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).rows : undefined
  if (!Array.isArray(rawRows)) {
    throw new HistoryRefused(
      'invalid_body',
      'the body is {"rows": [ … ]}, one object per imported bill',
      'bk billing history import --file rows.json, where the file holds that object or the bare array'
    )
  }
  if (rawRows.length === 0) {
    throw new HistoryRefused('nothing_to_import', 'rows is empty', 'map at least one bill from the export')
  }
  if (rawRows.length > HISTORY_LIMITS.import_max_rows) {
    throw new HistoryRefused(
      'too_many_rows',
      `${rawRows.length} rows in one import; the limit is ${HISTORY_LIMITS.import_max_rows}`,
      'split the export into several imports — each is all-or-nothing, so a split never half-lands'
    )
  }

  const { rows, problems } = checkImportRows(rawRows, now)
  if (problems.length > 0) {
    throw new HistoryRefused(
      'invalid_history_rows',
      `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${rawRows.length} rows, so nothing was written: ${describeProblems(problems)}`,
      'fix the rows named and import the whole file again; `bk meta --app-server billing` has the sources, statuses and limits'
    )
  }

  // Companies by slug, in this workspace only. A retired company is accepted:
  // it issued these bills when it was not retired, and a statement for a past
  // year has to be able to name it.
  const slugs = [...new Set(rows.map((r) => r.company))]
  const companies = await getDb()
    .select({ id: billingCompany.id, slug: billingCompany.slug })
    .from(billingCompany)
    .where(and(eq(billingCompany.workspace_id, ctx.workspaceId), inArray(billingCompany.slug, slugs)))
  const companyId = new Map(companies.map((c) => [c.slug, c.id]))
  const unknown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !companyId.has(r.company))
  if (unknown.length > 0) {
    throw new HistoryRefused(
      'unknown_company',
      `${unknown.length} row${unknown.length === 1 ? '' : 's'} name a company this workspace does not have, so nothing was written: ` +
        describeProblems(unknown.map(({ r, i }) => ({ index: i, field: 'company', reason: JSON.stringify(r.company) }))),
      'bk billing company list — an issuing entity the mapper had to guess is still one of these, with the guess in import_flag'
    )
  }

  const existing = await alreadyImported(ctx.workspaceId, rows)
  if (existing.length > 0) throw alreadyImportedRefusal(existing, rows.length)

  let inserted: number[]
  try {
    inserted = await getDb().transaction(async (tx) => {
      const first = await allocateSeqBlock(tx, ctx.workspaceId, 'history', rows.length)
      await tx.insert(billingHistory).values(
        rows.map((r, i) => ({
          workspace_id: ctx.workspaceId,
          seq: first + i,
          source: r.source,
          source_ref: r.source_ref,
          company_id: companyId.get(r.company)!,
          number: r.number,
          client_name: r.client_name,
          issue_date: r.issue_date,
          currency: r.currency,
          total: r.total,
          status: r.status,
          import_flag_fr: r.import_flag?.fr ?? null,
          import_flag_en: r.import_flag?.en ?? null,
          drive_path: r.drive_path ?? null,
          imported_by: ctx.actorUserId,
          imported_via: ctx.via,
        }))
      )
      return rows.map((_, i) => first + i)
    })
  } catch (e) {
    // Lost a race to another import of the same row: its transaction committed
    // between our read and our insert. Answer as if we had seen it first.
    if (isDuplicateSourceRef(e)) {
      const now2 = await alreadyImported(ctx.workspaceId, rows)
      if (now2.length > 0) throw alreadyImportedRefusal(now2, rows.length)
    }
    throw e
  }

  const written = await listHistoryBySeq(ctx.workspaceId, inserted)
  return {
    imported: written.length,
    flagged: written.filter((w) => w.import_flag !== null).length,
    without_pdf: written.filter((w) => w.drive_path === null).length,
    rows: written,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const COLS = {
  seq: billingHistory.seq,
  source: billingHistory.source,
  source_ref: billingHistory.source_ref,
  company: billingCompany.slug,
  number: billingHistory.number,
  client_name: billingHistory.client_name,
  issue_date: billingHistory.issue_date,
  currency: billingHistory.currency,
  total: billingHistory.total,
  status: billingHistory.status,
  import_flag_fr: billingHistory.import_flag_fr,
  import_flag_en: billingHistory.import_flag_en,
  drive_path: billingHistory.drive_path,
  imported_at: billingHistory.imported_at,
  imported_by: billingHistory.imported_by,
  imported_by_email: users.email,
  imported_via: billingHistory.imported_via,
}

type Row = {
  seq: number
  source: string
  source_ref: string
  company: string
  number: string
  client_name: string
  issue_date: string
  currency: string
  total: string
  status: string
  import_flag_fr: string | null
  import_flag_en: string | null
  drive_path: string | null
  imported_at: Date
  imported_by: number | null
  imported_by_email: string | null
  imported_via: string
}

function shape(r: Row): HistoryEntry {
  return {
    seq: r.seq,
    source: r.source as HistorySource,
    source_ref: r.source_ref,
    company: r.company,
    number: r.number,
    client_name: r.client_name,
    issue_date: r.issue_date,
    currency: r.currency,
    total: r.total,
    status: r.status as HistoryStatus,
    // The CHECK makes these both-or-neither; read defensively anyway, so a row
    // that somehow had one would still SHOW its flag rather than drop it.
    import_flag:
      r.import_flag_fr !== null || r.import_flag_en !== null
        ? { fr: r.import_flag_fr ?? r.import_flag_en ?? '', en: r.import_flag_en ?? r.import_flag_fr ?? '' }
        : null,
    drive_path: r.drive_path,
    imported_at: r.imported_at.toISOString(),
    imported_by: { user_id: r.imported_by, email: r.imported_by_email, via: r.imported_via as ActorVia },
  }
}

function base() {
  return (
    getDb()
      .select(COLS)
      .from(billingHistory)
      .innerJoin(billingCompany, eq(billingCompany.id, billingHistory.company_id))
      // LEFT: `imported_by` is ON DELETE SET NULL, and a row whose importer is
      // gone must still be listed. An inner join would make it vanish.
      .leftJoin(users, eq(users.id, billingHistory.imported_by))
  )
}

async function listHistoryBySeq(workspaceId: number, seqs: number[]): Promise<HistoryEntry[]> {
  const rows = (await base()
    .where(and(eq(billingHistory.workspace_id, workspaceId), inArray(billingHistory.seq, seqs)))
    .orderBy(billingHistory.seq)) as Row[]
  return rows.map(shape)
}

export interface ListHistoryOptions {
  source?: HistorySource
  currency?: string
  /** A calendar year: bills issued in it. */
  year?: number
  /** Only rows carrying an import flag. */
  flagged?: boolean
  company?: string
  limit?: number
  /** The `seq` of the last row of the previous page. */
  cursor?: number
}

/**
 * Newest bill first (`issue_date`, then `#number`), which is the order the
 * screen groups by year in.
 *
 * ── THE CURSOR IS A #NUMBER, AND THE ORDER IS BY DATE ─────────────────────
 * The next page is "everything after the row with this #number, in list order",
 * and that row's date is read back to continue from. Stable because the rows
 * are read-only: the row the cursor names cannot have moved since the last
 * page. An unknown cursor is a 400 rather than page one again, which a paginator
 * would loop on forever.
 */
export async function listHistory(
  workspaceId: number,
  opts: ListHistoryOptions = {}
): Promise<{ data: HistoryEntry[]; next_cursor: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX)
  const where = [eq(billingHistory.workspace_id, workspaceId)]
  if (opts.source) where.push(eq(billingHistory.source, opts.source))
  if (opts.currency) where.push(eq(billingHistory.currency, opts.currency))
  if (opts.company) where.push(eq(billingCompany.slug, opts.company))
  if (opts.year !== undefined) {
    where.push(sql`${billingHistory.issue_date} >= ${`${opts.year}-01-01`}::date`)
    where.push(sql`${billingHistory.issue_date} < ${`${opts.year + 1}-01-01`}::date`)
  }
  if (opts.flagged) where.push(sql`${billingHistory.import_flag_en} IS NOT NULL`)
  if (opts.cursor !== undefined) {
    const at = await getDb()
      .select({ issue_date: billingHistory.issue_date, seq: billingHistory.seq })
      .from(billingHistory)
      .where(and(eq(billingHistory.workspace_id, workspaceId), eq(billingHistory.seq, opts.cursor)))
      .limit(1)
    if (at.length === 0) {
      throw new HistoryRefused(
        'invalid_cursor',
        `no imported bill #${opts.cursor} in this workspace to continue after`,
        'pass the next_cursor the previous page returned, or drop it to start from the newest'
      )
    }
    where.push(sql`(${billingHistory.issue_date}, ${billingHistory.seq}) < (${at[0].issue_date}::date, ${at[0].seq})`)
  }

  const rows = (await base()
    .where(and(...where))
    .orderBy(desc(billingHistory.issue_date), desc(billingHistory.seq))
    .limit(limit + 1)) as Row[]
  const page = rows.slice(0, limit)
  return {
    data: page.map(shape),
    next_cursor: rows.length > limit ? (page[page.length - 1]?.seq ?? null) : null,
  }
}

/** One imported bill by its #number, or null. */
export async function getHistory(workspaceId: number, seq: number): Promise<HistoryEntry | null> {
  const rows = (await base()
    .where(and(eq(billingHistory.workspace_id, workspaceId), eq(billingHistory.seq, seq)))
    .limit(1)) as Row[]
  return rows[0] ? shape(rows[0]) : null
}
