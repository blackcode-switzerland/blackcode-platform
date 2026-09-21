// The pure half of the lifecycle: what a request may say, and when an invoice is
// ready to leave. The database half — the row lock, G2, the status machine — is
// exercised against Postgres as `billing_app` and recorded in
// apps/billing/docs/backend.md, because a mock of a lock proves nothing.
import { describe, expect, it } from 'vitest'
import {
  assertConfirmMatches,
  assertReadyToIssue,
  defaultEmailCopy,
  documentFilename,
  parsePaidInput,
  parseSendInput,
  parseVoidInput,
  todayInZurich,
  transportIdempotencyKey,
} from './lifecycle'
import { InvoiceRefused } from './invoices'
import type { Invoice } from '@/types'

function refusal(fn: () => unknown): InvoiceRefused {
  try {
    fn()
  } catch (e) {
    if (e instanceof InvoiceRefused) return e
    throw e
  }
  throw new Error('expected a refusal, and the call succeeded')
}

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    seq: 7,
    company: 'acme',
    number: 'BC-2026-0007',
    seq_no: 7,
    status: 'draft',
    issue_date: '2026-09-17',
    due_date: '2026-10-17',
    paid_date: null,
    currency: 'CHF',
    language: 'fr',
    ref_type: 'SCOR',
    ref_body: 'BC20260007',
    client: { name: 'Junod SA', street: null, building: null, postal_code: null, city: null, country: null },
    vat_rate: null,
    prices_include_vat: false,
    message: null,
    void: null,
    sent_at: null,
    sent_message_id: null,
    pdf_sha256: null,
    // Cents that are NOT zero, deliberately. The first fixture was 1590.00, and a
    // readiness check that parsed the total with the wrong scale passed on it —
    // trailing zeros are not extra precision — and threw on 540.50 over HTTP.
    items: [{ line_no: 1, description: 'Consulting', qty: '12', unit: 'days', unit_price: '132.55', vat_rate: null, line_total: '1590.60' }],
    totals: { subtotal: '1590.60', vat: [], vat_total: '0.00', rounding: '0.00', total: '1590.60' },
    external_ref: null,
    metadata: {},
    ...over,
  } as Invoice
}

// Only the columns `assertReadyToIssue` reads; the rest of the row is irrelevant to it.
function company(over: Record<string, unknown> = {}) {
  return {
    slug: 'acme',
    name: 'Acme SA',
    retired_at: null,
    iban: 'CH9300762011623852957',
    qr_iban: null,
    vat_registered: false,
    email: 'billing@acme.example',
    ...over,
  } as never
}

describe('parseSendInput', () => {
  it('accepts one recipient, trims, and defaults the optional parts to null', () => {
    expect(parseSendInput({ to: '  client@example.ch ' })).toEqual({ to: 'client@example.ch', cc: [], subject: null, body: null })
  })
  it('refuses a missing recipient, a list typed into `to`, and a bare name', () => {
    expect(refusal(() => parseSendInput({})).code).toBe('recipient_required')
    expect(refusal(() => parseSendInput({ to: 'a@b.ch, c@d.ch' })).code).toBe('invalid_recipient')
    expect(refusal(() => parseSendInput({ to: 'Junod SA' })).code).toBe('invalid_recipient')
  })
  it('refuses a malformed or oversized cc list', () => {
    expect(refusal(() => parseSendInput({ to: 'a@b.ch', cc: 'c@d.ch' })).code).toBe('invalid_cc')
    expect(refusal(() => parseSendInput({ to: 'a@b.ch', cc: ['nope'] })).code).toBe('invalid_cc')
    expect(refusal(() => parseSendInput({ to: 'a@b.ch', cc: ['1@x.ch', '2@x.ch', '3@x.ch', '4@x.ch', '5@x.ch', '6@x.ch'] })).code).toBe('too_many_cc')
  })
  it('refuses a subject that is a paragraph', () => {
    expect(refusal(() => parseSendInput({ to: 'a@b.ch', subject: 'x'.repeat(201) })).code).toBe('subject_too_long')
  })
})

describe('parsePaidInput', () => {
  const noon = new Date('2026-09-17T10:00:00Z')
  it('accepts today and the past', () => {
    expect(parsePaidInput({ paid_date: '2026-09-17' }, noon)).toEqual({ paid_date: '2026-09-17' })
    expect(parsePaidInput({ paid_date: '2026-01-02' }, noon)).toEqual({ paid_date: '2026-01-02' })
  })
  it('refuses a missing date, an impossible date and a future one', () => {
    expect(refusal(() => parsePaidInput({}, noon)).code).toBe('paid_date_required')
    expect(refusal(() => parsePaidInput({ paid_date: '2026-02-30' }, noon)).code).toBe('invalid_paid_date')
    expect(refusal(() => parsePaidInput({ paid_date: '2026-09-18' }, noon)).code).toBe('paid_date_in_future')
  })
  it('uses the Zurich calendar: 00:30 local on the 18th is already the 18th', () => {
    // 22:30 UTC on the 17th is 00:30 CEST on the 18th. A UTC "today" would
    // refuse a payment recorded on the local morning of the 18th.
    const justAfterMidnight = new Date('2026-09-17T22:30:00Z')
    expect(todayInZurich(justAfterMidnight)).toBe('2026-09-18')
    expect(parsePaidInput({ paid_date: '2026-09-18' }, justAfterMidnight)).toEqual({ paid_date: '2026-09-18' })
  })
})

describe('parseVoidInput and the confirmation', () => {
  it('requires a reason, and one reason serves both languages', () => {
    expect(refusal(() => parseVoidInput({})).code).toBe('void_reason_required')
    expect(refusal(() => parseVoidInput({ reason_en: '   ' })).code).toBe('void_reason_required')
    expect(parseVoidInput({ reason_en: 'Wrong entity' }).reason).toEqual({ fr: 'Wrong entity', en: 'Wrong entity' })
  })
  it('matches the number EXACTLY — no trimming, no case folding, and says "required"', () => {
    expect(() => assertConfirmMatches(null, 'BC-2026-0007')).not.toThrow()
    expect(() => assertConfirmMatches('BC-2026-0007', 'BC-2026-0007')).not.toThrow()
    for (const wrong of ['bc-2026-0007', ' BC-2026-0007', 'BC-2026-0007 ', 'BC-2026-0008', '7']) {
      const e = refusal(() => assertConfirmMatches(wrong, 'BC-2026-0007'))
      expect(e.code).toBe('confirm_mismatch')
      expect(e.message).toContain('required')
    }
  })
})

describe('assertReadyToIssue', () => {
  it('passes a complete invoice (the positive case, first)', () => {
    expect(() => assertReadyToIssue(invoice(), company())).not.toThrow()
  })
  it('refuses a bill for nothing, a bill to nobody, and a bill for no money', () => {
    expect(refusal(() => assertReadyToIssue(invoice({ items: [] }), company())).code).toBe('no_lines')
    expect(refusal(() => assertReadyToIssue(invoice({ client: { ...invoice().client, name: ' ' } }), company())).code).toBe('no_client')
    const zero = invoice({ totals: { ...invoice().totals, total: '0.00' } })
    expect(refusal(() => assertReadyToIssue(zero, company())).code).toBe('total_not_positive')
    const credit = invoice({ totals: { ...invoice().totals, total: '-12.35' } })
    expect(refusal(() => assertReadyToIssue(credit, company())).code).toBe('total_not_positive')
    // The smallest real amount is still a bill.
    const fiveRappen = invoice({ totals: { ...invoice().totals, total: '0.05' } })
    expect(() => assertReadyToIssue(fiveRappen, company())).not.toThrow()
  })
  it('refuses when the company can no longer take the payment', () => {
    expect(refusal(() => assertReadyToIssue(invoice(), company({ iban: null }))).code).toBe('company_has_no_iban')
    // A draft switched to QRR after create, for a company with no QR-IBAN.
    expect(refusal(() => assertReadyToIssue(invoice({ ref_type: 'QRR' }), company())).code).toBe('qrr_needs_qr_iban')
    expect(refusal(() => assertReadyToIssue(invoice(), company({ retired_at: new Date() }))).code).toBe('company_retired')
  })
  it('re-runs the VAT write-door rule: the company may have stopped being registered', () => {
    const withVat = invoice({ items: [{ ...invoice().items[0], vat_rate: '8.1' }] })
    expect(refusal(() => assertReadyToIssue(withVat, company({ vat_registered: false }))).code).toBe('company_not_vat_registered')
    expect(() => assertReadyToIssue(withVat, company({ vat_registered: true }))).not.toThrow()
  })
})

describe('the email', () => {
  it('writes the default copy in the DOCUMENT language, with the due date only when there is one', () => {
    expect(defaultEmailCopy(invoice({ language: 'de' }), 'Acme SA').subject).toBe('Rechnung BC-2026-0007 – Acme SA')
    expect(defaultEmailCopy(invoice({ language: 'fr' }), 'Acme SA').body).toContain('payable d’ici au 17.10.2026')
    expect(defaultEmailCopy(invoice({ language: 'en', due_date: null }), 'Acme SA').body).not.toContain('payable')
  })
  it('names the file after the number, with nothing a filesystem would choke on', () => {
    expect(documentFilename('BC-2026-0007')).toBe('BC-2026-0007.pdf')
    expect(documentFilename('AL/2026 #7')).toBe('AL-2026-7.pdf')
  })
  it('keys the transport on WHAT is sent: a retry matches, a corrected address does not', () => {
    const sent = { to: 'client@example.ch', cc: ['b@x.ch', 'a@x.ch'], subject: 's', body: 'b', pdfSha256: 'f'.repeat(64) }
    const k = transportIdempotencyKey(1, 42, sent)
    expect(transportIdempotencyKey(1, 42, { ...sent, cc: ['a@x.ch', 'b@x.ch'] })).toBe(k)
    expect(transportIdempotencyKey(1, 42, { ...sent, to: 'CLIENT@example.ch' })).toBe(k)
    expect(transportIdempotencyKey(1, 42, { ...sent, to: 'other@example.ch' })).not.toBe(k)
    expect(transportIdempotencyKey(1, 42, { ...sent, pdfSha256: 'e'.repeat(64) })).not.toBe(k)
    expect(k.length).toBeLessThanOrEqual(256)
  })
})
