// The DEVELOPMENT seed: the mockup's own data, an empty tenant, and the one
// customer shape the mockup does not have.
//
//   npm run db:seed:billing
//
// ===========================================================================
// THREE WORKSPACES, AND WHY EACH ONE
// ===========================================================================
//   blackcode      THE MOCKUP. Its two companies, its eleven invoices (a void,
//                  an EUR bill on SCOR, a not-registered company with no VAT at
//                  all, one draft each), and its fourteen imported bills — read
//                  from `fixtures/mockup.json`, never retyped. At the end the
//                  seed reads every invoice back through the app's own read
//                  path and refuses to finish if one total, reference or
//                  account differs from what the mockup's code says.
//   demo-tenant    ONE company and nothing else. The state a new tenant is in,
//                  and the only way a leak between tenants becomes visible:
//                  while every workspace has data, a read that forgot its
//                  workspace looks exactly like one that remembered.
//   praxis-demo    Decision D-B7's shape, which came from the first external
//                  customer after the mockup was finished: prices INCLUDING
//                  VAT, an exempt line beside taxable ones, three rates on one
//                  bill, rounding on the total only. In its own workspace so
//                  the mockup tenant stays exactly the mockup.
//
// ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//   - THE MOCKUP'S FOUR RECURRENCES. Phase 4 (recurrence) is not built, so
//     there is no table to put them in; the four invoices the mockup attaches
//     to a series are seeded as ordinary invoices. Phase 4 adds them.
//   - THE MOCKUP'S AUDIT TRAIL. The log records what somebody DID, and its
//     fifteen entries name mockup actors ("andrea", "companion") that are not
//     accounts. Inventing rows in an append-only table nothing can correct is
//     worse than a gap, so every seeded workspace starts with an empty log and
//     the first real edit fills it. The plan listed the trail; this is the
//     deliberate difference.
//
// ── EVERY PLACEHOLDER IS A PLACEHOLDER ─────────────────────────────────────
// The mockup's UIDs and IBANs are not blackcode's (open questions P1 and P2),
// its VAT rates are unverified against the ESTV (P3), and its QR reference
// bodies predate the scheme the bank has to agree (P11). The seed carries them
// because the screens need them; none of them may be used for a real invoice.
//
// ===========================================================================
// IT REFUSES A NON-LOCAL DATABASE, AND THE REFUSAL IS THE POINT
// ===========================================================================
// This script DELETES the workspaces it rebuilds. Against production that would
// destroy invoices — numbered legal documents under a ten-year retention duty
// that `0006` revokes DELETE on, so the delete would fail halfway and leave a
// workspace in pieces.
//
// The host check is first, before any connection is opened, and it is a
// positive assertion rather than a blocklist: an unrecognised host is refused.
// `seed-guard.test.ts` beside `lib/db/seed-guard.ts` proves the refusal fires.

import { config } from 'dotenv'
import { eq, sql } from 'drizzle-orm'

config({ path: '.env.local' })
config({ path: '.env' })

import { getDb } from '../lib/db/client'
import {
  billingCompany,
  billingCounters,
  billingInvoice,
  billingInvoiceLine,
  billingRecurrence,
  billingWorkspaceMembers,
  billingWorkspaces,
  users,
} from '../lib/db/schema'
import { renderNumber } from '../lib/derive/number'
import { assertLocalDatabase } from '../lib/db/seed-guard'
import { MOCKUP, mockupHistoryRows } from '../lib/mockup'
import { importHistory } from '../lib/db/queries/history'
import { getInvoice } from '../lib/db/queries/invoices'
import { issuerSnapshot } from '../lib/issuer'
import { getRecurrence } from '../lib/db/queries/recurrences'
import { periodKey } from '../lib/derive/recurrence'
import type { RecurrenceFrequency } from '../types'

// Module scope, so every helper shares one client. `getDb()` is lazy, so this
// opens nothing at import time.
const db = getDb()

/**
 * Delete a seeded workspace and everything under it.
 *
 * ===========================================================================
 * THE NO-DELETE TRIGGERS REFUSE THIS, AND THEY ARE RIGHT TO
 * ===========================================================================
 * Measured 2026-09-17, the first time this seed ran against a migrated
 * database:
 *
 *   ERROR: company rows are never deleted (art. 958f CO, ten-year retention)
 *   CONTEXT: SQL statement "DELETE FROM ONLY billing.company WHERE …"
 *
 * `trg_no_hard_delete` fires on the CASCADE from `billing.workspaces`, and it
 * fires for the OWNER too — which is exactly what its header in migration 0005
 * promises: "the trigger stops anything running as owner, including a migration
 * or a console session".
 *
 * So the guard works. What is needed is a narrow, visible exception for the one
 * legitimate case: a development seed rebuilding a development workspace.
 *
 * ── HOW THE EXCEPTION IS MADE SAFE ─────────────────────────────────────────
 * Three properties, and all three matter:
 *
 *  1. **It is only possible as the owner.** `ALTER TABLE … DISABLE TRIGGER`
 *     needs table ownership, which `billing_app` does not have and never will.
 *     The app cannot take this path even by accident.
 *  2. **It is inside ONE transaction.** DDL is transactional in Postgres, so a
 *     crash between the disable and the re-enable ROLLS BACK the disable. There
 *     is no window in which the triggers are off and the script is not running.
 *     A `try/finally` would have that window; this does not.
 *  3. **The host was already checked**, before any connection was opened, by
 *     `assertLocalDatabase`.
 *
 * The alternative considered and rejected was `SET session_replication_role =
 * replica`, which is one line and disables EVERY trigger including foreign-key
 * enforcement. That would let this seed insert a line against a non-existent
 * invoice and not find out.
 */
async function rebuildFrom(workspaceId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Named individually rather than looped over `pg_trigger`, so this list is
    // a decision a reader can check against 0005 rather than "whatever happens
    // to be installed".
    for (const table of ['company', 'invoice', 'audit', 'recurrence']) {
      await tx.execute(sql.raw(`ALTER TABLE billing.${table} DISABLE TRIGGER trg_no_hard_delete`))
    }
    await tx.execute(sql.raw('ALTER TABLE billing.audit DISABLE TRIGGER trg_audit_append_only'))
    // The archive (0010) refuses a DELETE even from the owner, so the cascade
    // from the workspace stops at it the moment anybody has imported into the
    // seeded workspace — which the frontend does to see the history screen.
    await tx.execute(sql.raw('ALTER TABLE billing.history DISABLE TRIGGER trg_history_read_only'))

    await tx.delete(billingWorkspaces).where(eq(billingWorkspaces.id, workspaceId))

    for (const table of ['company', 'invoice', 'audit', 'recurrence']) {
      await tx.execute(sql.raw(`ALTER TABLE billing.${table} ENABLE TRIGGER trg_no_hard_delete`))
    }
    await tx.execute(sql.raw('ALTER TABLE billing.audit ENABLE TRIGGER trg_audit_append_only'))
    await tx.execute(sql.raw('ALTER TABLE billing.history ENABLE TRIGGER trg_history_read_only'))
  })

  // A POSITIVE assertion that the guards are back, because the cost of getting
  // this wrong is a database where invoices can be deleted and nothing says so.
  // Reading `pg_trigger` rather than trusting the statements above: check the
  // catalog, not the repo (CLAUDE.md finding #20).
  const off = await db.execute<{ tbl: string; trigger: string }>(sql`
    SELECT c.relname AS tbl, t.tgname AS trigger
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'billing' AND NOT t.tgisinternal AND t.tgenabled = 'D'
  `)
  if (off.rows.length > 0) {
    throw new Error(
      'the no-delete guards are still DISABLED after the rebuild: ' +
        off.rows.map((r) => `${r.tbl}.${r.trigger}`).join(', ') +
        '\nRe-enable them by hand before using this database:\n' +
        off.rows
          .map((r) => `  ALTER TABLE billing.${r.tbl} ENABLE TRIGGER ${r.trigger};`)
          .join('\n')
    )
  }
}

/** A fresh workspace with the owner as its only member. Any previous one of that slug is removed first. */
async function freshWorkspace(slug: string, name: string, ownerId: number): Promise<number> {
  const existing = await db
    .select({ id: billingWorkspaces.id })
    .from(billingWorkspaces)
    .where(eq(billingWorkspaces.slug, slug))
    .limit(1)
  if (existing[0]) await rebuildFrom(existing[0].id)
  const [ws] = await db
    .insert(billingWorkspaces)
    .values({ name, slug, owner_id: ownerId })
    .returning({ id: billingWorkspaces.id })
  await db.insert(billingWorkspaceMembers).values({ workspace_id: ws.id, user_id: ownerId, role: 'owner' })
  return ws.id
}

type CompanyValues = Omit<typeof billingCompany.$inferInsert, 'workspace_id' | 'id'>

async function insertCompany(workspaceId: number, ownerId: number, c: CompanyValues): Promise<number> {
  const [row] = await db
    .insert(billingCompany)
    .values({ ...c, workspace_id: workspaceId, created_by: ownerId })
    .returning({ id: billingCompany.id })
  return row.id
}

interface SeedInvoice {
  seq: number
  companyId: number
  seqNo: number
  number: string
  status: 'draft' | 'sent' | 'paid' | 'void'
  issue_date: string
  due_date: string | null
  paid_date?: string | null
  currency: string
  language: string
  ref_type: 'QRR' | 'SCOR' | 'NON'
  ref_body: string | null
  client: Record<string, string | null>
  vat_rate: string | null
  prices_include_vat: boolean
  message: string | null
  void?: { ts: string; reason: { fr: string; en: string } }
  items: Array<{ description: string; qty: string; unit: string | null; unit_price: string; vat_rate: string | null }>
}

/**
 * One invoice, inserted as a DRAFT and then walked through the real status
 * machine.
 *
 * Not a workaround. Two guards refuse the shortcut, and both are right:
 * `trg_invoice_line_frozen` refuses a line on an invoice that is not a draft,
 * because the lines of a sent bill ARE the document; and
 * `trg_invoice_status_machine` refuses `draft → paid`, because a bill nobody
 * sent cannot have been paid. So the seed does what really happens: a draft,
 * its lines, sent, then paid or voided. Every seeded row has therefore passed
 * through the transitions the app's own write paths use.
 */
async function insertInvoice(workspaceId: number, owner: { id: number; email: string }, inv: SeedInvoice): Promise<number> {
  const [row] = await db
    .insert(billingInvoice)
    .values({
      workspace_id: workspaceId,
      seq: inv.seq,
      company_id: inv.companyId,
      seq_no: inv.seqNo,
      number: inv.number,
      status: 'draft',
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      currency: inv.currency,
      language: inv.language,
      ref_type: inv.ref_type,
      ref_body: inv.ref_body,
      client: inv.client,
      vat_rate: inv.vat_rate,
      prices_include_vat: inv.prices_include_vat,
      message: inv.message,
      created_by: owner.id,
    })
    .returning({ id: billingInvoice.id })

  await db.insert(billingInvoiceLine).values(
    inv.items.map((l, i) => ({
      invoice_id: row.id,
      line_no: i + 1,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
      vat_rate: l.vat_rate,
    }))
  )

  // `sent_at` in the same statement: 0007's `invoice_sent_requires_sent_at`
  // refuses a sent invoice with no moment it was sent. No `sent_message_id` and
  // no `pdf_sha256` — seeded bills were never emailed by this app, and a null
  // there is how the record says so, the shape `invoice mark-sent` produces.
  //
  // `issuer` in the same statement too: 0011's `invoice_issuer_iff_issued`
  // refuses an invoice that left draft without its copy of the company
  // (invariant I12). Taken from the company row as seeded, stamped with the
  // moment the seed says the bill went out — what `mark-sent` would have stored.
  const leftDraftAt = new Date(`${inv.issue_date}T09:00:00.000Z`)
  const issuerNow = async () => {
    const [company] = await db.select().from(billingCompany).where(eq(billingCompany.id, inv.companyId)).limit(1)
    return issuerSnapshot(company, leftDraftAt)
  }
  if (inv.status !== 'draft') {
    await db
      .update(billingInvoice)
      .set({ status: 'sent', sent_at: leftDraftAt, issuer: await issuerNow() })
      .where(eq(billingInvoice.id, row.id))
  }
  if (inv.status === 'paid') {
    // `paid_date` in the SAME statement: `invoice_paid_requires_date`.
    await db
      .update(billingInvoice)
      .set({ status: 'paid', paid_date: inv.paid_date! })
      .where(eq(billingInvoice.id, row.id))
  }
  if (inv.status === 'void') {
    // The record in the same statement: `invoice_void_requires_record` refuses a
    // void with no reason, because a void without one is a deletion with extra
    // steps. `by` is the seeding account: the mockup's "andrea" is not one.
    await db
      .update(billingInvoice)
      .set({ status: 'void', void: { ts: inv.void!.ts, by: owner.email, reason: inv.void!.reason } })
      .where(eq(billingInvoice.id, row.id))
  }
  return row.id
}

/** Bring the #number allocators in line with what was inserted directly. */
async function setCounters(workspaceId: number, counts: { company: number; invoice: number; recurrence?: number }): Promise<void> {
  await db.insert(billingCounters).values([
    { workspace_id: workspaceId, entity_type: 'company', last_value: counts.company },
    { workspace_id: workspaceId, entity_type: 'invoice', last_value: counts.invoice },
    { workspace_id: workspaceId, entity_type: 'recurrence', last_value: counts.recurrence ?? 0 },
    { workspace_id: workspaceId, entity_type: 'audit', last_value: 0 },
  ])
}

// ---------------------------------------------------------------------------
// 1. blackcode — the mockup
// ---------------------------------------------------------------------------

/** The mockup's company ids, as slugs in this app. */
const MOCKUP_SLUG: Record<number, string> = { 1: 'blackcode', 2: 'aurora', 9: 'demo' }

function companyFromMockup(c: (typeof MOCKUP.companies)[number], seq: number): CompanyValues {
  const registered = c.vat_registered
  return {
    seq,
    slug: MOCKUP_SLUG[c.id],
    name: c.name,
    legal_name: c.legal_name,
    street: c.street,
    building: c.building,
    postal_code: c.postal_code,
    city: c.city,
    country: c.country,
    email: c.email,
    logo_initials: c.logo.initials,
    logo_color: c.logo.color,
    // ⚠ PLACEHOLDERS (P2): the mockup's IBANs and UIDs are not anybody's real
    // accounts. The screens need them; a real invoice must not carry them.
    iban: c.iban,
    qr_iban: c.qr_iban,
    vat_registered: registered,
    uid: c.uid,
    vat_number: c.vat_number,
    default_currency: c.default_currency,
    default_language: c.default_language,
    default_ref_type: c.default_ref_type,
    // ⚠ P3: 8.1 is the mockup's unverified standard rate.
    default_vat_rate: registered ? '8.10' : null,
    default_prices_include_vat: false,
    payment_terms_days: c.payment_terms_days,
    // The mockup rounds every line and every VAT amount to five rappen.
    rounding: 'line_0_05',
    number_format: c.number_format,
    next_seq: c.next_seq,
  }
}

async function seedMockup(owner: { id: number; email: string }): Promise<{ workspaceId: number; invoices: number; history: number; series: number }> {
  const wsId = await freshWorkspace('blackcode', 'blackcode', owner.id)
  const mockupWs = MOCKUP.workspaces.find((w) => w.slug === 'blackcode')!

  const companies = MOCKUP.companies.filter((c) => c.workspace_id === mockupWs.id)
  const companyIds = new Map<number, number>()
  for (const [i, c] of companies.entries()) {
    companyIds.set(c.id, await insertCompany(wsId, owner.id, companyFromMockup(c, i + 1)))
  }

  const invoices = MOCKUP.invoices.filter((i) => i.workspace_id === mockupWs.id).sort((a, b) => a.id - b.id)
  const invoiceIds = new Map<number, number>()
  for (const [i, inv] of invoices.entries()) {
    const company = companies.find((c) => c.id === inv.company_id)!
    // The mockup's number is DATA here, and the app renders numbers from a
    // format. If the two ever disagree, a seeded invoice would carry a number
    // this app could never have issued — so disagreement stops the seed.
    const rendered = renderNumber(company.number_format, Number(inv.issue_date.slice(0, 4)), inv.seq)
    if (rendered !== inv.number) {
      throw new Error(`mockup invoice ${inv.id} is numbered ${inv.number}, but ${company.number_format} renders ${rendered}`)
    }
    const rate = inv.vat_rate === null ? null : inv.vat_rate.toFixed(2)
    const invoiceId = await insertInvoice(wsId, owner, {
      seq: i + 1,
      companyId: companyIds.get(inv.company_id)!,
      seqNo: inv.seq,
      number: inv.number,
      status: inv.status as SeedInvoice['status'],
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      paid_date: inv.paid_date,
      currency: inv.currency,
      language: inv.language,
      ref_type: inv.ref_type as SeedInvoice['ref_type'],
      ref_body: inv.ref_body,
      client: inv.client,
      vat_rate: rate,
      prices_include_vat: false,
      message: qrSafeMessage(inv.message ?? null),
      void: inv.void ? { ts: inv.void.ts, reason: inv.void.reason } : undefined,
      // The mockup has ONE rate per invoice; this app has one per line (D-B7).
      // Every line takes the invoice's rate, which is what the mockup means.
      items: inv.items.map((it) => ({
        description: it.description,
        qty: String(it.qty),
        unit: it.unit ?? null,
        unit_price: it.unit_price.toFixed(2),
        vat_rate: rate,
      })),
    })
    invoiceIds.set(inv.id, invoiceId)
  }

  const series = await seedRecurrences(wsId, owner.id, companyIds, invoiceIds)

  // `next_seq` is the mockup's, and must lie beyond every number issued, or the
  // next real create would collide with a seeded one.
  for (const c of companies) {
    const highest = Math.max(0, ...invoices.filter((i) => i.company_id === c.id).map((i) => i.seq))
    if (c.next_seq <= highest) {
      throw new Error(`mockup company ${c.id} says next_seq ${c.next_seq}, but it has already issued ${highest}`)
    }
  }
  await setCounters(wsId, { company: companies.length, invoice: invoices.length, recurrence: series })

  // THROUGH THE REAL WRITE DOOR, as the agent that owns an import would. The
  // seed is that agent here, so `via` is `token`.
  const imported = await importHistory(
    { workspaceId: wsId, actorUserId: owner.id, via: 'token' },
    { rows: mockupHistoryRows((id) => MOCKUP_SLUG[id]) }
  )

  return { workspaceId: wsId, invoices: invoices.length, history: imported.imported, series }
}

/**
 * The mockup's four series, AS DATA — status, counter and next date exactly as
 * the mockup states them — and the period of each invoice that carries one.
 *
 * Inserted directly rather than through `createRecurrence`, for the reason the
 * invoices are: a series with two occurrences already behind it cannot be
 * produced through today's write door without inventing when they happened.
 * `assertParity` reads every one back through `getRecurrence` and fails the seed
 * on any difference, and the CHECKs in 0012 refuse a state the app could not
 * reach (a completed series with a next date, a counter past its cap).
 *
 * An invoice's period is the one its ISSUE DATE falls in. That is what makes the
 * mockup's BC-2026-0033 (void) and BC-2026-0034 one occurrence: both were issued
 * in the Junod series' second quarter.
 *
 * ── ONE THING IN THE MOCKUP'S DATA DOES NOT ADD UP, AND IS SEEDED AS IS ─────
 * Junod (quarterly from 2026-01-05) has two occurrences done and its next date
 * in Q4 — a quarter after Q1 + Q2 would put it. The mockup shows no Q1 invoice
 * and no Q3 one. The app computes the NEXT date from the stored one, never from
 * the count, so this is faithfully reproduced rather than "corrected"; it is on
 * the list of questions for Andrea (apps/billing/docs/backend.md, phase 4).
 */
async function seedRecurrences(
  wsId: number,
  ownerId: number,
  companyIds: Map<number, number>,
  invoiceIds: Map<number, number>
): Promise<number> {
  const rules = MOCKUP.recurrences.filter((r) => r.workspace_id === 1).sort((a, b) => a.id - b.id)
  for (const [i, r] of rules.entries()) {
    const [row] = await db
      .insert(billingRecurrence)
      .values({
        workspace_id: wsId,
        seq: i + 1,
        company_id: companyIds.get(r.company_id)!,
        template_invoice_id: r.template_invoice_id === null ? null : invoiceIds.get(r.template_invoice_id)!,
        status: r.status,
        frequency: r.frequency,
        start_date: r.start_date,
        occurrences_total: r.occurrences_total,
        occurrences_done: r.occurrences_done,
        next_date: r.next_date,
        label_fr: r.label.fr,
        label_en: r.label.en,
        created_by: ownerId,
      })
      .returning({ id: billingRecurrence.id })
    for (const inv of MOCKUP.invoices.filter((x) => x.recurrence_id === r.id)) {
      await db
        .update(billingInvoice)
        .set({ recurrence_id: row.id, occurrence_period: periodKey(r.frequency as RecurrenceFrequency, inv.issue_date) })
        .where(eq(billingInvoice.id, invoiceIds.get(inv.id)!))
    }
  }
  return rules.length
}

/**
 * Read every seeded mockup invoice back through `getInvoice` — the app's own
 * read path, derivations included — and compare it with what the mockup's code
 * answers. Any difference stops the seed with every mismatch listed.
 *
 * This is the half of parity `lib/derive/parity.test.ts` cannot prove: that
 * the DATA that went in reproduces the numbers, not only that the maths would.
 */
/**
 * THE ONE PLACE THE SEED DEPARTS FROM THE MOCKUP'S TEXT, AND WHY.
 *
 * Every payment message in the mockup carries an em dash — "Facture
 * BC-2026-0031 — pilote terrain" — and U+2014 is outside the character set a
 * Swiss QR Code may carry (§4.1.1). The mockup never noticed because its QR is a
 * deliberate fake that encodes nothing. Seeded verbatim, all eleven bills were
 * refused by `invoice pdf`, `invoice qr` and `invoice send` — found 2026-09-18
 * by the first PDF fetched over HTTP.
 *
 * The APP does not substitute (the write door refuses the character and says
 * so); the SEED may, because it is the author of this data. Only U+2014, only in
 * the message, and `assertParity` below fails the seed if any seeded bill still
 * is not a valid QR-bill. Line descriptions keep their dashes: they are printed,
 * never encoded.
 */
function qrSafeMessage(message: string | null): string | null {
  return message === null ? null : message.replace(/\u2014/g, '-')
}

async function assertParity(workspaceId: number): Promise<number> {
  const digits = (s: string) => s.replace(/\s/g, '')
  const invoices = MOCKUP.invoices.filter((i) => i.workspace_id === 1).sort((a, b) => a.id - b.id)
  const problems: string[] = []
  for (const [i, m] of invoices.entries()) {
    const inv = await getInvoice(workspaceId, String(i + 1))
    const a = MOCKUP.answers[String(m.id) as keyof typeof MOCKUP.answers]
    if (!inv) {
      problems.push(`#${i + 1} (${m.number}) did not read back`)
      continue
    }
    const check = (what: string, ours: string | null, theirs: string | null) => {
      if (ours !== theirs) problems.push(`${m.number} ${what}: this app ${ours}, the mockup ${theirs}`)
    }
    check('number', inv.number, m.number)
    check('subtotal', inv.totals.subtotal, digits(a.subtotal))
    check('VAT', inv.totals.vat_total, digits(a.vat))
    check('total', inv.totals.total, digits(a.total))
    // From the app's OWN `derived` block — what `invoice show`, the screens and
    // the PDF all read — not re-derived here, which would be the seed agreeing
    // with itself. `derived.account` comes from the invoice's issuer: the copy
    // taken at issue for a sent bill, the seeded company for a draft.
    check('reference', inv.derived.reference, a.reference)
    check('printed reference', inv.derived.reference_formatted, a.reference_formatted)
    check('account', inv.derived.account_formatted, a.account_formatted === '—' ? null : a.account_formatted)
    // …and every bill that carries a payment part is one the standard accepts,
    // so `invoice pdf` serves the whole seeded workspace.
    for (const p of inv.derived.problems) problems.push(`${m.number} is not a valid QR-bill: [${p.code}] ${p.message}`)
    if ((inv.status === 'draft') !== (inv.issuer === null)) {
      problems.push(`${m.number} is ${inv.status} and its issuer copy is ${inv.issuer === null ? 'missing' : 'present'}`)
    }
  }

  // The series, read back through the app's own read — and each one's
  // invoices, which is where a wrong period or a lost link would show.
  const rules = MOCKUP.recurrences.filter((r) => r.workspace_id === 1).sort((a, b) => a.id - b.id)
  for (const [i, m] of rules.entries()) {
    const r = await getRecurrence(workspaceId, i + 1)
    if (!r) {
      problems.push(`series #${i + 1} (${m.label.en}) did not read back`)
      continue
    }
    const check = (what: string, ours: unknown, theirs: unknown) => {
      if (ours !== theirs) problems.push(`series "${m.label.en}" ${what}: this app ${ours}, the mockup ${theirs}`)
    }
    check('status', r.status, m.status)
    check('frequency', r.frequency, m.frequency)
    check('occurrences', `${r.occurrences_done}/${r.occurrences_total}`, `${m.occurrences_done}/${m.occurrences_total}`)
    check('next date', r.next_date, m.next_date)
    const tpl = m.template_invoice_id === null ? null : MOCKUP.invoices.find((x) => x.id === m.template_invoice_id)!.number
    check('template', r.template_number, tpl)
    const expected = MOCKUP.invoices.filter((x) => x.recurrence_id === m.id).map((x) => x.number).sort()
    check('invoices', (r.invoices ?? []).map((x) => x.number).sort().join(', '), expected.join(', '))
    for (const x of r.invoices ?? []) if (!x.occurrence_period) problems.push(`${x.number} is in series "${m.label.en}" with no period`)
  }

  if (problems.length > 0) {
    throw new Error(`the seeded "blackcode" workspace does NOT reproduce the mockup:\n  ${problems.join('\n  ')}`)
  }
  return invoices.length
}

// ---------------------------------------------------------------------------
// 2. demo-tenant — one company, nothing else
// ---------------------------------------------------------------------------

async function seedDemoTenant(owner: { id: number; email: string }): Promise<number> {
  const wsId = await freshWorkspace('demo-tenant', 'Demo Tenant', owner.id)
  const demo = MOCKUP.companies.find((c) => c.workspace_id === 2)!
  await insertCompany(wsId, owner.id, { ...companyFromMockup(demo, 1), footer_fr: null, footer_en: null })
  await setCounters(wsId, { company: 1, invoice: 0 })
  return wsId
}

// ---------------------------------------------------------------------------
// 3. praxis-demo — decision D-B7's shape
// ---------------------------------------------------------------------------

async function seedPraxis(owner: { id: number; email: string }): Promise<number> {
  const wsId = await freshWorkspace('praxis-demo', 'Praxis Demo (D-B7)', owner.id)
  const format = 'PX-{SEQ4}'
  const companyId = await insertCompany(wsId, owner.id, {
    seq: 1,
    slug: 'praxis',
    name: 'Praxis Demo',
    legal_name: 'Praxis Demo SA',
    street: 'Avenue de la Gare',
    building: '3',
    postal_code: '1003',
    city: 'Lausanne',
    country: 'CH',
    email: 'facturation@praxis.example',
    logo_initials: 'PX',
    logo_color: '#1d4ed8',
    // ⚠ PLACEHOLDER IBAN (P2). No QR-IBAN, so QRR is impossible here.
    iban: 'CH5604835012345678009',
    qr_iban: null,
    vat_registered: true,
    uid: 'CHE-111.111.111',
    vat_number: 'CHE-111.111.111 TVA',
    default_currency: 'CHF',
    default_language: 'fr',
    default_ref_type: 'SCOR',
    default_vat_rate: '8.10',
    default_prices_include_vat: true,
    payment_terms_days: 15,
    rounding: 'total_0_05',
    number_format: format,
    next_seq: 3,
  })

  const client = (name: string, street: string, building: string) => ({
    name,
    street,
    building,
    postal_code: '1004',
    city: 'Lausanne',
    country: 'CH',
  })
  // The MIXED bill: an exempt line beside taxable ones at two rates, prices
  // INCLUDING VAT, rounding on the total only. The case that breaks a VAT block
  // written for one rate.
  await insertInvoice(wsId, owner, {
    seq: 1,
    companyId,
    seqNo: 1,
    number: renderNumber(format, 2026, 1),
    status: 'sent',
    issue_date: '2026-09-10',
    due_date: '2026-09-25',
    currency: 'CHF',
    language: 'fr',
    ref_type: 'SCOR',
    // What `referenceBodyFor` derives from `PX-0001`.
    ref_body: 'PX0001',
    client: client('Mme A. Perret', 'Chemin des Vignes', '5'),
    vat_rate: '8.10',
    prices_include_vat: true,
    message: 'Consultation du 10.09.2026',
    items: [
      // Exempt: a medical act by a practitioner not liable for VAT on it.
      { description: 'Consultation', qty: '1', unit: null, unit_price: '250.00', vat_rate: null },
      // Taxable, and its price already contains the VAT.
      { description: 'Produit de soin', qty: '2', unit: 'pcs', unit_price: '60.00', vat_rate: '8.10' },
      // A third rate, so the VAT block renders more than one line.
      { description: 'Documentation imprimée', qty: '1', unit: 'pcs', unit_price: '18.00', vat_rate: '2.60' },
    ],
  })
  // NON: no reference at all, the third arm of the combination matrix.
  await insertInvoice(wsId, owner, {
    seq: 2,
    companyId,
    seqNo: 2,
    number: renderNumber(format, 2026, 2),
    status: 'draft',
    issue_date: '2026-09-16',
    due_date: null,
    currency: 'CHF',
    language: 'fr',
    ref_type: 'NON',
    ref_body: null,
    client: client('M. B. Favre', 'Rue Centrale', '22'),
    vat_rate: '8.10',
    prices_include_vat: true,
    message: null,
    items: [{ description: 'Consultation de suivi', qty: '1', unit: null, unit_price: '180.00', vat_rate: null }],
  })
  await setCounters(wsId, { company: 1, invoice: 2 })
  return wsId
}

async function main() {
  // FIRST, before a connection is opened.
  assertLocalDatabase(process.env.DATABASE_URL)

  // The owner: the OLDEST account in this local database, by id. The seed does
  // not create a platform account — identity is shared by four apps, and a seed
  // inventing one would be a seed that can log in.
  //
  // `ORDER BY id` is not decoration. The first version took `LIMIT 1` with no
  // order, and on 2026-09-18 it handed the seeded workspace to a test account
  // an integration suite had created, so the developer's own login stopped
  // being a member of it — and `bk billing workspace use blackcode` failed
  // silently for them.
  const [owner] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`${users.deleted_at} IS NULL`)
    .orderBy(users.id)
    .limit(1)
  if (!owner) {
    throw new Error(
      'no user in platform.users. Sign up at http://localhost:3300 first, then re-run: ' +
        'this seed attaches to an existing account rather than inventing one, because ' +
        'identity is shared by every app on this platform.'
    )
  }

  const mock = await seedMockup(owner)
  const checked = await assertParity(mock.workspaceId)
  await seedDemoTenant(owner)
  await seedPraxis(owner)

  console.log(`✓ seeded for ${owner.email} (mockup ${MOCKUP.source.commit?.slice(0, 7)}, file sha256 ${MOCKUP.source.sha256.slice(0, 12)})`)
  console.log(`  blackcode     2 companies, ${mock.invoices} invoices, ${mock.series} recurring series, ${mock.history} imported bills — ${checked} invoices and every series read back and equal to the mockup`)
  console.log('  demo-tenant   1 company, nothing else')
  console.log('  praxis-demo   1 company (prices include VAT, total rounding), 2 invoices')
  console.log('  0 audit entries anywhere: the log records what somebody did, and nobody has yet')
  console.log('  next: npm run dev --workspace=billing, then bk billing workspace use blackcode && bk billing overview')
  process.exit(0)
}

main().catch((e) => {
  // The whole cause chain, not the top message. Drizzle wraps the driver's
  // error as "Failed query: …", so printing only `e.message` names the
  // statement and hides the database's REASON — which is the one line that
  // says which guard refused it.
  for (let x: unknown = e, depth = 0; x && depth < 5; x = (x as { cause?: unknown }).cause, depth++) {
    console.error(depth === 0 ? '' : '  caused by: ', x instanceof Error ? x.message : String(x))
  }
  process.exit(1)
})
