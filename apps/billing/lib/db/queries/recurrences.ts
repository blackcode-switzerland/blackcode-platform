// RECURRING SERIES: the only writer of `billing.recurrence`, and its reads.
//
// ===========================================================================
// A RULE IS DATA. NOTHING HERE FIRES ON IT.
// ===========================================================================
// There is no scheduler, no queue and no timer anywhere in this app (phase 4's
// done-when greps for them). An agent lists the due series and asks for the
// next occurrence, naming its period; `generateOccurrence` creates it as an
// ordinary DRAFT through the ordinary create path. Generating is not sending.
//
// ===========================================================================
// WHY A SECOND BILL FOR ONE PERIOD CANNOT HAPPEN
// ===========================================================================
// Three layers, each for a different caller:
//
//   1. the ROW LOCK on the series, taken first. Twenty concurrent generates for
//      one period queue on it; the first creates, the other nineteen find the
//      invoice it made and get a 409 naming it;
//   2. the PERIOD CHECK: a period that is neither the series' next one nor a
//      voided one being replaced is refused, never substituted — a typo'd
//      period would otherwise be a real bill for a quarter nobody asked for;
//   3. the partial unique index `uq_invoice_occurrence` (0012): one LIVE invoice
//      per (series, period), whatever path wrote it. It is the only guard that
//      holds for a write that took no lock — and its unique violation is
//      translated to the same 409 as layer 1, never passed up as a 500.
//
// The Idempotency-Key on the route is a fourth thing and answers a different
// question: it makes a retry QUIET (the same 201, the same invoice), where the
// three above make it SAFE.
//
// ===========================================================================
// A VOID FREES ITS PERIOD, AND THE REPLACEMENT DOES NOT COUNT TWICE (P7)
// ===========================================================================
// A voided occurrence keeps its number and its series; it stops occupying its
// period. Generating that period again is a REPLACEMENT: a new draft, the
// counter unchanged — the mockup's BC-2026-0033 (void) and BC-2026-0034 are one
// occurrence of the Junod series.

import { and, asc, desc, eq, lte, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { billingCompany, billingInvoice, billingRecurrence } from '../schema'
import { getDb } from '../client'
import { allocateSeq, type Tx } from './seq'
import { appendAudit, appendFieldChanges } from './audit'
import { getInvoice, getInvoiceRow, insertInvoice, InvoiceRefused, type Exec, type WriteCtx } from './invoices'
import { advance, anchorDay, isCalendarDate, isDue, nextDate, PERIOD_EXAMPLE, PERIOD_SHAPE, periodKey } from '@/lib/derive/recurrence'
import { todayInZurich } from '@/lib/derive/format'
import { EXTERNAL_REF_MAX, externalRefProblem, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, METADATA_LIMITS, RECURRENCE_LIMITS, validateMetadata } from '@/lib/limits'
import { isUniqueViolation } from '../unique-violation'
import { RECURRENCE_FREQUENCIES } from '@/lib/vocabularies'
import type {
  CreateInvoiceBody,
  CreateRecurrenceBody,
  GenerateOccurrenceResult,
  Recurrence,
  RecurrenceFrequency,
  RecurrenceOccurrence,
  RecurrenceStatus,
} from '@/types'

const template = alias(billingInvoice, 'template')

const REC_COLS = {
  id: billingRecurrence.id,
  seq: billingRecurrence.seq,
  company_id: billingRecurrence.company_id,
  company_slug: billingCompany.slug,
  template_id: billingRecurrence.template_invoice_id,
  template_seq: template.seq,
  template_number: template.number,
  status: billingRecurrence.status,
  frequency: billingRecurrence.frequency,
  start_date: billingRecurrence.start_date,
  occurrences_total: billingRecurrence.occurrences_total,
  occurrences_done: billingRecurrence.occurrences_done,
  next_date: billingRecurrence.next_date,
  label_fr: billingRecurrence.label_fr,
  label_en: billingRecurrence.label_en,
  external_ref: billingRecurrence.external_ref,
  metadata: billingRecurrence.metadata,
} as const

type RecRow = {
  id: number
  seq: number
  company_id: number
  company_slug: string
  template_id: number | null
  template_seq: number | null
  template_number: string | null
  status: string
  frequency: string
  start_date: string
  occurrences_total: number
  occurrences_done: number
  next_date: string | null
  label_fr: string | null
  label_en: string | null
  external_ref: string | null
  metadata: unknown
}

function shape(r: RecRow, today: string = todayInZurich()): Recurrence {
  const frequency = r.frequency as RecurrenceFrequency
  const status = r.status as RecurrenceStatus
  return {
    seq: r.seq,
    company: r.company_slug,
    template: r.template_seq ?? null,
    template_number: r.template_number ?? null,
    status,
    frequency,
    start_date: r.start_date,
    occurrences_total: r.occurrences_total,
    occurrences_done: r.occurrences_done,
    next_date: r.next_date,
    next_period: r.next_date === null ? null : periodKey(frequency, r.next_date),
    due: isDue({ status, occurrences_done: r.occurrences_done, occurrences_total: r.occurrences_total, next_date: r.next_date }, today),
    label: { fr: r.label_fr, en: r.label_en },
    external_ref: r.external_ref,
    metadata: (r.metadata as Record<string, string>) ?? {},
  }
}

function selectRecurrences(exec: Exec) {
  return exec
    .select(REC_COLS)
    .from(billingRecurrence)
    .innerJoin(billingCompany, eq(billingCompany.id, billingRecurrence.company_id))
    .leftJoin(template, eq(template.id, billingRecurrence.template_invoice_id))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListRecurrencesOptions {
  company?: string
  status?: RecurrenceStatus
  /** Active and its next date has arrived, in Zurich. What an agent polls. */
  due?: boolean
  limit?: number
  cursor?: number
}

/** Newest series first. `due` narrows to the series an agent should generate for now. */
export async function listRecurrences(
  workspaceId: number,
  opts: ListRecurrencesOptions = {}
): Promise<{ data: Recurrence[]; next_cursor: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX)
  const today = todayInZurich()
  const where = [eq(billingRecurrence.workspace_id, workspaceId)]
  if (opts.company) where.push(eq(billingCompany.slug, opts.company))
  if (opts.status) where.push(eq(billingRecurrence.status, opts.status))
  if (opts.due) {
    where.push(eq(billingRecurrence.status, 'active'))
    where.push(lte(billingRecurrence.next_date, today))
  }
  if (opts.cursor !== undefined) where.push(sql`${billingRecurrence.seq} < ${opts.cursor}`)

  // `due` pages by `seq` like everything else, so its ORDER is by seq too: a
  // cursor over one ordering and a sort by another skips rows. A due list is
  // short — a page of it is the whole of it — and `bk` sorts it by date.
  const rows = (await selectRecurrences(getDb())
    .where(and(...where))
    .orderBy(desc(billingRecurrence.seq))
    .limit(limit + 1)) as RecRow[]
  const page = rows.slice(0, limit)
  return {
    data: page.map((r) => shape(r, today)),
    next_cursor: rows.length > limit ? page[page.length - 1].seq : null,
  }
}

async function recurrenceRow(workspaceId: number, seq: number, exec: Exec): Promise<RecRow | null> {
  const [row] = (await selectRecurrences(exec)
    .where(and(eq(billingRecurrence.workspace_id, workspaceId), eq(billingRecurrence.seq, seq)))
    .limit(1)) as RecRow[]
  return row ?? null
}

/** One series, with every invoice that carries it — voids included, oldest first. */
export async function getRecurrence(workspaceId: number, seq: number, exec: Exec = getDb()): Promise<Recurrence | null> {
  const row = await recurrenceRow(workspaceId, seq, exec)
  if (!row) return null
  const invoices = await exec
    .select({
      id: billingInvoice.id,
      seq: billingInvoice.seq,
      number: billingInvoice.number,
      status: billingInvoice.status,
      occurrence_period: billingInvoice.occurrence_period,
      issue_date: billingInvoice.issue_date,
      currency: billingInvoice.currency,
    })
    .from(billingInvoice)
    .where(and(eq(billingInvoice.workspace_id, workspaceId), eq(billingInvoice.recurrence_id, row.id)))
    .orderBy(asc(billingInvoice.seq))
  // Totals are DERIVED (I5), so each comes from the invoice's own read rather
  // than a second summing of lines here. A series has tens of invoices, not
  // thousands.
  const occurrences: RecurrenceOccurrence[] = []
  for (const i of invoices) {
    const full = await getInvoice(workspaceId, String(i.seq), exec)
    occurrences.push({
      seq: i.seq,
      number: i.number,
      status: i.status as RecurrenceOccurrence['status'],
      occurrence_period: i.occurrence_period,
      issue_date: i.issue_date,
      total: full?.totals.total ?? '',
      currency: i.currency,
    })
  }
  return { ...shape(row), invoices: occurrences }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const FREQUENCIES = RECURRENCE_FREQUENCIES.map((f) => f.value)

function assertFrequency(v: unknown): asserts v is RecurrenceFrequency {
  if (typeof v !== 'string' || !FREQUENCIES.includes(v)) {
    throw new InvoiceRefused(
      'invalid_frequency',
      `${JSON.stringify(v)} is not a frequency`,
      `one of ${FREQUENCIES.join(', ')} — run \`bk meta --app-server billing\``
    )
  }
}

function assertOccurrences(v: unknown, field = 'occurrences_total'): asserts v is number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > RECURRENCE_LIMITS.occurrences_max) {
    throw new InvoiceRefused(
      v === undefined || v === null ? 'occurrences_required' : 'invalid_occurrences',
      v === undefined || v === null
        ? `${field} is required: a series is finite, and this is where it ends. There is no default and no open-ended series`
        : `${field} is a whole number from 1 to ${RECURRENCE_LIMITS.occurrences_max}; got ${JSON.stringify(v)}`,
      'bk billing recurrence create … --occurrences 12'
    )
  }
}

function cleanLabel(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') throw new InvoiceRefused('invalid_label', `${field} is text`, 'omit it to leave it unset')
  const t = v.trim()
  if (t.length > RECURRENCE_LIMITS.label_max) {
    throw new InvoiceRefused('label_too_long', `${field} is ${t.length} characters; the limit is ${RECURRENCE_LIMITS.label_max}`, 'a label names the series; the lines say what it bills')
  }
  return t === '' ? null : t
}

function assertMeta(meta: unknown): void {
  const problem = validateMetadata(meta)
  if (problem) throw new InvoiceRefused('invalid_metadata', problem, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
}

function assertExternalRef(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined
  if (typeof v !== 'string' || v.trim() === '' || externalRefProblem(v)) {
    throw new InvoiceRefused(
      'invalid_external_ref',
      (typeof v === 'string' && externalRefProblem(v)) || `external_ref is text of 1 to ${EXTERNAL_REF_MAX} characters`,
      'your own identifier for this series, such as a subscription id'
    )
  }
  return v
}

/** The template, locked, checked against what a template may be. */
async function templateFor(tx: Tx, workspaceId: number, ref: string, companyId: number | null, ownSeries: number | null) {
  const row = await getInvoiceRow(workspaceId, ref, tx)
  if (!row) throw new InvoiceRefused('template_not_found', `no invoice #${ref} or numbered ${ref} in this workspace`, 'bk billing invoice list', 404)
  const [inv] = await tx
    .select({
      id: billingInvoice.id,
      seq: billingInvoice.seq,
      number: billingInvoice.number,
      status: billingInvoice.status,
      company_id: billingInvoice.company_id,
      issue_date: billingInvoice.issue_date,
      recurrence_id: billingInvoice.recurrence_id,
    })
    .from(billingInvoice)
    .where(eq(billingInvoice.id, Number(row.id)))
    .for('update')
  if (inv.status === 'void') {
    throw new InvoiceRefused(
      'template_void',
      `invoice ${inv.number} is void: a cancelled bill is not a model for the next one`,
      'use the invoice that replaced it as the template',
      409
    )
  }
  if (companyId !== null && inv.company_id !== companyId) {
    throw new InvoiceRefused(
      'template_other_company',
      `invoice ${inv.number} is issued by another company than this series`,
      'a series bills from one company; create a new series for the other',
      409
    )
  }
  if (inv.recurrence_id !== null && inv.recurrence_id !== ownSeries) {
    const [other] = await tx.select({ seq: billingRecurrence.seq }).from(billingRecurrence).where(eq(billingRecurrence.id, inv.recurrence_id))
    throw new InvoiceRefused(
      'template_in_another_series',
      `invoice ${inv.number} already belongs to series #${other?.seq}, and an invoice belongs to one series`,
      `bk billing recurrence show ${other?.seq}`,
      409
    )
  }
  const [company] = await tx.select({ retired_at: billingCompany.retired_at, slug: billingCompany.slug }).from(billingCompany).where(eq(billingCompany.id, inv.company_id))
  if (company.retired_at) {
    throw new InvoiceRefused('company_retired', `company ${company.slug} was retired and issues no new invoices, so a series from it could never generate`, 'use another company, or un-retire it first', 409)
  }
  return inv
}

async function lockRecurrence(tx: Tx, workspaceId: number, seq: number) {
  const [row] = await tx
    .select()
    .from(billingRecurrence)
    .where(and(eq(billingRecurrence.workspace_id, workspaceId), eq(billingRecurrence.seq, seq)))
    .limit(1)
    .for('update')
  if (!row) throw new InvoiceRefused('recurrence_not_found', `no series #${seq} in this workspace`, 'bk billing recurrence list', 404)
  return row
}

async function fresh(workspaceId: number, seq: number): Promise<Recurrence> {
  const r = await getRecurrence(workspaceId, seq)
  if (!r) throw new Error(`series #${seq} not readable after commit`)
  return r
}


// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * A series from an existing invoice.
 *
 * ── THE TEMPLATE MAY BE THE FIRST OCCURRENCE ───────────────────────────────
 * When the template's issue date falls in the period of `start_date`, the
 * template IS the bill for that period: it takes the period, the counter
 * starts at one, and the next date is one step on. Otherwise the counter starts
 * at zero and the first generation is for `start_date`'s own period.
 *
 * Without this, "make this month's invoice recurring" followed by the obvious
 * next command — generate this month — would put a second bill for this month
 * in the client's inbox. The mockup's two yearly series are exactly this shape.
 */
export async function createRecurrence(ctx: WriteCtx, raw: unknown): Promise<Recurrence> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvoiceRefused('invalid_body', 'a JSON body is required', 'bk billing recurrence create --template <ref> --frequency monthly --start 2026-10-01 --occurrences 12')
  }
  const b = raw as Partial<CreateRecurrenceBody> & Record<string, unknown>
  const known = new Set(['template', 'frequency', 'start_date', 'occurrences_total', 'label_fr', 'label_en', 'external_ref', 'metadata'])
  const unknown = Object.keys(b).filter((k) => !known.has(k))
  if (unknown.length > 0) {
    throw new InvoiceRefused('unknown_field', `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a field of a series`, `the fields are ${[...known].join(', ')}`)
  }
  if (typeof b.template !== 'string' && typeof b.template !== 'number') {
    throw new InvoiceRefused('template_required', 'a series is copied from an invoice: `template` is its #number or printed number', 'bk billing recurrence create --template 7 …')
  }
  assertFrequency(b.frequency)
  if (typeof b.start_date !== 'string' || !isCalendarDate(b.start_date)) {
    throw new InvoiceRefused('invalid_start_date', '`start_date` is a calendar date, YYYY-MM-DD', 'its day of the month is the day every occurrence falls on')
  }
  assertOccurrences(b.occurrences_total)
  const labelFr = cleanLabel(b.label_fr, 'label_fr') ?? null
  const labelEn = cleanLabel(b.label_en, 'label_en') ?? null
  if (b.metadata !== undefined) assertMeta(b.metadata)
  const externalRef = assertExternalRef(b.external_ref) ?? null
  const frequency = b.frequency
  const startDate = b.start_date
  const total = b.occurrences_total

  let seq: number
  try {
    seq = await getDb().transaction(async (tx) => {
      const tpl = await templateFor(tx, ctx.workspaceId, String(b.template), null, null)
      const startPeriod = periodKey(frequency, startDate)
      const templateIsFirst = periodKey(frequency, tpl.issue_date) === startPeriod
      const done = templateIsFirst ? 1 : 0
      const completed = done >= total
      const nextDue = completed ? null : templateIsFirst ? nextDate(frequency, startDate, anchorDay(startDate)) : startDate

      const s = await allocateSeq(tx, ctx.workspaceId, 'recurrence')
      const [rec] = await tx
        .insert(billingRecurrence)
        .values({
          workspace_id: ctx.workspaceId,
          seq: s,
          company_id: tpl.company_id,
          template_invoice_id: tpl.id,
          status: completed ? 'completed' : 'active',
          frequency,
          start_date: startDate,
          occurrences_total: total,
          occurrences_done: done,
          next_date: nextDue,
          label_fr: labelFr,
          label_en: labelEn,
          external_ref: externalRef,
          metadata: (b.metadata as Record<string, string>) ?? {},
          created_by: ctx.actorUserId,
        })
        .returning({ id: billingRecurrence.id })

      await tx
        .update(billingInvoice)
        .set({ recurrence_id: rec.id, ...(templateIsFirst ? { occurrence_period: startPeriod } : {}), updated_at: new Date() })
        .where(eq(billingInvoice.id, tpl.id))

      const base = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: ctx.via }
      const name = labelEn ?? labelFr ?? `#${s}`
      await appendAudit(tx, {
        ...base,
        subjectType: 'recurrence',
        subjectId: rec.id,
        subjectSeq: s,
        action: 'created',
        detailEn:
          `Series "${name}" created from ${tpl.number}: ${frequency}, ${total} occurrence(s) from ${startDate}` +
          (templateIsFirst ? `; ${tpl.number} is the ${startPeriod} occurrence` : ''),
        detailFr:
          `Série « ${labelFr ?? labelEn ?? `#${s}`} » créée depuis ${tpl.number} : ${frequency}, ${total} échéance(s) dès le ${startDate}` +
          (templateIsFirst ? ` ; ${tpl.number} est l’échéance ${startPeriod}` : ''),
      })
      await appendFieldChanges(
        tx,
        { ...base, subjectType: 'invoice', subjectId: tpl.id, subjectSeq: tpl.seq },
        [
          { field: 'recurrence', from: null, to: s },
          ...(templateIsFirst ? [{ field: 'occurrence_period', from: null, to: startPeriod }] : []),
        ]
      )
      return s
    })
  } catch (e) {
    if (isUniqueViolation(e, 'uq_recurrence_ws_external_ref')) {
      throw new InvoiceRefused('external_ref_taken', `another series in this workspace already has external_ref ${JSON.stringify(externalRef)}`, 'bk billing recurrence list', 409)
    }
    throw e
  }
  return fresh(ctx.workspaceId, seq)
}

// ---------------------------------------------------------------------------
// Edit, pause, resume
// ---------------------------------------------------------------------------

const EDITABLE = new Set(['label_fr', 'label_en', 'occurrences_total', 'template', 'status', 'external_ref', 'metadata'])
const NEVER: Record<string, string> = {
  frequency: 'every past occurrence was billed on it; end this series (lower occurrences_total to what is done) and create a new one',
  start_date: 'it anchors every date this series has produced; end this series and create a new one',
  occurrences_done: 'it counts what was generated, and only generating moves it',
  next_date: 'it is where the series stands, and only generating moves it',
  company: 'a series bills from one company; create a new series for another',
  seq: 'the #number is this series’ address',
}

/**
 * Change what may change. `status` takes `paused` or `active` only: `completed`
 * is what a series becomes at its cap, never something set.
 *
 * Lowering `occurrences_total` to what is already done ENDS the series — the
 * honest way to record that a client cancelled a contract. It cannot go below:
 * those occurrences exist.
 */
export async function editRecurrence(ctx: WriteCtx, seq: number, raw: unknown): Promise<Recurrence> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
    throw new InvoiceRefused('empty_patch', 'send at least one field to change', 'bk billing recurrence edit <seq> --label-en "…"')
  }
  const patch = raw as Record<string, unknown>
  for (const k of Object.keys(patch)) {
    if (NEVER[k]) throw new InvoiceRefused('field_not_editable', `${k} cannot be changed: ${NEVER[k]}`, 'omit it')
    if (!EDITABLE.has(k)) throw new InvoiceRefused('unknown_field', `${k} is not a field of a series`, `editable: ${[...EDITABLE].join(', ')}`)
  }
  if (patch.status !== undefined && patch.status !== 'paused' && patch.status !== 'active') {
    throw new InvoiceRefused(
      'invalid_status',
      patch.status === 'completed'
        ? 'a series is completed by its last occurrence, never by hand'
        : `status is paused or active; got ${JSON.stringify(patch.status)}`,
      patch.status === 'completed' ? 'to end it now, lower occurrences_total to what is done' : 'bk billing recurrence pause <seq> / resume <seq>'
    )
  }
  if (patch.occurrences_total !== undefined) assertOccurrences(patch.occurrences_total)
  const labelFr = cleanLabel(patch.label_fr, 'label_fr')
  const labelEn = cleanLabel(patch.label_en, 'label_en')
  if (patch.metadata !== undefined) assertMeta(patch.metadata)
  const externalRef = assertExternalRef(patch.external_ref)

  try {
    await getDb().transaction(async (tx) => {
      const rec = await lockRecurrence(tx, ctx.workspaceId, seq)
      const base = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: ctx.via, subjectType: 'recurrence' as const, subjectId: rec.id, subjectSeq: rec.seq }
      if (rec.status === 'completed' && (patch.status !== undefined || patch.occurrences_total !== undefined || patch.template !== undefined)) {
        throw new InvoiceRefused(
          'series_completed',
          `series #${seq} is completed (${rec.occurrences_done}/${rec.occurrences_total}); it cannot be resumed, extended or re-templated`,
          'a new agreement is a new series: bk billing recurrence create --template <ref> …',
          409
        )
      }

      const set: Partial<typeof billingRecurrence.$inferInsert> = {}
      const changes: Array<{ field: string; from: unknown; to: unknown }> = []
      const change = <K extends keyof typeof billingRecurrence.$inferInsert>(field: K, to: (typeof billingRecurrence.$inferInsert)[K], from: unknown) => {
        if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return
        set[field] = to
        changes.push({ field, from, to })
      }
      if (labelFr !== undefined) change('label_fr', labelFr, rec.label_fr)
      if (labelEn !== undefined) change('label_en', labelEn, rec.label_en)
      if (externalRef !== undefined) change('external_ref', externalRef, rec.external_ref)
      if (patch.metadata !== undefined) change('metadata', patch.metadata as Record<string, string>, rec.metadata)

      if (patch.template !== undefined) {
        const tpl = await templateFor(tx, ctx.workspaceId, String(patch.template), rec.company_id, rec.id)
        if (tpl.id !== rec.template_invoice_id) {
          const [old] = rec.template_invoice_id === null ? [] : await tx.select({ seq: billingInvoice.seq }).from(billingInvoice).where(eq(billingInvoice.id, rec.template_invoice_id))
          set.template_invoice_id = tpl.id
          changes.push({ field: 'template', from: old?.seq ?? null, to: tpl.seq })
          if (tpl.recurrence_id === null) {
            await tx.update(billingInvoice).set({ recurrence_id: rec.id, updated_at: new Date() }).where(eq(billingInvoice.id, tpl.id))
            await appendFieldChanges(tx, { ...base, subjectType: 'invoice', subjectId: tpl.id, subjectSeq: tpl.seq }, [{ field: 'recurrence', from: null, to: rec.seq }])
          }
        }
      }

      if (patch.occurrences_total !== undefined && patch.occurrences_total !== rec.occurrences_total) {
        const total = patch.occurrences_total as number
        if (total < rec.occurrences_done) {
          throw new InvoiceRefused(
            'below_done',
            `series #${seq} has already produced ${rec.occurrences_done} occurrence(s); its total cannot go below that`,
            `--occurrences ${rec.occurrences_done} ends it now`,
            409
          )
        }
        set.occurrences_total = total
        changes.push({ field: 'occurrences_total', from: rec.occurrences_total, to: total })
        if (total === rec.occurrences_done) {
          // Ended early. `completed` with no next date, in the same UPDATE:
          // `recurrence_completed_by_the_cap` holds all three together.
          set.status = 'completed'
          set.next_date = null
        }
      }

      if (patch.status !== undefined && patch.status !== rec.status && set.status !== 'completed') {
        set.status = patch.status as 'active' | 'paused'
      }

      if (Object.keys(set).length === 0) return
      await tx.update(billingRecurrence).set({ ...set, updated_at: new Date() }).where(eq(billingRecurrence.id, rec.id))
      await appendFieldChanges(tx, base, changes)
      if (set.status !== undefined && set.status !== rec.status) {
        const en: Record<string, string> = {
          paused: 'Paused — refuses to generate until resumed',
          active: 'Resumed',
          completed: `Ended at ${rec.occurrences_done} of the ${rec.occurrences_total} agreed occurrences`,
        }
        const fr: Record<string, string> = {
          paused: 'Suspendue — refuse de générer jusqu’à reprise',
          active: 'Reprise',
          completed: `Terminée à ${rec.occurrences_done} des ${rec.occurrences_total} échéances convenues`,
        }
        await appendAudit(tx, { ...base, action: 'status_changed', field: 'status', from: rec.status, to: set.status, detailEn: en[set.status], detailFr: fr[set.status] })
      }
    })
  } catch (e) {
    if (isUniqueViolation(e, 'uq_recurrence_ws_external_ref')) {
      throw new InvoiceRefused('external_ref_taken', 'another series in this workspace already has that external_ref', 'bk billing recurrence list', 409)
    }
    throw e
  }
  return fresh(ctx.workspaceId, seq)
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export function parseGenerateInput(raw: unknown): { period: string; issueDate: string | null; message: string | null | undefined } {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const unknown = Object.keys(b).filter((k) => !['period', 'issue_date', 'message'].includes(k))
  if (unknown.length > 0) throw new InvoiceRefused('unknown_field', `${unknown.join(', ')} not understood`, 'the fields are period, issue_date and message')
  if (typeof b.period !== 'string' || b.period.trim() === '') {
    throw new InvoiceRefused(
      'period_required',
      '`period` is required: the period this occurrence bills. It is never inferred — an inferred period is how a retry bills the next quarter early',
      'bk billing recurrence show <seq> prints the next period; pass it with --period'
    )
  }
  let issueDate: string | null = null
  if (b.issue_date !== undefined && b.issue_date !== null) {
    if (typeof b.issue_date !== 'string' || !isCalendarDate(b.issue_date)) {
      throw new InvoiceRefused('invalid_issue_date', '`issue_date` is a calendar date, YYYY-MM-DD', 'omit it to issue today')
    }
    issueDate = b.issue_date
  }
  let message: string | null | undefined
  if (b.message !== undefined) {
    if (b.message !== null && typeof b.message !== 'string') throw new InvoiceRefused('invalid_message', '`message` is text or null', 'omit it to copy the template’s')
    message = b.message === null ? null : (b.message as string)
  }
  return { period: b.period.trim(), issueDate, message }
}

/**
 * The next occurrence — or the replacement for a voided one — as a DRAFT.
 *
 * One transaction: lock the series; check its status, template and the period;
 * create the invoice through `insertInvoice`; advance the counter. A counter that
 * advanced without an invoice, or an invoice without an advanced counter, would
 * each produce a wrong bill next time, so they commit together or not at all.
 */
export async function generateOccurrence(ctx: WriteCtx, seq: number, raw: unknown): Promise<GenerateOccurrenceResult> {
  const input = parseGenerateInput(raw)
  let result: { invoiceSeq: number; replacement: boolean }
  try {
    result = await getDb().transaction(async (tx) => {
      const rec = await lockRecurrence(tx, ctx.workspaceId, seq)
      const frequency = rec.frequency as RecurrenceFrequency

      if (rec.status === 'completed') {
        throw new InvoiceRefused(
          'series_completed',
          `series #${seq} is completed: all ${rec.occurrences_total} agreed occurrences exist`,
          'a new agreement is a new series: bk billing recurrence create --template <ref> …',
          409
        )
      }
      if (rec.status === 'paused') {
        throw new InvoiceRefused('series_paused', `series #${seq} is paused and generates nothing until resumed`, `bk billing recurrence resume ${seq}`, 409)
      }
      if (rec.template_invoice_id === null) {
        throw new InvoiceRefused(
          'no_template',
          `series #${seq} has no template in this app — it predates it — so there is nothing to copy`,
          `bk billing recurrence edit ${seq} --template <ref>`,
          409
        )
      }
      if (!PERIOD_SHAPE[frequency].test(input.period)) {
        throw new InvoiceRefused(
          'invalid_period',
          `${JSON.stringify(input.period)} is not a ${frequency} period`,
          `a ${frequency} period looks like ${PERIOD_EXAMPLE[frequency]}; series #${seq}'s next is ${periodKey(frequency, rec.next_date!)}`
        )
      }

      const inPeriod = await tx
        .select({ seq: billingInvoice.seq, number: billingInvoice.number, status: billingInvoice.status })
        .from(billingInvoice)
        .where(and(eq(billingInvoice.recurrence_id, rec.id), eq(billingInvoice.occurrence_period, input.period)))
      const live = inPeriod.find((i) => i.status !== 'void')
      if (live) throw alreadyGenerated(seq, input.period, live)

      const expected = periodKey(frequency, rec.next_date!)
      const replacement = input.period !== expected
      if (replacement && inPeriod.length === 0) {
        // REFUSE, DO NOT SUBSTITUTE. The subject-parameter rule: a period that
        // changes which bill this is must be the one the caller means, and a
        // substitution here would be a real invoice for a period nobody asked for.
        throw new InvoiceRefused(
          'period_not_expected',
          `series #${seq}'s next period is ${expected} (due ${rec.next_date}); ${input.period} is not it, and no voided occurrence of ${input.period} is waiting for a replacement`,
          `bk billing recurrence generate ${seq} --period ${expected}`,
          409
        )
      }

      const [tplRow] = await tx.select({ seq: billingInvoice.seq }).from(billingInvoice).where(eq(billingInvoice.id, rec.template_invoice_id))
      const tpl = tplRow ? await getInvoice(ctx.workspaceId, String(tplRow.seq), tx) : null
      if (!tpl) throw new Error(`series #${seq}'s template vanished`)

      // Everything that makes the bill, copied; nothing that identifies the
      // template (its number, its reference body, its external_ref, its
      // metadata) and nothing about its delivery.
      const body: CreateInvoiceBody = {
        company: tpl.company,
        currency: tpl.currency,
        language: tpl.language,
        ref_type: tpl.ref_type,
        client: tpl.client,
        vat_rate: tpl.vat_rate,
        prices_include_vat: tpl.prices_include_vat,
        message: input.message === undefined ? tpl.message : input.message,
        issue_date: input.issueDate ?? todayInZurich(),
        items: tpl.items.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate })),
      }
      const inv = await insertInvoice(tx, ctx, body, { recurrenceId: rec.id, period: input.period })

      const base = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: ctx.via, subjectType: 'recurrence' as const, subjectId: rec.id, subjectSeq: rec.seq }
      if (replacement) {
        await appendAudit(tx, {
          ...base,
          action: 'field_changed',
          field: 'replacement',
          from: inPeriod.map((i) => i.number).join(', '),
          to: inv.number,
          detailEn: `${inv.number} replaces the voided ${inPeriod.map((i) => i.number).join(', ')} for ${input.period}; the counter stays at ${rec.occurrences_done}/${rec.occurrences_total}`,
          detailFr: `${inv.number} remplace ${inPeriod.map((i) => i.number).join(', ')} (annulée) pour ${input.period} ; le compteur reste à ${rec.occurrences_done}/${rec.occurrences_total}`,
        })
        return { invoiceSeq: inv.seq, replacement: true }
      }

      const next = advance({
        status: rec.status as RecurrenceStatus,
        frequency,
        start_date: rec.start_date,
        occurrences_done: rec.occurrences_done,
        occurrences_total: rec.occurrences_total,
        next_date: rec.next_date,
      })
      await tx.update(billingRecurrence).set({ ...next, updated_at: new Date() }).where(eq(billingRecurrence.id, rec.id))
      await appendAudit(tx, {
        ...base,
        action: 'field_changed',
        field: 'occurrences_done',
        from: String(rec.occurrences_done),
        to: String(next.occurrences_done),
        detailEn: `${inv.number} generated for ${input.period} (${next.occurrences_done}/${rec.occurrences_total})` + (next.next_date ? `; next ${next.next_date}` : '; the series is complete'),
        detailFr: `${inv.number} générée pour ${input.period} (${next.occurrences_done}/${rec.occurrences_total})` + (next.next_date ? ` ; prochaine le ${next.next_date}` : ' ; la série est terminée'),
      })
      if (next.status === 'completed') {
        await appendAudit(tx, {
          ...base,
          action: 'status_changed',
          field: 'status',
          from: rec.status,
          to: 'completed',
          detailEn: `Completed: all ${rec.occurrences_total} agreed occurrences exist`,
          detailFr: `Terminée : les ${rec.occurrences_total} échéances convenues existent`,
        })
      }
      return { invoiceSeq: inv.seq, replacement: false }
    })
  } catch (e) {
    if (isUniqueViolation(e, 'uq_invoice_occurrence')) {
      // A live occurrence of this period was written by a path that did not
      // take the series lock. The index held; say so as the same refusal.
      const [rec] = await getDb().select({ id: billingRecurrence.id }).from(billingRecurrence).where(and(eq(billingRecurrence.workspace_id, ctx.workspaceId), eq(billingRecurrence.seq, seq)))
      const [live] = rec
        ? await getDb()
            .select({ seq: billingInvoice.seq, number: billingInvoice.number })
            .from(billingInvoice)
            .where(and(eq(billingInvoice.recurrence_id, rec.id), eq(billingInvoice.occurrence_period, input.period), ne(billingInvoice.status, 'void')))
        : []
      throw alreadyGenerated(seq, input.period, live ?? { seq: 0, number: '(unknown)' })
    }
    throw e
  }

  const invoice = await getInvoice(ctx.workspaceId, String(result.invoiceSeq))
  if (!invoice) throw new Error(`invoice #${result.invoiceSeq} not readable after commit`)
  return { invoice, recurrence: await fresh(ctx.workspaceId, seq), replacement: result.replacement }
}

function alreadyGenerated(seriesSeq: number, period: string, live: { seq: number; number: string }): InvoiceRefused {
  return new InvoiceRefused(
    'already_generated',
    `series #${seriesSeq} already has ${live.number} (#${live.seq}) for ${period}; nothing was created`,
    `bk billing invoice show ${live.seq} — to replace it, void it first and generate ${period} again`,
    409
  )
}


/** A series' row id from its #number, for the audit route's `?subject=recurrence:<seq>`. */
export async function recurrenceIdOf(workspaceId: number, seq: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: billingRecurrence.id })
    .from(billingRecurrence)
    .where(and(eq(billingRecurrence.workspace_id, workspaceId), eq(billingRecurrence.seq, seq)))
    .limit(1)
  return row?.id ?? null
}
