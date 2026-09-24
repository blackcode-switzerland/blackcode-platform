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
import { billingCompany, billingInvoice, billingInvoiceLine, billingRecurrence } from '../schema'
import { getDb } from '../client'
import { allocateCompanySeqNo, allocateSeq, type Tx } from './seq'
import { appendAudit, appendFieldChanges } from './audit'
import { computeTotals, computeTotalsRappen, type TotalsLine } from '@/lib/derive/totals'
import { formatRappen, parseMinor } from '@/lib/derive/money'
import { renderNumber } from '@/lib/derive/number'
import {
  ReferenceProblem,
  formatIban,
  formatQRR,
  formatSCOR,
  invoiceAccount,
  invoiceReference,
  referenceBodyFor,
  referenceBodyProblem,
} from '@/lib/qr/reference'
import { qrBillFieldsFor } from '@/lib/qr/payload'
import { findDisallowed } from '@/lib/qr/charset'
import { hasPaymentPart, validateQrBill } from '@/lib/qr/validate'
import { ISSUER_FIELDS, issuerOf, type IssuerSource } from '@/lib/issuer'
import { todayInZurich, yearOf } from '@/lib/derive/format'
import { isUniqueViolation } from '../unique-violation'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  PAYMENT_MESSAGE_MAX,
  METADATA_LIMITS,
  externalRefProblem,
  validateMetadata,
} from '@/lib/limits'
import { DOCUMENT_LANGUAGES, REFERENCE_TYPES } from '@/lib/vocabularies'
import type {
  ActorVia,
  CreateInvoiceBody,
  CreateInvoiceLineBody,
  DocumentLanguage,
  Invoice,
  InvoiceDerived,
  InvoiceLine,
  InvoiceStatus,
  IssuerSnapshot,
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
    // 404/422/5xx arrived with phase 3's lifecycle routes. Every route maps this
    // through `lib/api/refusal.ts`, never by hand — see that file for the 403
    // that four hand-written mappings scrambled.
    public status: 400 | 403 | 404 | 409 | 422 | 500 | 501 | 502 = 400
  ) {
    super(message)
  }
}

/**
 * Where a read runs: the pool, or an open transaction.
 *
 * A read that must see the state a transaction has LOCKED has to run on that
 * transaction's connection. Reading through `getDb()` instead does two wrong
 * things at once: it cannot see the transaction's own uncommitted writes (the
 * phase-1 "vanished after insert" bug, below), and it takes a SECOND pooled
 * connection while the first is held — with a pool of five, five concurrent
 * sends each holding one and waiting for another is a deadlock with no error.
 */
export type Exec = Tx | ReturnType<typeof getDb>

export interface WriteCtx {
  workspaceId: number
  actorUserId: number
  via: ActorVia
}

/**
 * The joined company's columns, under a `co_` prefix: the LIVE issuer, which
 * `issuerOf` uses only when the invoice carries no snapshot (a draft). Built from
 * `ISSUER_FIELDS`, so a field added there is selected here without a second edit.
 */
const LIVE_ISSUER_COLS = Object.fromEntries(
  ISSUER_FIELDS.map((k) => [`co_${k}`, billingCompany[k]])
) as { [K in (typeof ISSUER_FIELDS)[number] as `co_${K}`]: (typeof billingCompany)[K] }

const INV_COLS = {
  id: billingInvoice.id,
  seq: billingInvoice.seq,
  company_id: billingInvoice.company_id,
  company_slug: billingCompany.slug,
  issuer: billingInvoice.issuer,
  recurrence_seq: billingRecurrence.seq,
  occurrence_period: billingInvoice.occurrence_period,
  ...LIVE_ISSUER_COLS,
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
  sent_at: billingInvoice.sent_at,
  sent_message_id: billingInvoice.sent_message_id,
  pdf_sha256: billingInvoice.pdf_sha256,
  external_ref: billingInvoice.external_ref,
  metadata: billingInvoice.metadata,
} as const

/** The issuer this row renders from: its snapshot, or — for a draft — the joined company. */
function issuerOfRow(r: Record<string, unknown>, liveOverride?: IssuerSource): IssuerSource {
  const live =
    liveOverride ??
    (Object.fromEntries(ISSUER_FIELDS.map((k) => [k, r[`co_${k}`] ?? null])) as unknown as IssuerSource)
  return issuerOf((r.issuer as IssuerSnapshot | null) ?? null, live)
}

/**
 * What the payment part says, from the same functions the PDF calls.
 *
 * `problems` is `validateQrBill` — the check `…/pdf`, `…/qr` and `send` refuse
 * on — so `invoice show` can say why a bill would be refused before anybody
 * tries to send it.
 */
export function deriveInvoice(invoice: Omit<Invoice, 'derived'>, issuer: IssuerSource): InvoiceDerived {
  let reference: string | null = null
  try {
    reference = invoiceReference(invoice.ref_type, invoice.ref_body)
  } catch (e) {
    if (!(e instanceof ReferenceProblem)) throw e
  }
  const account = invoiceAccount(invoice.ref_type, issuer)
  const withSlip = hasPaymentPart(invoice.currency) && invoice.status !== 'void'
  return {
    reference,
    reference_formatted: reference === null ? null : invoice.ref_type === 'QRR' ? formatQRR(reference) : formatSCOR(reference),
    account: account ?? null,
    account_formatted: account ? formatIban(account) : null,
    creditor: {
      name: issuer.legal_name,
      street: issuer.street,
      building: issuer.building,
      postal_code: issuer.postal_code,
      city: issuer.city,
      country: issuer.country,
    },
    has_payment_part: withSlip,
    problems: withSlip ? validateQrBill(qrBillFieldsFor(invoice as Invoice, issuer)) : [],
  }
}

/**
 * Assemble the wire shape, including the DERIVED totals.
 *
 * `rounding` comes from the ISSUER — the snapshot once there is one, the joined
 * company while the invoice is a draft (lib/issuer.ts). The policy is a company
 * setting (D-B7) and the totals cannot be computed without it; read from the
 * live company, a sent invoice's total moved whenever somebody changed the
 * setting, which is the half of I12 that migration 0011 closed.
 */
function shape(r: Record<string, unknown>, lines: Record<string, unknown>[]): Invoice {
  return shapeWithIssuer(r, lines).invoice
}

function shapeWithIssuer(
  r: Record<string, unknown>,
  lines: Record<string, unknown>[],
  liveOverride?: IssuerSource
): { invoice: Invoice; issuer: IssuerSource } {
  const issuer = issuerOfRow(r, liveOverride)
  const totalsLines: TotalsLine[] = lines.map((l) => ({
    qty: String(l.qty),
    unit_price: String(l.unit_price),
    vat_rate: (l.vat_rate as string) ?? null,
  }))
  const pricesIncludeVat = Boolean(r.prices_include_vat)
  const rounding = issuer.rounding as RoundingPolicy
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

  const invoice: Omit<Invoice, 'derived'> = {
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
    sent_at: r.sent_at ? new Date(r.sent_at as string | Date).toISOString() : null,
    sent_message_id: (r.sent_message_id as string) ?? null,
    pdf_sha256: (r.pdf_sha256 as string) ?? null,
    issuer: (r.issuer as IssuerSnapshot | null) ?? null,
    recurrence: r.recurrence_seq === null || r.recurrence_seq === undefined ? null : Number(r.recurrence_seq),
    occurrence_period: (r.occurrence_period as string) ?? null,
    items,
    totals: computeTotals(totalsLines, pricesIncludeVat, rounding),
    external_ref: (r.external_ref as string) ?? null,
    metadata: (r.metadata as Record<string, string>) ?? {},
  }
  return { invoice: { ...invoice, derived: deriveInvoice(invoice, issuer) }, issuer }
}

const emptyAddress = (): StructuredAddress => ({
  name: '',
  street: null,
  building: null,
  postal_code: null,
  city: null,
  country: null,
})

async function linesOf(
  invoiceIds: number[],
  exec: Exec = getDb()
): Promise<Map<number, Record<string, unknown>[]>> {
  const out = new Map<number, Record<string, unknown>[]>()
  if (invoiceIds.length === 0) return out
  const rows = await exec
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
    .leftJoin(billingRecurrence, eq(billingRecurrence.id, billingInvoice.recurrence_id))
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
export async function getInvoice(
  workspaceId: number,
  ref: string,
  exec: Exec = getDb()
): Promise<Invoice | null> {
  const row = await getInvoiceRow(workspaceId, ref, exec)
  if (!row) return null
  const lines = await linesOf([Number(row.id)], exec)
  return shape(row, lines.get(Number(row.id)) ?? [])
}

/**
 * An invoice AND the issuer it renders from — what `…/pdf`, `…/qr` and `send`
 * hand the renderer. One read, so the two cannot come from different moments.
 *
 * `asIssuedBy` is for the write that takes a draft OUT of draft: it has already
 * read the company row once (to check it, and to snapshot it), and passing that
 * row's snapshot here makes the totals, the PDF and the stored copy all come
 * from that ONE read — instead of from this function's own join, a moment
 * later, which a concurrent company edit could land between. It never overrides
 * a snapshot the row already carries.
 */
export async function getInvoiceDocumentSource(
  workspaceId: number,
  ref: string,
  exec: Exec = getDb(),
  asIssuedBy?: IssuerSource
): Promise<{ invoice: Invoice; issuer: IssuerSource } | null> {
  const row = await getInvoiceRow(workspaceId, ref, exec)
  if (!row) return null
  const lines = await linesOf([Number(row.id)], exec)
  return shapeWithIssuer(row, lines.get(Number(row.id)) ?? [], asIssuedBy)
}

export async function getInvoiceRow(
  workspaceId: number,
  ref: string,
  exec: Exec = getDb()
): Promise<Record<string, unknown> | null> {
  const numeric = /^\d+$/.test(ref) ? Number(ref) : null
  const rows = await exec
    .select(INV_COLS)
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .leftJoin(billingRecurrence, eq(billingRecurrence.id, billingInvoice.recurrence_id))
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
  let seq: number
  try {
    ;({ seq } = await getDb().transaction((tx) => insertInvoice(tx, ctx, body)))
  } catch (e) {
    // After the rollback, so the number the transaction took is already
    // released. Mapped here rather than left to `apiHandler`'s generic 409
    // `already_exists`, so the refusal names the invoice that HOLDS the
    // reference — which is how an integration adopts a bill it created and
    // never heard back about.
    throw await externalRefRefusal(e, ctx.workspaceId, body.external_ref)
  }
  const fresh = await getInvoice(ctx.workspaceId, String(seq))
  if (!fresh) {
    // Genuinely unreachable once the transaction has committed, and asserted
    // because the alternative is returning `null` up a chain typed
    // `Promise<Invoice>`.
    throw new Error(`invoice #${seq} not readable after commit`)
  }
  return fresh
}

/** Where an occurrence belongs. Only the recurrence generate path passes one. */
export interface SeriesPlacement {
  recurrenceId: number
  period: string
}

/**
 * THE create path, inside a caller's transaction: validate, allocate, insert,
 * audit. `createInvoice` wraps it in a transaction of its own; the recurrence
 * generate path calls it inside the transaction that also advances the series'
 * counter, so an occurrence and its counter commit together or not at all.
 *
 * ONE path, so an occurrence is an ordinary invoice: the same checks, the next
 * number in the company's sequence, the same audit row. A second insert for
 * occurrences would be a second definition of "an invoice".
 *
 * Every refusal here happens inside the transaction, and the number the
 * transaction took is released with it — the allocator is a row lock, not a
 * sequence (lib/db/queries/seq.ts), so a rollback leaves no hole.
 */
export async function insertInvoice(
  tx: Tx,
  ctx: WriteCtx,
  body: CreateInvoiceBody,
  series?: SeriesPlacement
): Promise<{ id: number; seq: number; number: string }> {
  if (!body.company) {
    throw new InvoiceRefused(
      'company_required',
      'an invoice needs an issuing company',
      'bk billing company list, then --company <slug>'
    )
  }

  const companyRows = await tx
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

  // A SUPPLIED reference body is checked before anything is allocated. The
  // derived one is checked inside the transaction, because it depends on the
  // number the transaction allocates — and a refusal there rolls the number back.
  const bodyProblem = referenceBodyProblem(refType, body.ref_body)
  if (bodyProblem) throw new InvoiceRefused(bodyProblem.code, bodyProblem.message, bodyProblem.suggestion)
  const externalRef = normaliseExternalRef(body.external_ref)

  const issueDate = defaultIssueDate(body.issue_date)
  const dueDate = body.due_date ?? addDays(issueDate, company.payment_terms_days)

  // ── THE EXPECTED-TOTAL CHECK HAPPENS BEFORE ANYTHING IS ALLOCATED ────────
  // Before the allocator: a refusal must not have consumed a number (and one
  // after it would not either — the rollback releases it — but refusing before
  // the row lock keeps concurrent creates for this company from waiting on it).
  if (body.expected_total !== undefined) {
    assertExpectedTotal(
      items,
      pricesIncludeVat,
      company.rounding as RoundingPolicy,
      body.expected_total,
      company.slug
    )
  }

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
  let refBody: string | null
  try {
    refBody = referenceBodyFor(refType, body.ref_body, company.seq, seqNo, number)
  } catch (e) {
    // A number that cannot form a reference is a fact about the company's
    // configuration, not about the request — 409, and the rollback releases
    // the number this transaction took.
    if (e instanceof ReferenceProblem) throw new InvoiceRefused(e.code, e.message, e.suggestion, 409)
    throw e
  }

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
      external_ref: externalRef,
      metadata: body.metadata ?? {},
      recurrence_id: series?.recurrenceId ?? null,
      occurrence_period: series?.period ?? null,
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
    detailEn: series
      ? `Invoice ${number} created for ${company.name} — occurrence ${series.period} of a recurring series`
      : `Invoice ${number} created for ${company.name}`,
    detailFr: series
      ? `Facture ${number} créée pour ${company.name} — échéance ${series.period} d’une série récurrente`
      : `Facture ${number} créée pour ${company.name}`,
  })

  return { id: inserted.id, seq, number }
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
  status: 'use the lifecycle commands: bk billing invoice send, mark-sent, paid, void',
  paid_date: 'set by marking the invoice paid',
  void: 'set by voiding the invoice, with a reason',
  sent_at: 'set by sending the invoice, and permanent once set',
  sent_message_id: 'recorded from the email that carried the invoice; it is evidence, not a field',
  pdf_sha256: 'the fingerprint of the PDF that was attached; it is evidence, not a field',
  issuer: 'the company as it was when the invoice was issued; it is copied, never typed',
  derived: 'it is computed on every read and never stored',
  recurrence: 'an invoice joins a series by being generated from it, or by being its template — bk billing recurrence create',
  recurrence_id: 'an invoice joins a series by being generated from it, or by being its template — bk billing recurrence create',
  occurrence_period: 'set when an occurrence is generated, and permanent',
  totals: 'they are computed from the lines on every read and never stored',
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

  // The reference pair is checked as the pair it will BE after the patch: a type
  // change alone can leave a body the new type cannot carry (a 26-digit QRR body
  // is 5 characters too long for SCOR).
  if (patch.ref_type !== undefined || patch.ref_body !== undefined) {
    const nextType = (patch.ref_type ?? row.ref_type) as ReferenceType
    const nextBody =
      patch.ref_body !== undefined ? ((patch.ref_body as string | null) ?? null) : ((row.ref_body as string | null) ?? null)
    const p = referenceBodyProblem(nextType, nextBody)
    if (p) throw new InvoiceRefused(p.code, p.message, p.suggestion)
    if (nextType !== 'NON' && (nextBody === null || nextBody === '')) {
      throw new InvoiceRefused(
        'reference_body_required',
        `a ${nextType} invoice needs a reference body`,
        'send ref_body with the new ref_type'
      )
    }
  }

  if (patch.message !== undefined) assertMessage(patch.message as string | null)
  if (patch.metadata !== undefined) {
    const p = validateMetadata(patch.metadata as Record<string, string>)
    if (p) throw new InvoiceRefused('invalid_metadata', p, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
  }
  if (patch.external_ref !== undefined) {
    patch = { ...patch, external_ref: normaliseExternalRef(patch.external_ref as string | null) }
  }

  return await getDb().transaction(async (tx) => {
    const changes: Array<{ field: string; from: unknown; to: unknown }> = []
    for (const [key, to] of Object.entries(patch)) {
      const from = row[key]
      if (!sameValue(key, from, to, (f, t) => JSON.stringify(f ?? null) === JSON.stringify(t ?? null))) {
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
    .catch(async (e: unknown) => {
      throw await externalRefRefusal(e, ctx.workspaceId, patch.external_ref as string | null | undefined)
    })
    .then(async (seq) => {
      const fresh = await getInvoice(ctx.workspaceId, String(seq))
      if (!fresh) throw new Error(`invoice #${seq} not readable after commit`)
      return fresh
    })
}

/**
 * The EDITABLE columns G2 freezes once an invoice is not a draft.
 *
 * `frozen-fields.test.ts` reads the newest definition of
 * `billing.invoice_document_frozen()` from the migrations and fails when this set
 * and the trigger disagree. Until 2026-09-17 this comment said "Mirrors 0005's
 * trigger" and it did not: this set froze `vat_rate` and the trigger did not,
 * and neither froze `language`. Migration 0007 is where both were reconciled.
 *
 * The trigger also freezes the three delivery columns; those are in
 * `NEVER_EDITABLE` instead, because they are not editable even on a draft.
 */
export const DOCUMENT_FIELDS: ReadonlySet<string> = new Set([
  'currency',
  'language',
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

  return await getDb().transaction(async (tx) => {
    // ── LOCK THE INVOICE ROW BEFORE TOUCHING ITS LINES ─────────────────────
    // Phase 3 made this necessary. The line trigger reads the invoice's status
    // when each line statement runs, and the first version of this function
    // took the invoice's row lock only at the END (the `updated_at` bump). So a
    // `send` could lock the invoice, read the committed lines, render and mail
    // them, and commit `sent` — while this transaction had already replaced the
    // lines under a `draft` status it read before `send` committed. Its final
    // UPDATE then waited, succeeded (G2 does not freeze `updated_at`), and
    // committed new lines on a sent invoice. The client would hold a PDF whose
    // amounts the database no longer had.
    //
    // Locking first serialises the two: whichever holds the row finishes, and
    // the other re-reads the status under the lock.
    const [locked] = await tx
      .select({ status: billingInvoice.status })
      .from(billingInvoice)
      .where(eq(billingInvoice.id, Number(row.id)))
      .for('update')
    if (String(locked?.status) !== 'draft') {
      throw new InvoiceRefused(
        'document_frozen',
        `invoice ${row.number} became ${locked?.status} while this change was being made, and its lines are part of the sent document`,
        'void it with a reason and reissue; the amounts on a sent bill are a legal fact',
        409
      )
    }
    const before = (await linesOf([Number(row.id)], tx)).get(Number(row.id)) ?? []

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

/**
 * The decimal columns a diff can see, and the scale they compare at.
 *
 * ── WHY A DIFF CANNOT COMPARE THESE AS STRINGS ─────────────────────────────
 * Postgres returns a `numeric` in its column's scale: `qty` numeric(12,3) comes
 * back as `1.000`, `unit_price` as `100.00`, `vat_rate` as `8.10`. A caller sends
 * `1`, `100` and `8.1`. Compared as strings, every line replacement logged a
 * `qty` change that nobody made, and the audit log — which IS the edit history —
 * recorded edits that never happened.
 *
 * Found 2026-09-17 by the first test that ran a line replacement against a real
 * database (`write-paths.integration.test.ts`), which expected one row per
 * changed line path and got a phantom `items[0].qty` beside them.
 */
const DECIMAL_SCALE: Readonly<Record<string, number>> = { qty: 1000, unit_price: 100, vat_rate: 100 }

function sameValue(
  field: string,
  from: unknown,
  to: unknown,
  fallback: (from: unknown, to: unknown) => boolean
): boolean {
  const scale = DECIMAL_SCALE[field]
  if (scale !== undefined && from !== null && from !== undefined && from !== '' && to !== null && to !== undefined && to !== '') {
    try {
      return parseMinor(String(from), scale) === parseMinor(String(to), scale)
    } catch {
      // Not a plain decimal at this scale. The write door refuses it elsewhere;
      // here, compare as given, so a real difference is never hidden.
    }
  }
  return fallback(from, to)
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
      if (!sameValue(f, from, to, (x, y) => String(x ?? '') === String(y ?? ''))) {
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
  // The character set, at the WRITE door and not only at send. Found 2026-09-18
  // by the first `invoice pdf` over HTTP: every one of the mockup's eleven
  // payment messages carries an em dash (U+2014), which a Swiss QR Code cannot
  // encode — so each was a draft that saved cleanly and could never be sent.
  // A refusal at the moment of typing costs one keystroke; at send it costs a
  // failed delivery, and on an invoice marked sent it cannot be un-sent.
  const bad = findDisallowed(message)
  if (bad) {
    const shown = bad.codepoint === 'U+000A' || bad.codepoint === 'U+000D' ? 'a line break' : JSON.stringify(bad.character)
    throw new InvoiceRefused(
      'message_character_not_allowed',
      `the payment message contains ${shown} (${bad.codepoint}) at character ${bad.position}, which a Swiss QR Code cannot carry`,
      'replace it (an em dash becomes "-"); it is not substituted for you, because a message that was silently altered is a message nobody approved'
    )
  }
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

/**
 * The issue date a create takes when the caller sends none: today, **in
 * Zurich**.
 *
 * Until 2026-09-23 this was `new Date().toISOString().slice(0, 10)` — a UTC
 * date — so a bill issued between midnight and 01:00 (02:00 in summer) local
 * time was dated the previous day, and once a year the previous FISCAL year.
 * `lib/derive/format.ts` states the rule; `lifecycle.ts` already followed it
 * for `paid_date` and `recurrences.ts` for a generated occurrence. This was the
 * one create path still on the UTC calendar (ticket #757).
 */
export function defaultIssueDate(supplied: string | null | undefined, now: Date = new Date()): string {
  return supplied ?? todayInZurich(now)
}

/**
 * `''` means "none" (both front doors send an empty field for it); anything
 * else is checked against the column's width here, at the door, because a
 * value longer than `varchar(80)` reaches Postgres as sqlstate `22001`, which
 * `apiHandler` does not translate — so an 81-character reference was a 500
 * with no code until 2026-09-23.
 */
export function normaliseExternalRef(v: string | null | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  const p = externalRefProblem(v)
  if (p) throw new InvoiceRefused('invalid_external_ref', p, 'your own identifier for this invoice, such as an order or appointment id')
  return v
}

/**
 * A unique violation on `uq_invoice_ws_external_ref` → 409 `external_ref_taken`
 * naming the invoice that holds it. Any other error is returned unchanged for
 * the caller to rethrow. Runs AFTER the failed transaction, on the pool.
 */
async function externalRefRefusal(e: unknown, workspaceId: number, externalRef: string | null | undefined): Promise<unknown> {
  if (!externalRef || !isUniqueViolation(e, 'uq_invoice_ws_external_ref')) return e
  const { data } = await listInvoices(workspaceId, { externalRef, limit: 1 })
  const holder = data[0]
  return new InvoiceRefused(
    'external_ref_taken',
    holder
      ? `invoice #${holder.seq} (${holder.number}) already carries external_ref ${JSON.stringify(externalRef)}`
      : `another invoice in this workspace already carries external_ref ${JSON.stringify(externalRef)}`,
    holder
      ? `bk billing invoice show ${holder.seq} — if that is the bill you meant, use it rather than creating another`
      : 'bk billing invoice list --external-ref <ref>',
    409
  )
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
