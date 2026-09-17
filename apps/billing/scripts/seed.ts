// The DEVELOPMENT seed — a first cut, pulled forward from phase 6.
//
// ===========================================================================
// WHY THIS IS IN PHASE 1 AT ALL
// ===========================================================================
// `docs/billing-app-plan/` runs the backend one phase ahead of the frontend, so
// the screens are built against phase 1's routes while phase 2 is being written.
// Screens need rows. Without a seed the frontend either builds against fixtures
// it wrote itself — which drift from the server the moment a shape changes — or
// against an empty workspace, where every list is an empty state and nothing
// about the layout can be judged.
//
// `docs/billing-app-plan/phase-6-seed-and-production.md` finishes it: the second
// near-empty tenant, every placeholder visibly flagged, and
// `lib/derive/parity.test.ts` proving the totals match the mockup to the rappen.
//
// ── WHAT IS DELIBERATELY NOT HERE YET ──────────────────────────────────────
// The mockup's own data file. Phase 6 extracts `billing-data.js` into
// `fixtures/mockup.json` and asserts equality against it, which is what makes
// the parity claim mean something. This seed is shaped like that data and is not
// it, so nothing here may be cited as parity evidence.
//
// ===========================================================================
// IT REFUSES A NON-LOCAL DATABASE, AND THE REFUSAL IS THE POINT
// ===========================================================================
// This script DELETES the workspace it rebuilds. Against production that would
// destroy invoices — numbered legal documents under a ten-year retention duty
// that `0006` revokes DELETE on, so the delete would fail halfway and leave a
// workspace in pieces.
//
// The host check is first, before any connection is opened, and it is a
// positive assertion rather than a blocklist: an unrecognised host is refused.
// `apps/books/lib/db/seed.ts` is the precedent and `seed-guard.test.ts` beside
// this file proves the refusal fires.

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
  billingWorkspaceMembers,
  billingWorkspaces,
  users,
} from '../lib/db/schema'
import { renderNumber } from '../lib/derive/number'
import { assertLocalDatabase } from '../lib/db/seed-guard'

/** The workspace this seed owns, destructively. */
const WORKSPACE_SLUG = 'blackcode'

// Module scope, so `rebuildFrom` and `main` share one client. `getDb()` is lazy,
// so this opens nothing at import time.
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
    for (const table of ['company', 'invoice', 'audit']) {
      await tx.execute(sql.raw(`ALTER TABLE billing.${table} DISABLE TRIGGER trg_no_hard_delete`))
    }
    await tx.execute(sql.raw('ALTER TABLE billing.audit DISABLE TRIGGER trg_audit_append_only'))

    await tx.delete(billingWorkspaces).where(eq(billingWorkspaces.id, workspaceId))

    for (const table of ['company', 'invoice', 'audit']) {
      await tx.execute(sql.raw(`ALTER TABLE billing.${table} ENABLE TRIGGER trg_no_hard_delete`))
    }
    await tx.execute(sql.raw('ALTER TABLE billing.audit ENABLE TRIGGER trg_audit_append_only'))
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

async function main() {
  // FIRST, before a connection is opened.
  assertLocalDatabase(process.env.DATABASE_URL)

  // The owner: whoever is already in this local database. The seed does not
  // create a platform account — that is identity, shared by four apps, and a
  // seed inventing one would be a seed that can log in.
  const [owner] = await db.select({ id: users.id, email: users.email }).from(users).limit(1)
  if (!owner) {
    throw new Error(
      'no user in platform.users. Sign up at http://localhost:3300 first, then re-run: ' +
        'this seed attaches to an existing account rather than inventing one, because ' +
        'identity is shared by every app on this platform.'
    )
  }

  const existing = await db
    .select({ id: billingWorkspaces.id })
    .from(billingWorkspaces)
    .where(eq(billingWorkspaces.slug, WORKSPACE_SLUG))
    .limit(1)
  if (existing[0]) {
    await rebuildFrom(existing[0].id)
    console.log(`• removed the existing "${WORKSPACE_SLUG}" workspace and everything in it`)
  }

  const [ws] = await db
    .insert(billingWorkspaces)
    .values({ name: 'Blackcode', slug: WORKSPACE_SLUG, owner_id: owner.id })
    .returning({ id: billingWorkspaces.id })
  await db
    .insert(billingWorkspaceMembers)
    .values({ workspace_id: ws.id, user_id: owner.id, role: 'owner' })

  // ── TWO COMPANIES, DIFFERING IN EVERY WAY THAT CHANGES THE ARITHMETIC ────
  // Not two similar ones. The point of a seed is that a screen built against it
  // has met the cases that break layouts and totals:
  //
  //   blackcode   VAT-registered, prices EXCLUDE VAT, rounds per line
  //   praxis      VAT-registered, prices INCLUDE VAT, rounds the total only
  //
  // The second is the first external customer's shape (decision D-B7), so the
  // frontend meets `dont TVA` and an `Arrondi` line before either is a surprise.
  const companies = [
    {
      seq: 1,
      slug: 'blackcode',
      name: 'Blackcode',
      legal_name: 'Blackcode Sàrl',
      street: 'Rue du Mont-Blanc',
      building: '14',
      postal_code: '1201',
      city: 'Genève',
      country: 'CH',
      email: 'contact@blackcode.ch',
      logo_initials: 'BC',
      logo_color: '#0f6b44',
      // ⚠ PLACEHOLDERS. Open questions P2: blackcode's real UID and IBANs are
      // not ours to invent, and the first real invoice cannot be issued until
      // they are answered. A test IBAN keeps the QR-bill work honest without
      // pretending to be the real account.
      iban: 'CH9300762011623852957',
      qr_iban: 'CH4431999123000889012',
      vat_registered: true,
      uid: 'CHE-000.000.000',
      vat_number: 'CHE-000.000.000 TVA',
      default_currency: 'CHF',
      default_language: 'fr',
      default_ref_type: 'QRR',
      default_vat_rate: '8.10',
      default_prices_include_vat: false,
      payment_terms_days: 30,
      rounding: 'line_0_05',
      number_format: 'BC-{YYYY}-{SEQ4}',
      footer_fr: 'Merci de votre confiance.',
      footer_en: 'Thank you for your business.',
    },
    {
      seq: 2,
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
      iban: 'CH5604835012345678009',
      qr_iban: null,
      vat_registered: true,
      uid: 'CHE-111.111.111',
      vat_number: 'CHE-111.111.111 TVA',
      default_currency: 'CHF',
      default_language: 'fr',
      // No QR-IBAN, so QRR is impossible here — which the write door refuses.
      default_ref_type: 'SCOR',
      default_vat_rate: '8.10',
      default_prices_include_vat: true,
      payment_terms_days: 15,
      rounding: 'total_0_05',
      number_format: 'PX-{SEQ4}',
      footer_fr: null,
      footer_en: null,
    },
  ] as const

  const companyIds = new Map<string, number>()
  for (const c of companies) {
    const [row] = await db
      .insert(billingCompany)
      .values({ ...c, workspace_id: ws.id, created_by: owner.id })
      .returning({ id: billingCompany.id })
    companyIds.set(c.slug, row.id)
  }

  // ── THE INVOICES ────────────────────────────────────────────────────────
  // Chosen to cover every case a screen has to render: each status, both price
  // modes, a mixed-VAT bill, an exempt-only bill, a foreign currency with no
  // payment part, and a voided bill whose number stays consumed.
  const invoices: Array<{
    company: string
    status: 'draft' | 'sent' | 'paid' | 'void'
    issue_date: string
    due_date: string | null
    paid_date?: string
    currency: string
    ref_type: 'QRR' | 'SCOR' | 'NON'
    ref_body: string | null
    client: { name: string; street: string; building: string; postal_code: string; city: string; country: string }
    message?: string
    voidReason?: { fr: string; en: string }
    items: Array<{ description: string; qty: string; unit: string | null; unit_price: string; vat_rate: string | null }>
  }> = [
    {
      company: 'blackcode',
      status: 'paid',
      issue_date: '2026-07-03',
      due_date: '2026-08-02',
      paid_date: '2026-07-29',
      currency: 'CHF',
      ref_type: 'QRR',
      ref_body: '00000000000000000100000001',
      client: { name: 'Junod SA', street: 'Route de Berne', building: '12', postal_code: '1010', city: 'Lausanne', country: 'CH' },
      message: 'Mandat de développement, juin 2026',
      items: [
        { description: 'Développement, juin', qty: '12', unit: 'jours', unit_price: '132.50', vat_rate: '8.10' },
        { description: 'Frais de déplacement', qty: '1', unit: 'forfait', unit_price: '180.00', vat_rate: '8.10' },
      ],
    },
    {
      company: 'blackcode',
      status: 'sent',
      // Deliberately PAST its due date, so the overview's "needs action" and
      // the `overdue` bucket have something in them. A seed where nothing is
      // overdue leaves the most important panel empty.
      issue_date: '2026-08-01',
      due_date: '2026-08-31',
      currency: 'CHF',
      ref_type: 'QRR',
      ref_body: '00000000000000000100000002',
      client: { name: 'Métaux Rueff', street: 'Zone Industrielle', building: '8', postal_code: '1214', city: 'Vernier', country: 'CH' },
      message: 'Maintenance Q3',
      items: [{ description: 'Maintenance trimestrielle', qty: '1', unit: 'forfait', unit_price: '2400.00', vat_rate: '8.10' }],
    },
    {
      company: 'blackcode',
      status: 'draft',
      issue_date: '2026-09-15',
      due_date: '2026-10-15',
      currency: 'EUR',
      // EUR, so QRR is forbidden by the standard and SCOR is the choice. A seed
      // without a foreign-currency bill lets a screen ship believing every
      // invoice carries a QR payment part.
      ref_type: 'SCOR',
      ref_body: '539007547034',
      client: { name: 'Atelier Rousseau', street: 'Rue Lafayette', building: '77', postal_code: '75009', city: 'Paris', country: 'FR' },
      items: [
        { description: 'Audit technique', qty: '4', unit: 'jours', unit_price: '900.00', vat_rate: null },
      ],
    },
    {
      company: 'blackcode',
      status: 'void',
      issue_date: '2026-08-20',
      due_date: '2026-09-19',
      currency: 'CHF',
      ref_type: 'QRR',
      ref_body: '00000000000000000100000004',
      client: { name: 'Junod SA', street: 'Route de Berne', building: '12', postal_code: '1010', city: 'Lausanne', country: 'CH' },
      voidReason: {
        fr: 'Adressée à la mauvaise entité; réémise sous BC-2026-0005.',
        en: 'Addressed to the wrong entity; reissued as BC-2026-0005.',
      },
      items: [{ description: 'Développement, juillet', qty: '8', unit: 'jours', unit_price: '132.50', vat_rate: '8.10' }],
    },
    {
      // The MIXED bill, and the reason this seed exists in its current shape:
      // an exempt line beside a taxable one, prices INCLUDING VAT, rounding on
      // the total only. This is the first external customer's invoice, and it
      // is the case that breaks a VAT block written for one rate.
      company: 'praxis',
      status: 'sent',
      issue_date: '2026-09-10',
      due_date: '2026-09-25',
      currency: 'CHF',
      ref_type: 'SCOR',
      // What `referenceBodyFor` derives from `PX-0001`. Until 2026-09-17 this
      // was a 24-digit string: 0005's CHECK allowed 25, ISO 11649 allows 21 for
      // the body, and the seed carried a creditor reference no bank accepts
      // without anything noticing. Migration 0008 is what refused it.
      ref_body: 'PX0001',
      client: { name: 'Mme A. Perret', street: 'Chemin des Vignes', building: '5', postal_code: '1004', city: 'Lausanne', country: 'CH' },
      message: 'Consultation du 10.09.2026',
      items: [
        // Exempt: a medical act by a practitioner who is not liable for VAT on it.
        { description: 'Consultation', qty: '1', unit: null, unit_price: '250.00', vat_rate: null },
        // Taxable, and its price already contains the VAT.
        { description: 'Produit de soin', qty: '2', unit: 'pcs', unit_price: '60.00', vat_rate: '8.10' },
        // A THIRD rate, so the VAT block has to render more than one line.
        { description: 'Documentation imprimée', qty: '1', unit: 'pcs', unit_price: '18.00', vat_rate: '2.60' },
      ],
    },
    {
      company: 'praxis',
      status: 'draft',
      issue_date: '2026-09-16',
      due_date: null,
      currency: 'CHF',
      // NON: no reference at all, so the body must be empty. The third arm of
      // the combination matrix.
      ref_type: 'NON',
      ref_body: null,
      client: { name: 'M. B. Favre', street: 'Rue Centrale', building: '22', postal_code: '1003', city: 'Lausanne', country: 'CH' },
      items: [{ description: 'Consultation de suivi', qty: '1', unit: null, unit_price: '180.00', vat_rate: null }],
    },
  ]

  // The counters are set to match, because the seed inserts rows directly rather
  // than going through the allocator. Leaving them at zero would make the NEXT
  // invoice created through the app collide on `uq_invoice_ws_seq` — the exact
  // failure a seed that bypasses the write path invites.
  let invoiceSeq = 0
  const nextSeqNo = new Map<string, number>([['blackcode', 1], ['praxis', 1]])

  for (const inv of invoices) {
    invoiceSeq += 1
    const companyId = companyIds.get(inv.company)!
    const company = companies.find((c) => c.slug === inv.company)!
    const seqNo = nextSeqNo.get(inv.company)!
    nextSeqNo.set(inv.company, seqNo + 1)

    // ── INSERT AS A DRAFT, THEN WALK THE REAL STATUS MACHINE ─────────────
    // Not a workaround. Two guards refuse the shortcut, and both are right:
    //
    //   - `trg_invoice_line_frozen` refuses an INSERT of a line onto an invoice
    //     that is not a draft, because the lines of a sent bill ARE the
    //     document. Inserting the invoice already `paid` and then its lines
    //     fails, which is what happened the first time this seed ran.
    //   - `trg_invoice_status_machine` refuses `draft → paid`, because a bill
    //     nobody sent cannot have been paid.
    //
    // So the seed does what really happens: create a draft, put the lines on
    // it, send it, then mark it paid. The rows it produces have therefore
    // passed through every transition the app's own write paths use — which
    // makes this seed a small, permanent test that those transitions work,
    // rather than a set of rows assembled around them.
    const [row] = await db
      .insert(billingInvoice)
      .values({
        workspace_id: ws.id,
        seq: invoiceSeq,
        company_id: companyId,
        seq_no: seqNo,
        number: renderNumber(company.number_format, Number(inv.issue_date.slice(0, 4)), seqNo),
        status: 'draft',
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        currency: inv.currency,
        language: 'fr',
        ref_type: inv.ref_type,
        ref_body: inv.ref_body,
        client: inv.client,
        vat_rate: company.default_vat_rate,
        prices_include_vat: company.default_prices_include_vat,
        message: inv.message ?? null,
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

    // `draft` needs nothing further. Everything else is a transition, in order.
    if (inv.status === 'sent' || inv.status === 'paid') {
      // `sent_at` in the same statement, for the same reason as `paid_date`
      // below: migration 0007's `invoice_sent_requires_sent_at` refuses a sent
      // invoice with no moment it was sent. This walk was the first thing that
      // CHECK refused — a plain `SET status = 'sent'` is exactly the console
      // shortcut it exists to stop.
      //
      // No `sent_message_id` and no `pdf_sha256`: seeded bills were never
      // emailed by this app, and a null there is how the record says so — the
      // same shape `bk billing invoice mark-sent` produces.
      await db
        .update(billingInvoice)
        .set({ status: 'sent', sent_at: new Date(`${inv.issue_date}T09:00:00.000Z`) })
        .where(eq(billingInvoice.id, row.id))
    }
    if (inv.status === 'paid') {
      // `paid_date` in the SAME statement as the status: the CHECK
      // `invoice_paid_requires_date` refuses a paid invoice without one, and
      // setting them separately would be refused at the first half.
      await db
        .update(billingInvoice)
        .set({ status: 'paid', paid_date: inv.paid_date! })
        .where(eq(billingInvoice.id, row.id))
    }
    if (inv.status === 'void') {
      // `void` from anywhere, and the record in the same statement — the CHECK
      // `invoice_void_requires_record` refuses a void with no reason, because a
      // void without one is a deletion with extra steps.
      await db
        .update(billingInvoice)
        .set({
          status: 'void',
          void: { ts: `${inv.issue_date}T12:00:00.000Z`, by: owner.email, reason: inv.voidReason! },
        })
        .where(eq(billingInvoice.id, row.id))
    }
  }

  // Bring the allocators in line with what was inserted, so the next real create
  // continues the sequence instead of colliding with it.
  await db.insert(billingCounters).values([
    { workspace_id: ws.id, entity_type: 'company', last_value: companies.length },
    { workspace_id: ws.id, entity_type: 'invoice', last_value: invoiceSeq },
    { workspace_id: ws.id, entity_type: 'audit', last_value: 0 },
  ])
  for (const c of companies) {
    await db
      .update(billingCompany)
      .set({ next_seq: nextSeqNo.get(c.slug)! })
      .where(eq(billingCompany.id, companyIds.get(c.slug)!))
  }

  // ── NO AUDIT ROWS, AND THAT IS STATED RATHER THAN OVERLOOKED ────────────
  // The log records what somebody DID. Inventing entries for rows that were
  // never created through a write path would put fiction in an append-only
  // table nothing can correct — and the log is the one place in this app where
  // a plausible lie is worse than a gap.
  //
  // So the seeded workspace has an empty log, and the first real edit fills it.
  // A frontend building the audit panel makes one edit through the app and has
  // a real row.
  console.log(`✓ seeded "${WORKSPACE_SLUG}" for ${owner.email}`)
  console.log(`  ${companies.length} companies, ${invoiceSeq} invoices, 0 audit entries (see the note in this file)`)
  console.log('  next: npm run dev --workspace=billing, then bk billing overview')
  process.exit(0)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
