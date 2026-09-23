// Send, against a real database as `billing_app`, with a transport that records
// what it was handed. The point: THE BYTES THAT WERE MAILED ARE THE BYTES THIS
// APP SERVES, FOREVER (position P10 + invariant I12), end to end through the
// database rather than renderer to renderer.
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/delivery/send.integration.test.ts
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored
// ===========================================================================
//   - `issuer,` removed from sendInvoice's UPDATE   → all three "delivered" cases red: 23514 from
//                                                     `invoice_issuer_iff_issued` — the DATABASE refuses, which
//                                                     is the point: a write path cannot forget the copy
//   - `issuerOfRow` made to ignore the stored copy (`issuerOf(null, live)`)
//                                                   → "…still is after the company is edited" red, and
//                                                     invariants.test.ts' I12 case with it
//   - the seam's `validatedFields(src)` removed     → "send refuses…" and "mark-sent refuses…" red
//   - mark-sent's `prepareDocument` call removed    → "mark-sent refuses the same record" red
//   - the write door's character check disabled     → "the write door refuses a payment message…" red

import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing send: the mailed bytes are the served bytes',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const IBAN = 'CH9300762011623852957'
const OTHER_IBAN = 'CH5604835012345678009'

run('billing send (integration)', () => {
  type Ctx = { workspaceId: number; actorUserId: number; via: 'token'; actorEmail: string; isOwner: boolean }
  let ctx: Ctx
  let q: {
    invoices: typeof import('@/lib/db/queries/invoices')
    lifecycle: typeof import('@/lib/db/queries/lifecycle')
    companies: typeof import('@/lib/db/queries/companies')
    audit: typeof import('@/lib/db/queries/audit')
  }
  let doc: typeof import('./document')

  /** A transport that accepts everything and keeps what it was given. */
  const transport = () => {
    const mailed: Array<{ to: string; pdf: Buffer }> = []
    return {
      mailed,
      deps: {
        prepareDocument: doc.prepareInvoiceDocument,
        emailEnabled: () => true,
        log: () => {},
        sendDocumentEmail: (async (to: string, _copy: unknown, opts: { attachments: Array<{ content: Buffer }> }) => {
          mailed.push({ to, pdf: opts.attachments[0].content })
          return { sent: true, messageId: `test-${mailed.length}` }
        }) as never,
      },
    }
  }

  const draft = (company: string, extra: Record<string, unknown> = {}) =>
    q.invoices.createInvoice(ctx, {
      company,
      ref_type: 'SCOR',
      client: { name: 'Client SA', street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      items: [{ description: 'Work', qty: '1', unit_price: '100.03', vat_rate: '8.10' }],
      message: 'Septembre 2026',
      ...extra,
    } as never)

  const served = async (seq: number) =>
    sha(await doc.prepareInvoiceDocument((await q.invoices.getInvoiceDocumentSource(ctx.workspaceId, String(seq)))!))

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db/client')
    const { sql } = await import('drizzle-orm')
    q = {
      invoices: await import('@/lib/db/queries/invoices'),
      lifecycle: await import('@/lib/db/queries/lifecycle'),
      companies: await import('@/lib/db/queries/companies'),
      audit: await import('@/lib/db/queries/audit'),
    }
    doc = await import('./document')
    const workspaces = await import('@/lib/db/queries/workspaces')
    const u = await getDb().execute<{ id: number; email: string }>(
      sql`SELECT id, email FROM platform.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`
    )
    if (!u.rows[0]) throw new Error('no user in platform.users — sign up locally first')
    const ws = await workspaces.createWorkspaceForUser(u.rows[0].id, `itest-send-${Date.now()}`)
    ctx = { workspaceId: ws.id, actorUserId: u.rows[0].id, via: 'token', actorEmail: u.rows[0].email, isOwner: true }
    await q.companies.createCompany(ctx, {
      slug: 'ok',
      name: 'Sender',
      legal_name: 'Sender SA',
      address: { street: 'Rue du Test', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      email: 'billing@sender.example',
      iban: IBAN,
      vat_registered: true,
      // Required since ticket #757: a registered company carries its number.
      vat_number: 'CHE-000.000.000 TVA',
      number_format: 'OK-{SEQ4}',
    })
    // A company the write door accepts and the QR-bill standard does not: no address.
    await q.companies.createCompany(ctx, {
      slug: 'bare',
      name: 'Bare',
      legal_name: 'Bare SA',
      email: 'billing@bare.example',
      iban: IBAN,
      vat_registered: true,
      vat_number: 'CHE-000.000.000 TVA',
      number_format: 'BA-{SEQ4}',
    })
  })

  describe('a delivered invoice', () => {
    let seq: number
    let mailedSha: string

    it('records the fingerprint of the bytes the transport was handed, and the issuer they were rendered from', async () => {
      const t = transport()
      const d = await draft('ok')
      const sent = await q.lifecycle.sendInvoice(ctx, String(d.seq), { to: 'client@example.ch' }, t.deps)
      seq = sent.seq
      expect(t.mailed).toHaveLength(1)
      expect(t.mailed[0].pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      mailedSha = sha(t.mailed[0].pdf)
      expect(sent.status).toBe('sent')
      expect(sent.pdf_sha256).toBe(mailedSha)
      expect(sent.sent_message_id).toBe('test-1')
      expect(sent.issuer?.legal_name).toBe('Sender SA')
      expect(sent.issuer?.iban).toBe(IBAN)
    })

    it('is served as the same bytes — and still is after the company is edited', async () => {
      expect(await served(seq)).toBe(mailedSha)
      await q.companies.editCompany(ctx, 'ok', { iban: OTHER_IBAN, legal_name: 'Renamed SA', rounding: 'none', footer_en: 'new footer' })
      try {
        // Positive half first: the edit took, and a fresh draft renders differently.
        const fresh = await draft('ok')
        expect((await q.invoices.getInvoice(ctx.workspaceId, String(fresh.seq)))!.derived.account).toBe(OTHER_IBAN)
        expect(await served(seq)).toBe(mailedSha)
      } finally {
        await q.companies.editCompany(ctx, 'ok', { iban: IBAN, legal_name: 'Sender SA', rounding: 'line_0_05', footer_en: null })
      }
    })

    it('differs once the payment message is edited — the hash is sensitive, and that difference is honest', async () => {
      await q.invoices.editInvoice(ctx, String(seq), { message: 'Septembre 2026, rappel' })
      expect(await served(seq)).not.toBe(mailedSha)
      await q.invoices.editInvoice(ctx, String(seq), { message: 'Septembre 2026' })
      expect(await served(seq)).toBe(mailedSha)
    })
  })

  describe('a record the QR-bill standard would refuse', () => {
    it('send refuses with 422, mails nothing, and leaves a draft with no new audit row', async () => {
      const t = transport()
      const d = await draft('bare')
      const auditBefore = (await q.audit.listAudit(ctx.workspaceId, { limit: 200 } as never)).data.length
      const e = await q.lifecycle.sendInvoice(ctx, String(d.seq), { to: 'client@example.ch' }, t.deps).catch((x) => x)
      expect(e).toBeInstanceOf(q.invoices.InvoiceRefused)
      expect([e.status, e.code]).toEqual([422, doc.PAYMENT_PART_INVALID])
      expect(e.message).toContain('creditor_address_incomplete')
      expect(t.mailed).toHaveLength(0)
      const after = (await q.invoices.getInvoice(ctx.workspaceId, String(d.seq)))!
      expect(after.status).toBe('draft')
      expect(after.issuer).toBeNull()
      expect(after.derived.problems.map((p) => p.code)).toContain('creditor_address_incomplete')
      expect((await q.audit.listAudit(ctx.workspaceId, { limit: 200 } as never)).data.length).toBe(auditBefore)
    })

    it('mark-sent refuses the same record: once sent its document is frozen, and it could never be served', async () => {
      const d = await draft('bare')
      const e = await q.lifecycle.markInvoiceSent(ctx, String(d.seq)).catch((x) => x)
      expect([e.status, e.code]).toEqual([422, doc.PAYMENT_PART_INVALID])
      expect((await q.invoices.getInvoice(ctx.workspaceId, String(d.seq)))!.status).toBe('draft')
    })

    it('the write door refuses a payment message a QR code cannot carry', async () => {
      const e = await draft('ok', { message: 'Facture — septembre' }).catch((x) => x)
      expect(e).toBeInstanceOf(q.invoices.InvoiceRefused)
      expect(e.code).toBe('message_character_not_allowed')
      expect(e.message).toContain('U+2014')
    })
  })
})
