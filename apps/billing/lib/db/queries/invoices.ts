// Invoices: read, create, edit, and the lines.
//
// ===========================================================================
// EVERY WRITE IS ONE TRANSACTION THAT ENDS IN AN AUDIT ROW
// ===========================================================================
// Allocate → write → append to the log → return a FRESH READ. Not four steps
// that usually happen together: one transaction, so a change with no audit row
// is impossible rather than discouraged, and a number handed out by a
// transaction that then rolls back is never lost.
//
// The fresh read is not politeness either. Totals are DERIVED on every read, and
// a caller trusting an optimistically-constructed response would not see what
// the company's rounding policy did to the numbers it just sent.
//
// ===========================================================================
// WHAT IS ENFORCED HERE BECAUSE A CHECK CONSTRAINT CANNOT SEE IT
// ===========================================================================
// Two rules need the COMPANY row, which a CHECK on `invoice` cannot reach.
// `docs/billing-app-plan/phase-1-companies-and-invoices.md` records both as
// write-door rules, and `invoices.test.ts` asserts them, because a rule whose
// only home is a route is a rule a second route can forget:
//
//   1. **QRR requires the company to HAVE a `qr_iban`.** The reference type is
//      meaningless otherwise: a QR reference on an ordinary IBAN is a payment a
//      bank cannot route.
//   2. **A company with `vat_registered = false` may carry no non-null
//      `vat_rate` on any line.** Charging VAT you are not registered for is not
//      a rounding question.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { billingCompany, billingInvoice, billingInvoiceLine } from '../schema'
import { getDb } from '../client'
import { allocateCompanySeqNo, allocateSeq, type Tx } from './seq'
import { appendAudit, appendFieldChanges } from './audit'
import { computeTotals, computeTotalsRappen, type TotalsLine } from '@/lib/derive/totals'
import { formatRappen } from '@/lib/derive/money'
import { renderNumber } from '@/lib/derive/number'
import { referenceBodyFor } from '@/lib/derive/reference'
import { yearOf } from '@/lib/derive/format'
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, PAYMENT_MESSAGE_MAX, METADATA_LIMITS, validateMetadata } from '@/lib/limits'
import { DOCUMENT_LANGUAGES, REFERENCE_TYPES } from '@/lib/vocabularies'
import type {
  ActorVia,
  CreateInvoiceBody,
  CreateInvoiceLineBody,
  DocumentLanguage,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  ReferenceType,
  RoundingPolicy,
  StructuredAddress,
} from '@/types'

// ===========================================================================
// THE FRESH READ HAPPENS AFTER THE COMMIT, NOT INSIDE THE TRANSACTION
// ===========================================================================
// Every write here returns a freshly-read record rather than an optimistically
// constructed one, because totals are DERIVED and a caller trusting a
// constructed response would not see what the company's rounding policy did to
// the numbers it sent.
//
// The first version did that read INSIDE the transaction, through `getInvoice`,
// which uses `getDb()` — a different connection from the transaction handle. The
// uncommitted row is invisible there, so every create failed with
// "invoice vanished after insert" and a 500.
//
// Found on 2026-09-17 by the first real `curl` against the route. Nothing else
// caught it: `tsc` was clean, the pure-function tests were green, `cli-parity`
// was green, and the route built. **A route is not a page, and a type is not a
// request** — this is the same corollary one layer down.
//
// So each write returns its identifying key from the transaction and reads after
// it. The read is then a second round trip, deliberately: the alternative is
// re-implementing the shaping and the derivation against a transaction handle,
// which is two implementations of the numbers that go on a legal document.

export class InvoiceRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string,
    public status: 400 | 403 | 409 = 400
  ) {
    super(message)
  }
}

export interface WriteCtx {
  workspaceId: number
  actorUserId: number
  via: ActorVia
}

const INV_COLS = {
  id: billingInvoice.id,
  seq: billingInvoice.seq,
  company_id: billingInvoice.company_id,
  company_slug: billingCompany.slug,
  company_rounding: billingCompany.rounding,
  seq_no: billingInvoice.seq_no,
  number: billingInvoice.number,
  status: billingInvoice.status,
  issue_date: billingInvoice.issue_date,
  due_date: billingInvoice.due_date,
  paid_date: billingInvoice.paid_date,
  currency: billingInvoice.currency,
  language: billingInvoice.language,
  ref_type: billingInvoice.ref_type,
  ref_body: billingInvoice.ref_body,
  client: billingInvoice.client,
  vat_rate: billingInvoice.vat_rate,
  prices_include_vat: billingInvoice.prices_include_vat,
  message: billingInvoice.message,
  void: billingInvoice.void,
  external_ref: billingInvoice.external_ref,
  metadata: billingInvoice.metadata,
} as const

/**
 * Assemble the wire shape, including the DERIVED totals.
 *
 * `rounding` comes from the joined company, which is why every read joins it: the
 * policy is a company setting (D-B7) and the totals cannot be computed without
 * it. An invoice read without its company's policy would have to guess, and the
 * guess would be right most of the time — which is the worst kind of wrong.
 */
function shape(r: Record<string, unknown>, lines: Record<string, unknown>[]): Invoice {
  const totalsLines: TotalsLine[] = lines.map((l) => ({
    qty: String(l.qty),
    unit_price: String(l.unit_price),
    vat_rate: (l.vat_rate as string) ?? null,
  }))
  const pricesIncludeVat = Boolean(r.prices_include_vat)
  const rounding = r.company_rounding as RoundingPolicy
  const rappen = computeTotalsRappen(totalsLines, pricesIncludeVat, rounding)

  const items: InvoiceLine[] = lines.map((l, i) => ({
    line_no: Number(l.line_no),
    description: String(l.description),
    qty: String(l.qty),
    unit: (l.unit as string) ?? null,
    unit_price: String(l.unit_price),
    vat_rate: (l.vat_rate as string) ?? null,
    line_total: formatRappen(rappen.line_totals[i]),
  }))

  return {
    seq: Number(r.seq),
    company: String(r.company_slug),
    number: String(r.number),
    seq_no: Number(r.seq_no),
    status: r.status as InvoiceStatus,
    issue_date: String(r.issue_date),
    due_date: (r.due_date as string) ?? null,
    paid_date: (r.paid_date as string) ?? null,
    currency: String(r.currency),
    language: r.language as DocumentLanguage,
    ref_type: r.ref_type as ReferenceType,
    ref_body: (r.ref_body as string) ?? null,
    client: (r.client as StructuredAddress) ?? emptyAddress(),
    vat_rate: (r.vat_rate as string) ?? null,
    prices_include_vat: pricesIncludeVat,
    message: (r.message as string) ?? null,
    void: (r.void as Invoice['void']) ?? null,
    items,
    totals: computeTotals(totalsLines, pricesIncludeVat, rounding),
    external_ref: (r.external_ref as string) ?? null,
    metadata: (r.metadata as Record<string, string>) ?? {},
  }
}

const emptyAddress = (): StructuredAddress => ({
  name: '',
  street: null,
  building: null,
  postal_code: null,
  city: null,
  country: null,
})

async function linesOf(invoiceIds: number[]): Promise<Map<number, Record<string, unknown>[]>> {
  const out = new Map<number, Record<string, unknown>[]>()
  if (invoiceIds.length === 0) return out
  const rows = await getDb()
    .select()
    .from(billingInvoiceLine)
    .where(inArray(billingInvoiceLine.invoice_id, invoiceIds))
    .orderBy(asc(billingInvoiceLine.invoice_id), asc(billingInvoiceLine.line_no))
  for (const r of rows) {
    const list = out.get(r.invoice_id) ?? []
    list.push(r as unknown as Record<string, unknown>)
    out.set(r.invoice_id, list)
  }
  return out
}

export interface ListInvoicesOptions {
  company?: string
  status?: InvoiceStatus
  currency?: string
  externalRef?: string
  limit?: number
  cursor?: string
}

export async function listInvoices(
  workspaceId: number,
  opts: ListInvoicesOptions = {}
): Promise<{ data: Invoice[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX)
  const where = [eq(billingInvoice.workspace_id, workspaceId)]
  if (opts.company) where.push(eq(billingCompany.slug, opts.company))
  if (opts.status) where.push(eq(billingInvoice.status, opts.status))
  if (opts.currency) where.push(eq(billingInvoice.currency, opts.currency))
  if (opts.externalRef) where.push(eq(billingInvoice.external_ref, opts.externalRef))
  // The cursor is the `seq` of the last row of the previous page. Descending, so
  // "after" means "lower".
  if (opts.cursor) where.push(sql`${billingInvoice.seq} < ${Number(opts.cursor)}`)

  const rows = await getDb()
    .select(INV_COLS)
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .where(and(...where))
    .orderBy(desc(billingInvoice.seq))
    .limit(limit + 1)

  const page = rows.slice(0, limit) as unknown as Record<string, unknown>[]
  const lines = await linesOf(page.map((r) => Number(r.id)))
  return {
    data: page.map((r) => shape(r, lines.get(Number(r.id)) ?? [])),
    next_cursor:
      rows.length > limit ? String(page[page.length - 1]?.seq ?? '') : null,
  }
}

/**
 * One invoice by `#seq` or by its `number`, resolved **in that order**.
 *
 * Both spellings, because an agent addresses by `#seq` and a human reads the
 * number off the document. A `number` that looks like an integer would be
 * ambiguous, which is why `#seq` wins: it is this app's own address space, and a
 * `number_format` that produced bare integers would be a format
 * `checkNumberFormat` should reject before it got here.
 */
export async function getInvoice(workspaceId: number, ref: string): Promise<Invoice | null> {
  const row = await getInvoiceRow(workspaceId, ref)
  if (!row) return null
  const lines = await linesOf([Number(row.id)])
  return shape(row, lines.get(Number(row.id)) ?? [])
}

export async function getInvoiceRow(
  workspaceId: number,
  ref: string
): Promise<Record<string, unknown> | null> {
  const numeric = /^\d+$/.test(ref) ? Number(ref) : null
  const rows = await getDb()
    .select(INV_COLS)
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .where(
      and(
        eq(billingInvoice.workspace_id, workspaceId),
        numeric === null ? eq(billingInvoice.number, ref) : eq(billingInvoice.seq, numeric)
      )
    )
    .limit(1)
  return (rows[0] as unknown as Record<string, unknown>) ?? null
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createInvoice(ctx: WriteCtx, body: CreateInvoiceBody): Promise<Invoice> {
  if (!body.company) {
    throw new InvoiceRefused(
      'company_required',
      'an invoice needs an issuing company',
      'bk billing company list, then --company <slug>'
    )
  }

  const companyRows = await getDb()
    .select()
    .from(billingCompany)
    .where(and(eq(billingCompany.workspace_id, ctx.workspaceId), eq(billingCompany.slug, body.company)))
    .limit(1)
  const company = companyRows[0]
  if (!company) {
    throw new InvoiceRefused(
      'company_not_found',
      `no company ${body.company} in this workspace`,
      'bk billing company list',
      409
    )
  }
  if (company.retired_at) {
    throw new InvoiceRefused(
      'company_retired',
      `company ${company.slug} was retired and issues no new invoices`,
      'use another company, or un-retire it first',
      409
    )
  }

  const currency = (body.currency ?? company.default_currency).toUpperCase()
  const language = body.language ?? (company.default_language as DocumentLanguage)
  const refType = body.ref_type ?? (company.default_ref_type as ReferenceType)
  const pricesIncludeVat = body.prices_include_vat ?? company.default_prices_include_vat
  const items = body.items ?? []

  assertVocabulary(language, refType)
  assertRefTypeAgainstCompany(refType, currency, company.qr_iban)
  assertLinesAgainstCompany(items, company.vat_registered, company.slug)
  assertMessage(body.message)
  const metaProblem = validateMetadata(body.metadata)
  if (metaProblem) {
    throw new InvoiceRefused('invalid_metadata', metaProblem, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
  }

  const issueDate = body.issue_date ?? new Date().toISOString().slice(0, 10)
  const dueDate = body.due_date ?? addDays(issueDate, company.payment_terms_days)

  // ── THE EXPECTED-TOTAL CHECK HAPPENS BEFORE ANYTHING IS ALLOCATED ────────
  // Deliberately outside the transaction: a refusal must not have consumed a
  // number. `assertExpectedTotal` is pure, so it can run here.
  if (body.expected_total !== undefined) {
    assertExpectedTotal(
      items,
      pricesIncludeVat,
      company.rounding as RoundingPolicy,
      body.expected_total,
      company.slug
    )
  }

  return await getDb().transaction(async (tx) => {
    const seq = await allocateSeq(tx, ctx.workspaceId, 'invoice')
    // The row lock that makes the statutory sequence gapless. Everything after
    // this point is inside it, so a second create for this company waits.
    const seqNo = await allocateCompanySeqNo(tx, company.id)
    const number = renderNumber(company.number_format, yearOf(issueDate), seqNo)

    // The reference BODY, derived here because it contains `seq_no` — which G1
    // freezes the moment this row exists, so it can never change afterwards.
    // The CHECK DIGIT is not stored and is computed on every render (I6).
    //
    // A caller-supplied body wins; see `referenceBodyFor`. The QRR layout is
    // position P11 and must be agreed with the bank before the first real QRR
    // bill.
    const refBody = referenceBodyFor(refType, body.ref_body, company.seq, seqNo, number)

    const [inserted] = await tx
      .insert(billingInvoice)
      .values({
        workspace_id: ctx.workspaceId,
        seq,
        company_id: company.id,
        seq_no: seqNo,
        number,
        status: 'draft',
        issue_date: issueDate,
        due_date: dueDate,
        currency,
        language,
        ref_type: refType,
        ref_body: refBody,
        client: { ...emptyAddress(), ...(body.client ?? {}) },
        vat_rate: body.vat_rate ?? company.default_vat_rate,
        prices_include_vat: pricesIncludeVat,
        message: body.message ?? null,
        external_ref: body.external_ref ?? null,
        metadata: body.metadata ?? {},
        created_by: ctx.actorUserId,
      })
      .returning({ id: billingInvoice.id })

    if (items.length > 0) {
      await tx.insert(billingInvoiceLine).values(
        items.map((l, i) => ({
          invoice_id: inserted.id,
          line_no: i + 1,
          description: l.description,
          qty: l.qty ?? '1',
          unit: l.unit ?? null,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate ?? null,
        }))
      )
    }

    await appendAudit(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: 'invoice',
      subjectId: inserted.id,
      subjectSeq: seq,
      actorUserId: ctx.actorUserId,
      via: ctx.via,
      action: 'created',
      detailEn: `Invoice ${number} created for ${company.name}`,
      detailFr: `Facture ${number} créée pour ${company.name}`,
    })

    return seq
  })
    .then(async (seq) => {
      const fresh = await getInvoice(ctx.workspaceId, String(seq))
      if (!fresh) {
        // Genuinely unreachable once the transaction has committed, and asserted
        // because the alternative is returning `null` up a chain typed
        // `Promise<Invoice>`.
        throw new Error(`invoice #${seq} not readable after commit`)
      }
      return fresh
    })
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/** Field → audit path. Anything absent is refused by name. */
const EDITABLE: Record<string, string> = {
  due_date: 'due_date',
  message: 'message',
  language: 'language',
  currency: 'currency',
  ref_type: 'ref_type',
  ref_body: 'ref_body',
  client: 'client',
  vat_rate: 'vat_rate',
  prices_include_vat: 'prices_include_vat',
  issue_date: 'issue_date',
  external_ref: 'external_ref',
  metadata: 'metadata',
}

/**
 * Refused by name, with the reason. G1 and G2 also refuse these in the
 * database — this is the layer that gives a person a sentence instead of a
 * Postgres exception.
 */
const NEVER_EDITABLE: Record<string, string> = {
  number: 'an invoice number is permanent; void it with a reason and reissue',
  seq_no: 'the statutory sequence has no holes and no reuse',
  seq: 'the #number is this invoice’s address',
  company_id: 'an invoice that changed issuer would be a different document with the same number',
  company: 'an invoice that changed issuer would be a different document with the same number',
  status: 'use the lifecycle commands (phase 3: send, mark-sent, paid, void)',
  paid_date: 'set by marking the invoice paid',
  void: 'set by voiding the invoice, with a reason',
}

export async function editInvoice(
  ctx: WriteCtx,
  ref: string,
  patch: Record<string, unknown>
): Promise<Invoice> {
  const row = await getInvoiceRow(ctx.workspaceId, ref)
  if (!row) {
    throw new InvoiceRefused('not_found', `no invoice ${ref} in this workspace`, 'bk billing invoice list', 409)
  }

  for (const key of Object.keys(patch)) {
    if (NEVER_EDITABLE[key]) {
      throw new InvoiceRefused('field_not_editable', `${key} cannot be changed: ${NEVER_EDITABLE[key]}`, 'omit it')
    }
    if (!EDITABLE[key]) {
      throw new InvoiceRefused('unknown_field', `${key} is not a field of an invoice`, 'bk billing invoice show')
    }
  }

  // G2 in the database refuses the write; this gives the reason in advance, with
  // the list of what IS still editable — which is the thing a person actually
  // needs at that moment.
  const status = String(row.status)
  if (status !== 'draft') {
    const frozen = Object.keys(patch).filter((k) => DOCUMENT_FIELDS.has(k))
    if (frozen.length > 0) {
      throw new InvoiceRefused(
        'document_frozen',
        `invoice ${row.number} is ${status}, and ${frozen.join(', ')} ${frozen.length === 1 ? 'is' : 'are'} part of the sent document`,
        'void it with a reason and reissue; due_date, message, external_ref and metadata stay editable',
        409
      )
    }
  }

  if (patch.message !== undefined) assertMessage(patch.message as string | null)
  if (patch.metadata !== undefined) {
    const p = validateMetadata(patch.metadata as Record<string, string>)
    if (p) throw new InvoiceRefused('invalid_metadata', p, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
  }

  return await getDb().transaction(async (tx) => {
    const changes: Array<{ field: string; from: unknown; to: unknown }> = []
    for (const [key, to] of Object.entries(patch)) {
      const from = row[key]
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
        changes.push({ field: EDITABLE[key] ?? key, from, to })
      }
    }

    if (changes.length > 0) {
      await tx
        .update(billingInvoice)
        .set({ ...patch, updated_at: new Date() })
        .where(eq(billingInvoice.id, Number(row.id)))
      await appendFieldChanges(
        tx,
        {
          workspaceId: ctx.workspaceId,
          subjectType: 'invoice',
          subjectId: Number(row.id),
          subjectSeq: Number(row.seq),
          actorUserId: ctx.actorUserId,
          via: ctx.via,
        },
        changes
      )
    }

    return Number(row.seq)
  })
    .then(async (seq) => {
      const fresh = await getInvoice(ctx.workspaceId, String(seq))
      if (!fresh) throw new Error(`invoice #${seq} not readable after commit`)
      return fresh
    })
}

/** The columns G2 freezes once an invoice is not a draft. Mirrors 0005's trigger. */
const DOCUMENT_FIELDS = new Set([
  'currency',
  'ref_type',
  'ref_body',
  'client',
  'prices_include_vat',
  'issue_date',
  'vat_rate',
])

/**
 * Replace the whole line set.
 *
 * ── WHY REPLACE RATHER THAN PATCH INDIVIDUAL LINES ─────────────────────────
 * `line_no` is display order, and a partial update has to answer "what happens
 * to the gap?" every time a line is removed. Replacing the set makes the order
 * the caller's statement rather than something the server reconstructs, and it
 * makes `items` on the wire exactly what it looks like: the lines, in order.
 *
 * One audit row per changed path (`items[2].unit_price`), not one for the
 * replacement — the log has to answer "what changed?", and "the lines" is not an
 * answer.
 */
export async function setInvoiceLines(
  ctx: WriteCtx,
  ref: string,
  items: CreateInvoiceLineBody[]
): Promise<Invoice> {
  const row = await getInvoiceRow(ctx.workspaceId, ref)
  if (!row) {
    throw new InvoiceRefused('not_found', `no invoice ${ref} in this workspace`, 'bk billing invoice list', 409)
  }
  if (String(row.status) !== 'draft') {
    throw new InvoiceRefused(
      'document_frozen',
      `invoice ${row.number} is ${row.status}, and its lines are part of the sent document`,
      'void it with a reason and reissue; the amounts on a sent bill are a legal fact',
      409
    )
  }

  const companyRows = await getDb()
    .select({ vat_registered: billingCompany.vat_registered, slug: billingCompany.slug })
    .from(billingCompany)
    .where(eq(billingCompany.id, Number(row.company_id)))
    .limit(1)
  const company = companyRows[0]
  assertLinesAgainstCompany(items, Boolean(company?.vat_registered), String(company?.slug))

  const before = (await linesOf([Number(row.id)])).get(Number(row.id)) ?? []

  return await getDb().transaction(async (tx) => {
    await tx.delete(billingInvoiceLine).where(eq(billingInvoiceLine.invoice_id, Number(row.id)))
    if (items.length > 0) {
      await tx.insert(billingInvoiceLine).values(
        items.map((l, i) => ({
          invoice_id: Number(row.id),
          line_no: i + 1,
          description: l.description,
          qty: l.qty ?? '1',
          unit: l.unit ?? null,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate ?? null,
        }))
      )
    }

    const changes = diffLines(before, items)
    await appendFieldChanges(
      tx,
      {
        workspaceId: ctx.workspaceId,
        subjectType: 'invoice',
        subjectId: Number(row.id),
        subjectSeq: Number(row.seq),
        actorUserId: ctx.actorUserId,
        via: ctx.via,
      },
      changes
    )
    await tx
      .update(billingInvoice)
      .set({ updated_at: new Date() })
      .where(eq(billingInvoice.id, Number(row.id)))

    return Number(row.seq)
  })
    .then(async (seq) => {
      const fresh = await getInvoice(ctx.workspaceId, String(seq))
      if (!fresh) throw new Error(`invoice #${seq} not readable after commit`)
      return fresh
    })
}

/** One entry per changed path, in the mockup's `items[i].field` spelling. */
function diffLines(
  before: Record<string, unknown>[],
  after: CreateInvoiceLineBody[]
): Array<{ field: string; from: unknown; to: unknown }> {
  const out: Array<{ field: string; from: unknown; to: unknown }> = []
  const n = Math.max(before.length, after.length)
  const FIELDS = ['description', 'qty', 'unit', 'unit_price', 'vat_rate'] as const
  for (let i = 0; i < n; i++) {
    const b = before[i]
    const a = after[i]
    if (!b) {
      out.push({ field: `items[${i}]`, from: null, to: a?.description ?? null })
      continue
    }
    if (!a) {
      out.push({ field: `items[${i}]`, from: b.description ?? null, to: null })
      continue
    }
    for (const f of FIELDS) {
      const from = b[f] ?? null
      // `qty` defaults to '1' when the caller omits it, matching the column
      // default — otherwise omitting it on an unchanged line would log a change
      // from '1' to null that never happened.
      const to = (a[f] as unknown) ?? (f === 'qty' ? '1' : null)
      if (String(from ?? '') !== String(to ?? '')) {
        out.push({ field: `items[${i}].${f}`, from, to })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The write-door rules
// ---------------------------------------------------------------------------
// ── EXPORTED SO THEY CAN BE TESTED WITHOUT A DATABASE ──────────────────────
// These four are the rules with no database object behind them, which makes
// them the ones most likely to be quietly lost — a route that forgot to call
// one would pass every other guard in this repo. They are pure functions of
// their arguments, so `invoices.test.ts` exercises them directly rather than
// through a transaction, and the citation in this file's header is a claim that
// file makes true.
//
// They are called from `createInvoice` and `setInvoiceLines`. Adding a third
// write path means calling them from it too, and nothing enforces that — which
// is why the module header names them rather than leaving a reader to find out.

export function assertVocabulary(language: string, refType: string): void {
  if (!DOCUMENT_LANGUAGES.some((l) => l.value === language)) {
    throw new InvoiceRefused(
      'invalid_language',
      `${language} is not a document language`,
      `one of ${DOCUMENT_LANGUAGES.map((l) => l.value).join(', ')} — run \`bk meta --app-server billing\``
    )
  }
  if (!REFERENCE_TYPES.some((r) => r.value === refType)) {
    throw new InvoiceRefused(
      'invalid_ref_type',
      `${refType} is not a reference type`,
      `one of ${REFERENCE_TYPES.map((r) => r.value).join(', ')}`
    )
  }
}

/**
 * The half of the combination matrix a CHECK cannot express, because it needs
 * the company row.
 *
 * `docs/billing-app-plan/qr-bill.md` has the full table. G4 in migration 0005
 * covers the rest.
 */
export function assertRefTypeAgainstCompany(
  refType: ReferenceType,
  currency: string,
  qrIban: string | null
): void {
  if (refType !== 'QRR') return
  if (!qrIban) {
    throw new InvoiceRefused(
      'qrr_needs_qr_iban',
      'a QR reference can only be paid into a QR-IBAN, and this company has none',
      'use SCOR or NON, or ask the workspace owner to add a QR-IBAN (IID 30000–31999)',
      409
    )
  }
  if (currency !== 'CHF') {
    throw new InvoiceRefused(
      'qrr_chf_only',
      `a QR reference is CHF only, and this invoice is in ${currency}`,
      'use SCOR for a EUR bill — the standard permits only IBAN+SCOR or IBAN+NON there'
    )
  }
}

/** Charging VAT you are not registered for is not a rounding question. */
export function assertLinesAgainstCompany(
  items: CreateInvoiceLineBody[],
  vatRegistered: boolean,
  companySlug: string
): void {
  if (vatRegistered) return
  const offending = items.findIndex((l) => l.vat_rate !== null && l.vat_rate !== undefined)
  if (offending >= 0) {
    throw new InvoiceRefused(
      'company_not_vat_registered',
      `company ${companySlug} is not registered for VAT, so line ${offending + 1} may not carry a rate`,
      'leave vat_rate unset on every line, or set the company’s vat_registered first'
    )
  }
}

export function assertMessage(message: string | null | undefined): void {
  if (!message) return
  if (message.length > PAYMENT_MESSAGE_MAX) {
    throw new InvoiceRefused(
      'message_too_long',
      `the payment message is ${message.length} characters and the QR-bill budget is ${PAYMENT_MESSAGE_MAX}`,
      'shorten it; the budget is shared with structured billing information, which this app does not emit yet'
    )
  }
}

/**
 * Refuse a create whose derived total disagrees with what the caller expected.
 *
 * ── WHY THE REFUSAL NAMES THE POLICY AND THE MODE ──────────────────────────
 * Because "expected 108.09, got 108.10" sends somebody looking for a bug in
 * their arithmetic, when the answer is that this company rounds the payable
 * total to five rappen and theirs does not. The two facts that explain every
 * disagreement of this kind are the rounding policy and the price mode, so the
 * message carries both.
 *
 * `docs/billing-app-plan/integration-surface.md` §6.
 */
export function assertExpectedTotal(
  items: CreateInvoiceLineBody[],
  pricesIncludeVat: boolean,
  rounding: RoundingPolicy,
  expected: string,
  companySlug: string
): void {
  const lines: TotalsLine[] = items.map((l) => ({
    qty: l.qty ?? '1',
    unit_price: l.unit_price,
    vat_rate: l.vat_rate ?? null,
  }))
  const derived = computeTotals(lines, pricesIncludeVat, rounding).total
  if (derived !== expected) {
    throw new InvoiceRefused(
      'total_mismatch',
      `you expected ${expected} and this invoice derives ${derived}`,
      `company ${companySlug} rounds with "${rounding}" and its prices ` +
        `${pricesIncludeVat ? 'INCLUDE' : 'EXCLUDE'} VAT. Nothing was created and no number was ` +
        'allocated. Check those two settings before changing your own arithmetic',
      409
    )
  }
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`not an ISO date: ${iso}`)
  // UTC throughout, and the result is sliced back to a date string. A Postgres
  // `date` has no timezone; constructing a local Date here is what shifts an
  // invoice across a fiscal year boundary west of Greenwich.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
