// DATA-MODEL §11's thirteen invariants, as thirteen named groups, in the spec's
// own numbering (b-mockups/bbilling/dev-handoff/DATA-MODEL.md §11).
//
// ===========================================================================
// AN INDEX, SO THE INVARIANTS STAY AUDITED
// ===========================================================================
// Most of these are also proved at length elsewhere — the allocator race in
// `write-paths.integration.test.ts`, the check digits in `reference.test.ts`,
// the archive in `history.integration.test.ts`. This file is the one place a
// reader can see all thirteen and find that each is ASSERTED, not remembered.
// The first case below fails if a number goes missing, so a phase that adds an
// invariant adds a group here or turns this file red.
//
// Two halves: what can be checked without a database runs on every `npm test`;
// the rest runs as `billing_app` (TEST_DATABASE_URL) and skips LOUDLY without
// one, naming itself.
//
// ── TWO INVARIANTS ARE NOT WHOLE YET, AND THEIR TESTS SAY SO ───────────────
//   I9   recurrence — phase 4 is not built. The case asserts the table is ABSENT,
//        so it fails the day phase 4 adds it and has to be replaced by the
//        real check rather than forgotten.
//   I12  the document half is frozen at send (G2), but the ISSUER is not: the
//        invoice carries no copy of its company's legal name, address or IBAN,
//        so editing the company changes what a sent bill settles on. The KNOWN
//        GAP case asserts that behaviour, and fails the day #86 snapshots the
//        issuer — which is when it must be flipped into the invariant.
//
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { integrationDescribe } from '@blackcode/platform-testing'
import * as schema from '@/lib/db/schema'
import { computeTotals, hasVatBlock } from '@/lib/derive/totals'
import { refQRR, refSCOR, isValidQRR, isValidSCOR } from '@/lib/qr/reference'
import { validateQrBill, ADDITIONAL_INFORMATION_BUDGET } from '@/lib/qr/validate'
import { qrBillFieldsFor } from '@/lib/qr/payload'
import { renderInvoiceDocument } from '@/lib/pdf/invoice'
import { sampleCompany, sampleInvoice } from '@/lib/pdf/fixtures'
import { PAYMENT_MESSAGE_MAX } from '@/lib/limits'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

/** Every column name on a billing table, from the Drizzle mirror (itself checked by schema-parity.test.ts). */
function columnsOf(table: string): string[] {
  for (const v of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>
    try {
      cfg = getTableConfig(v as never)
    } catch {
      continue
    }
    if (cfg.schema === 'billing' && cfg.name === table) return cfg.columns.map((c) => c.name)
  }
  return []
}

const billingTables = (): string[] =>
  Object.values(schema).flatMap((v) => {
    try {
      const cfg = getTableConfig(v as never)
      return cfg.schema === 'billing' ? [cfg.name] : []
    } catch {
      return []
    }
  })

describe('the index', () => {
  it('names all thirteen invariants, and no fourteenth', () => {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const found = [...src.matchAll(/describe\(\s*'(I\d+) — /g)].map((m) => Number(m[1].slice(1)))
    // A set, sorted numerically: I4 has a group in each half, and the database
    // half comes after the rest.
    expect([...new Set(found)].sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })
})

// ===========================================================================
// Without a database
// ===========================================================================

describe('I3 — VAT null is not VAT zero', () => {
  it('an unset rate carries no VAT block; a zero rate carries one reading 0%', () => {
    const none = [{ qty: '1', unit_price: '100.00', vat_rate: null }]
    const zero = [{ qty: '1', unit_price: '100.00', vat_rate: '0' }]
    expect(hasVatBlock(none)).toBe(false)
    expect(hasVatBlock(zero)).toBe(true)
    expect(computeTotals(none, false, 'line_0_05').vat).toEqual([])
    expect(computeTotals(zero, false, 'line_0_05').vat).toEqual([{ rate: '0', base: '100.00', amount: '0.00' }])
  })
})

describe('I4 — the combination matrix', () => {
  it('refuses EUR on a QR reference, and a QR reference on an ordinary IBAN', () => {
    const inv = sampleInvoice()
    const eurQrr = validateQrBill({ ...qrBillFieldsFor(inv, sampleCompany), currency: 'EUR' })
    expect(eurQrr.map((r) => r.code)).toContain('qrr_chf_only')
    const qrrOnIban = validateQrBill({ ...qrBillFieldsFor(inv, sampleCompany), account: sampleCompany.iban! })
    expect(qrrOnIban.length).toBeGreaterThan(0)
  })

  it('accepts the three shapes it allows', () => {
    expect(validateQrBill(qrBillFieldsFor(sampleInvoice(), sampleCompany))).toEqual([])
    const scor = sampleInvoice({ currency: 'EUR', ref_type: 'SCOR', ref_body: '539007547034' })
    expect(validateQrBill(qrBillFieldsFor(scor, sampleCompany))).toEqual([])
    const non = sampleInvoice({ ref_type: 'NON', ref_body: null })
    expect(validateQrBill(qrBillFieldsFor(non, sampleCompany))).toEqual([])
  })
})

describe('I5 — check digits are derived, never stored', () => {
  it('reproduces the standard’s vectors', () => {
    expect(refQRR('21000000000313947143000901')).toBe('210000000003139471430009017')
    expect(refSCOR('539007547034')).toBe('RF18539007547034')
    expect(isValidQRR('210000000003139471430009017')).toBe(true)
    expect(isValidSCOR('RF18539007547034')).toBe(true)
  })

  it('stores the BODY only: no reference or check-digit column on an invoice', () => {
    const cols = columnsOf('invoice')
    expect(cols).toContain('ref_body')
    expect(cols.filter((c) => /reference|check|^ref$/.test(c))).toEqual([])
  })
})

describe('I6 — totals are derived, never stored', () => {
  it('no subtotal, VAT or total column on an invoice or a line', () => {
    const money = /total|subtotal|^vat$|vat_amount|amount/
    expect(columnsOf('invoice').filter((c) => money.test(c))).toEqual([])
    expect(columnsOf('invoice_line').filter((c) => money.test(c))).toEqual([])
  })

  it('the ONE stored amount is the archive’s, which has no lines to derive it from', () => {
    const stored = billingTables().filter((t) => columnsOf(t).includes('total'))
    expect(stored).toEqual(['history'])
  })
})

describe('I9 — recurrence is finite (NOT BUILT: phase 4)', () => {
  it('has no recurrence table yet — this case fails the day phase 4 adds one, and must become the real check', () => {
    expect(billingTables()).not.toContain('recurrence')
  })
})

describe('I10 — the document’s language is not the operator’s', () => {
  it('prints the invoice’s own Annex C literals, and the renderer takes no UI locale at all', async () => {
    const de = await renderInvoiceDocument({ invoice: sampleInvoice({ language: 'de' }), company: sampleCompany })
    const words = de.log.flat().filter((e) => e.kind === 'text').map((e) => e.text)
    expect(words).toContain('Zahlteil')
    expect(words).toContain('Empfangsschein')
    expect(words).not.toContain('Section paiement')
    expect(words).not.toContain('Payment part')
    // The signature is the guarantee: one argument, holding the invoice and the company.
    expect(renderInvoiceDocument.length).toBe(1)
  })
})

describe('I11 — the 140-character budget', () => {
  it('is one number, read by the write door and the QR-bill check alike', () => {
    expect(ADDITIONAL_INFORMATION_BUDGET).toBe(PAYMENT_MESSAGE_MAX)
    expect(PAYMENT_MESSAGE_MAX).toBe(140)
  })

  it('refuses a message one character over it', () => {
    const inv = sampleInvoice({ message: 'x'.repeat(PAYMENT_MESSAGE_MAX + 1) })
    expect(validateQrBill(qrBillFieldsFor(inv, sampleCompany)).length).toBeGreaterThan(0)
    const ok = sampleInvoice({ message: 'x'.repeat(PAYMENT_MESSAGE_MAX) })
    expect(validateQrBill(qrBillFieldsFor(ok, sampleCompany))).toEqual([])
  })
})

// ===========================================================================
// Against the database, as billing_app
// ===========================================================================

const run = integrationDescribe({
  describe,
  name: 'billing invariants I1, I2, I4, I7, I8, I12, I13 against the database',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing invariants (integration)', () => {
  type Ctx = { workspaceId: number; actorUserId: number; via: 'token'; actorEmail: string; isOwner: boolean }
  let ctx: Ctx
  let q: {
    invoices: typeof import('@/lib/db/queries/invoices')
    lifecycle: typeof import('@/lib/db/queries/lifecycle')
    companies: typeof import('@/lib/db/queries/companies')
    overview: typeof import('@/lib/db/queries/overview')
    history: typeof import('@/lib/db/queries/history')
  }
  let exec: (s: import('drizzle-orm').SQL) => Promise<{ rows: Record<string, unknown>[] }>
  let sql: typeof import('drizzle-orm')['sql']

  /** The SQLSTATE a statement fails with, or null if it succeeded. */
  const sqlstate = async (s: import('drizzle-orm').SQL): Promise<string | null> => {
    try {
      await exec(s)
      return null
    } catch (e) {
      for (let x = e as { code?: unknown; cause?: unknown } | undefined; x; x = x.cause as typeof x) {
        if (typeof x.code === 'string' && /^[0-9A-Z]{5}$/.test(x.code)) return x.code
      }
      return 'unknown'
    }
  }

  const draft = (extra: Record<string, unknown> = {}) =>
    q.invoices.createInvoice(ctx, {
      company: 'inv',
      ref_type: 'SCOR',
      client: { name: 'Client SA', street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      items: [{ description: 'Work', qty: '1', unit_price: '100.00', vat_rate: '8.10' }],
      ...extra,
    } as never)

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db/client')
    ;({ sql } = await import('drizzle-orm'))
    exec = (s) => getDb().execute(s) as never
    q = {
      invoices: await import('@/lib/db/queries/invoices'),
      lifecycle: await import('@/lib/db/queries/lifecycle'),
      companies: await import('@/lib/db/queries/companies'),
      overview: await import('@/lib/db/queries/overview'),
      history: await import('@/lib/db/queries/history'),
    }
    const workspaces = await import('@/lib/db/queries/workspaces')
    const u = await exec(sql`SELECT id, email FROM platform.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)
    const user = u.rows[0] as { id: number; email: string } | undefined
    if (!user) throw new Error('no user in platform.users — sign up locally first')
    const ws = await workspaces.createWorkspaceForUser(user.id, `itest-invariants-${Date.now()}`)
    ctx = { workspaceId: ws.id, actorUserId: user.id, via: 'token', actorEmail: user.email, isOwner: true }
    await q.companies.createCompany(ctx, {
      slug: 'inv',
      name: 'Invariant SA',
      legal_name: 'Invariant SA',
      address: { street: 'Rue du Test', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      iban: 'CH9300762011623852957',
      qr_iban: 'CH4431999123000889012',
      vat_registered: true,
      number_format: 'INV-{SEQ4}',
    })
  })

  describe('I1 — the sequence is gapless and never renumbered', () => {
    it('five concurrent creates take five contiguous numbers', async () => {
      const made = await Promise.all(Array.from({ length: 5 }, () => draft()))
      const nos = made.map((m) => m.seq_no).sort((a, b) => a - b)
      expect(nos).toEqual(Array.from({ length: 5 }, (_, i) => nos[0] + i))
    }, 30_000)

    it('a void keeps its number consumed, and a number cannot be rewritten', async () => {
      const a = await draft()
      await q.lifecycle.voidInvoice(ctx, String(a.seq), { reason_en: 'invariant I1' })
      const b = await draft()
      expect(b.seq_no).toBe(a.seq_no + 1)
      expect(await sqlstate(sql`UPDATE billing.invoice SET seq_no = seq_no + 100 WHERE workspace_id = ${ctx.workspaceId} AND seq = ${b.seq}`)).not.toBeNull()
    })
  })

  describe('I2 — a void is not a delete', () => {
    it('refuses a void with no reason, keeps the voided record, and cannot delete', async () => {
      const a = await draft()
      await expect(q.lifecycle.voidInvoice(ctx, String(a.seq), {})).rejects.toThrow()
      const v = await q.lifecycle.voidInvoice(ctx, String(a.seq), { reason_en: 'invariant I2', reason_fr: 'invariant I2' })
      expect(v.status).toBe('void')
      expect(v.void?.reason.en).toBe('invariant I2')
      expect((await q.invoices.getInvoice(ctx.workspaceId, String(a.seq)))?.number).toBe(a.number)
      expect(await sqlstate(sql`DELETE FROM billing.invoice WHERE workspace_id = ${ctx.workspaceId} AND seq = ${a.seq}`)).toBe('42501')
    })
  })

  describe('I4 — the combination matrix, at the write door', () => {
    it('refuses an EUR invoice on a QR reference', async () => {
      await expect(draft({ currency: 'EUR', ref_type: 'QRR' })).rejects.toThrow()
    })
  })

  describe('I7 — the audit log is append-only and every write appends', () => {
    it('an edit appends one row per field, and the app role cannot rewrite one', async () => {
      const a = await draft()
      const before = await exec(sql`SELECT COUNT(*)::int AS n FROM billing.audit WHERE workspace_id = ${ctx.workspaceId}`)
      await q.invoices.editInvoice(ctx, String(a.seq), { message: 'changed', due_date: '2030-01-31' })
      const after = await exec(sql`SELECT COUNT(*)::int AS n FROM billing.audit WHERE workspace_id = ${ctx.workspaceId}`)
      expect(Number(after.rows[0].n) - Number(before.rows[0].n)).toBe(2)
      expect(await sqlstate(sql`UPDATE billing.audit SET detail_en = 'x' WHERE workspace_id = ${ctx.workspaceId}`)).toBe('42501')
    })
  })

  describe('I8 — per-currency sums are never merged', () => {
    it('reports CHF and EUR as two lines and no grand total', async () => {
      await draft({ currency: 'EUR' })
      const ov = await q.overview.getOverview(ctx.workspaceId)
      const currencies = ov.by_currency.map((b) => b.currency)
      expect(new Set(currencies).size).toBe(currencies.length)
      expect(Object.keys(ov)).not.toContain('total')
      for (const b of ov.by_currency) expect(Object.keys(b)).toContain('currency')
    })
  })

  describe('I12 — frozen at issue', () => {
    it('once sent, the document half refuses an edit and the payment message does not', async () => {
      const a = await draft()
      await q.lifecycle.markInvoiceSent(ctx, String(a.seq))
      await expect(q.invoices.editInvoice(ctx, String(a.seq), { client: { name: 'Someone Else' } })).rejects.toThrow()
      const ok = await q.invoices.editInvoice(ctx, String(a.seq), { message: 'still open' })
      expect(ok.message).toBe('still open')
    })

    it('KNOWN GAP (#86): the issuer is not frozen — a company IBAN edit changes what a SENT bill settles on', async () => {
      // This asserts the GAP, deliberately. The day #86 snapshots the issuer at
      // send, it fails: flip it into the invariant then, don't delete it.
      const { invoiceAccount } = await import('@/lib/qr/reference')
      const a = await draft()
      await q.lifecycle.markInvoiceSent(ctx, String(a.seq))
      const sent = (await q.invoices.getInvoice(ctx.workspaceId, String(a.seq)))!
      const before = invoiceAccount(sent.ref_type, (await q.companies.getCompany(ctx.workspaceId, 'inv'))!)
      await q.companies.editCompany(ctx, 'inv', { iban: 'CH5604835012345678009' })
      const after = invoiceAccount(sent.ref_type, (await q.companies.getCompany(ctx.workspaceId, 'inv'))!)
      expect(columnsOf('invoice').filter((c) => /iban|issuer|creditor/.test(c))).toEqual([])
      expect(after).not.toBe(before)
      await q.companies.editCompany(ctx, 'inv', { iban: 'CH9300762011623852957' })
    })
  })

  describe('I13 — history is read-only and never enters the native sequence', () => {
    it('an archived number equal to a native one is accepted, changes no sequence, and cannot be rewritten', async () => {
      const native = await draft()
      const nextBefore = await exec(sql`SELECT next_seq FROM billing.company WHERE workspace_id = ${ctx.workspaceId} AND slug = 'inv'`)
      const res = await q.history.importHistory(ctx, {
        rows: [
          {
            source: 'zoho',
            source_ref: `I13-${Date.now()}`,
            company: 'inv',
            number: native.number,
            client_name: 'Archive SA',
            issue_date: '2020-01-02',
            currency: 'CHF',
            total: '10.00',
            status: 'paid',
          },
        ],
      })
      expect(res.imported).toBe(1)
      const nextAfter = await exec(sql`SELECT next_seq FROM billing.company WHERE workspace_id = ${ctx.workspaceId} AND slug = 'inv'`)
      expect(nextAfter.rows[0].next_seq).toBe(nextBefore.rows[0].next_seq)
      expect(await sqlstate(sql`UPDATE billing.history SET number = 'x' WHERE workspace_id = ${ctx.workspaceId}`)).toBe('42501')
    })
  })
})
