// Two things a fixture cannot prove, against a real database as `billing_app`.
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/runtime.integration.test.ts
//
// ===========================================================================
// 1. A THIRD COMPANY, CREATED AT RUNTIME
// ===========================================================================
// Parity against the mockup proves the mockup's two companies. Nothing here may
// assume two — a new entity is a ROW, never a code change (DATA-MODEL §1) — so
// three are created by the write door, invoiced concurrently, and each is held
// to the same invariants: its own contiguous sequence from 1, references that
// validate, the right account for the reference type, and a list filter that
// answers for it alone.
//
// ===========================================================================
// 2. A TENANT THAT HAS NOTHING
// ===========================================================================
// While every workspace has data, a read that forgot its `workspace_id` looks
// exactly like one that remembered. So a full workspace and an empty one are
// built side by side — with the SAME company slug in both, because a leak
// through a slug lookup is the likeliest one — and every read the app serves is
// asked for the empty one. **`workspace_id` on a row scopes nothing; the read
// does.** Every leak found on the mockup side had correctly tagged rows and an
// unscoped read.
//
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md

import { beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'
import { isValidQRR, isValidSCOR, invoiceAccount, invoiceReference } from '@/lib/qr/reference'
import type { ReferenceType } from '@/types'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing at runtime: a third company, and an empty tenant',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

const QR_IBAN = 'CH4431999123000889012'
const IBAN = 'CH9300762011623852957'
const client = { name: 'Client SA', street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' }

run('billing at runtime (integration)', () => {
  type Ctx = { workspaceId: number; actorUserId: number; via: 'token'; actorEmail: string; isOwner: boolean }
  let q: {
    invoices: typeof import('@/lib/db/queries/invoices')
    companies: typeof import('@/lib/db/queries/companies')
    overview: typeof import('@/lib/db/queries/overview')
    history: typeof import('@/lib/db/queries/history')
    audit: typeof import('@/lib/db/queries/audit')
    workspaces: typeof import('@/lib/db/queries/workspaces')
  }
  let companyFilter: typeof import('@/lib/api/company-filter')['companyFilter']
  let userId: number
  let email: string

  const newWorkspace = async (tag: string): Promise<Ctx> => {
    const ws = await q.workspaces.createWorkspaceForUser(userId, `itest-${tag}-${Date.now()}`)
    return { workspaceId: ws.id, actorUserId: userId, via: 'token', actorEmail: email, isOwner: true }
  }

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db/client')
    const { sql } = await import('drizzle-orm')
    q = {
      invoices: await import('@/lib/db/queries/invoices'),
      companies: await import('@/lib/db/queries/companies'),
      overview: await import('@/lib/db/queries/overview'),
      history: await import('@/lib/db/queries/history'),
      audit: await import('@/lib/db/queries/audit'),
      workspaces: await import('@/lib/db/queries/workspaces'),
    }
    ;({ companyFilter } = await import('@/lib/api/company-filter'))
    const u = await getDb().execute<{ id: number; email: string }>(
      sql`SELECT id, email FROM platform.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`
    )
    if (!u.rows[0]) throw new Error('no user in platform.users — sign up locally first')
    ;({ id: userId, email } = u.rows[0])
  })

  describe('a third company, created at runtime', () => {
    it('three companies, invoiced concurrently, each hold every invariant on their own', async () => {
      const ctx = await newWorkspace('three')
      const specs = [
        { slug: 'first', qr_iban: QR_IBAN, ref_type: 'QRR', currency: 'CHF', format: 'F-{SEQ4}' },
        { slug: 'second', qr_iban: null, ref_type: 'SCOR', currency: 'EUR', format: 'S-{YYYY}-{SEQ4}' },
        { slug: 'third', qr_iban: QR_IBAN, ref_type: 'QRR', currency: 'CHF', format: 'T{SEQ4}' },
      ] as const
      for (const s of specs) {
        await q.companies.createCompany(ctx, {
          slug: s.slug,
          name: `${s.slug} SA`,
          legal_name: `${s.slug} SA`,
          address: { street: 'Rue du Test', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
          iban: IBAN,
          qr_iban: s.qr_iban,
          vat_registered: true,
          // Required since ticket #757: a registered company carries its number.
          vat_number: 'CHE-000.000.000 TVA',
          number_format: s.format,
        })
      }

      // Four each, all twelve at once, interleaved across companies.
      const made = await Promise.all(
        specs.flatMap((s) =>
          Array.from({ length: 4 }, () =>
            q.invoices.createInvoice(ctx, {
              company: s.slug,
              ref_type: s.ref_type,
              currency: s.currency,
              client,
              items: [{ description: 'Work', qty: '1', unit_price: '100.00', vat_rate: '8.10' }],
            } as never)
          )
        )
      )

      for (const s of specs) {
        const mine = made.filter((m) => m.company === s.slug)
        // Its OWN sequence, from 1, contiguous — whatever the other two did.
        expect(mine.map((m) => m.seq_no).sort((a, b) => a - b), s.slug).toEqual([1, 2, 3, 4])
        const company = (await q.companies.getCompany(ctx.workspaceId, s.slug))!
        for (const inv of mine) {
          const ref = invoiceReference(inv.ref_type as ReferenceType, inv.ref_body)!
          expect(s.ref_type === 'QRR' ? isValidQRR(ref) : isValidSCOR(ref), `${inv.number} ${ref}`).toBe(true)
          expect(invoiceAccount(inv.ref_type as ReferenceType, company)).toBe(s.ref_type === 'QRR' ? QR_IBAN : IBAN)
        }
        // Two companies with QRR must never share a reference: the body carries the company.
        const listed = await q.invoices.listInvoices(ctx.workspaceId, { company: s.slug, limit: 200 })
        expect(listed.data.map((i) => i.number).sort(), s.slug).toEqual(mine.map((m) => m.number).sort())
      }
      const qrr = made.filter((m) => m.ref_type === 'QRR').map((m) => m.ref_body)
      expect(new Set(qrr).size).toBe(qrr.length)
    }, 60_000)
  })

  describe('a tenant that has nothing', () => {
    let full: Ctx
    let empty: Ctx
    let fullInvoiceSeq: number
    let fullHistorySeq: number

    beforeAll(async () => {
      full = await newWorkspace('full')
      empty = await newWorkspace('empty')
      // The SAME slug in both, so a lookup that forgot the workspace finds the wrong one.
      for (const ctx of [full, empty]) {
        await q.companies.createCompany(ctx, {
          slug: 'acme',
          name: 'Acme SA',
          legal_name: 'Acme SA',
          iban: IBAN,
          number_format: 'A-{SEQ4}',
        })
      }
      await q.companies.createCompany(full, { slug: 'only-in-full', name: 'Full SA', number_format: 'O-{SEQ4}' })
      const inv = await q.invoices.createInvoice(full, {
        company: 'acme',
        ref_type: 'NON',
        client,
        items: [{ description: 'Work', qty: '1', unit_price: '100.00', vat_rate: null }],
      } as never)
      fullInvoiceSeq = inv.seq
      const h = await q.history.importHistory(full, {
        rows: [
          {
            source: 'zoho',
            source_ref: `T-${Date.now()}`,
            company: 'acme',
            number: '2020-1',
            client_name: 'Old SA',
            issue_date: '2020-01-02',
            currency: 'CHF',
            total: '1.00',
            status: 'paid',
          },
        ],
      })
      fullHistorySeq = h.rows[0].seq
    })

    it('the full tenant really has data (the positive half, first)', async () => {
      expect((await q.invoices.listInvoices(full.workspaceId)).data.length).toBeGreaterThan(0)
      expect((await q.history.listHistory(full.workspaceId)).data.length).toBeGreaterThan(0)
      expect((await q.audit.listAudit(full.workspaceId)).data.length).toBeGreaterThan(0)
      expect((await q.overview.getOverview(full.workspaceId)).by_currency.length).toBeGreaterThan(0)
    })

    it('every list is empty for the empty tenant', async () => {
      expect((await q.invoices.listInvoices(empty.workspaceId)).data).toEqual([])
      expect((await q.invoices.listInvoices(empty.workspaceId, { company: 'acme' })).data).toEqual([])
      expect((await q.history.listHistory(empty.workspaceId)).data).toEqual([])
      expect((await q.history.listHistory(empty.workspaceId, { company: 'acme' })).data).toEqual([])
      const ov = await q.overview.getOverview(empty.workspaceId)
      expect(ov.by_currency).toEqual([])
      expect(ov.recent_invoices).toEqual([])
      expect(ov.needs_action).toEqual([])
      // Its own company is the only one it can see — the other tenant's is not listed.
      const companies = await q.companies.listCompanies(empty.workspaceId)
      expect(companies.map((c) => c.slug)).toEqual(['acme'])
    })

    it('an address that exists in the OTHER tenant is not found here', async () => {
      expect(await q.invoices.getInvoice(empty.workspaceId, String(fullInvoiceSeq))).toBeNull()
      expect(await q.history.getHistory(empty.workspaceId, fullHistorySeq)).toBeNull()
      expect(await q.companies.getCompany(empty.workspaceId, 'only-in-full')).toBeNull()
    })

    it('a company filter naming the other tenant’s company is refused, not answered with nothing', async () => {
      await expect(companyFilter(empty.workspaceId, 'only-in-full')).rejects.toMatchObject({ status: 404, code: 'company_not_found' })
      await expect(companyFilter(empty.workspaceId, 'acme')).resolves.toBe('acme')
      await expect(companyFilter(empty.workspaceId, null)).resolves.toBeUndefined()
    })
  })
})
