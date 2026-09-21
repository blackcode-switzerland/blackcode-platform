// The payload, line by line.
//
// ===========================================================================
// THE GOLDEN TEST IS THE STANDARD'S EXAMPLE 2, FROM THE PDF
// ===========================================================================
// Table 18 of the v2.4 guidelines (page 52–53): QRR, a debtor, billing
// information and one alternative procedure, with `¶` = CR+LF.
//
// One transcription difference from our own research digest, and the PDF wins:
// the creditor name in the v2.4 PDF reads `Max Muster & Söhne (sample
// company)`. The extraction in b-mockups dropped the parenthesis. The serializer
// copies names verbatim, so the difference changes no rule this test checks —
// it is recorded so nobody "fixes" it back.
//
// Watched failing on 2026-09-17, each restored:
//   - the join forced to '\n' whatever was asked → the CR+LF golden went red
//   - the trailing-A-line trim removed, so an unused line 32 is sent empty → the
//     "ends at EPD" case went red
//   - one Ultimate Creditor empty line deleted → the golden and the position
//     checks went red
import { describe, expect, it } from 'vitest'
import { qrBillFieldsFor, serializeQrPayload, type QrCompany } from './payload'
import { EXAMPLE_2, EXAMPLE_2_LINES } from './spec-examples'
import type { Invoice } from '@/types'

describe('serializeQrPayload', () => {
  it('reproduces the standard’s Example 2 byte for byte, with CR+LF', () => {
    const expected = EXAMPLE_2_LINES.join('\r\n')
    const actual = serializeQrPayload(EXAMPLE_2, '\r\n')
    expect(actual).toBe(expected)
    expect(Buffer.from(actual, 'utf8').equals(Buffer.from(expected, 'utf8'))).toBe(true)
    expect(actual.endsWith('\r\n')).toBe(false)
  })

  it('uses one line ending throughout, and LF alone is equally valid', () => {
    const lf = serializeQrPayload(EXAMPLE_2, '\n')
    expect(lf).toBe(EXAMPLE_2_LINES.join('\n'))
    expect(lf).not.toContain('\r')
    expect(serializeQrPayload(EXAMPLE_2, '\r\n').split('\r\n')).toHaveLength(33)
  })

  it('always sends the seven empty Ultimate Creditor lines (status X)', () => {
    const lines = serializeQrPayload(EXAMPLE_2).split('\n')
    expect(lines.slice(11, 18)).toEqual(['', '', '', '', '', '', ''])
    expect(lines[18]).toBe('1949.75') // line 19
  })

  it('ends at EPD when no status-A line is used — no empty line 32, no trailing separator', () => {
    const payload = serializeQrPayload({ ...EXAMPLE_2, billingInformation: null, alternativeProcedures: [] })
    const lines = payload.split('\n')
    expect(lines).toHaveLength(31)
    expect(lines[30]).toBe('EPD')
    expect(payload.endsWith('EPD')).toBe(true)
  })

  it('emits exactly two alternative procedures when given two', () => {
    const lines = serializeQrPayload({ ...EXAMPLE_2, alternativeProcedures: ['eBill/B/a@example.com', 'X/1'] }).split('\n')
    expect(lines).toHaveLength(34)
    expect(lines.slice(31)).toEqual(['//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30', 'eBill/B/a@example.com', 'X/1'])
  })

  it('keeps line 32 in position, empty, when only an alternative procedure is used', () => {
    // The standard does not decide this case; see payload.ts's header.
    const lines = serializeQrPayload({ ...EXAMPLE_2, billingInformation: null }).split('\n')
    expect(lines).toHaveLength(33)
    expect(lines[31]).toBe('')
    expect(lines[32]).toBe('eBill/B/simon.muster@example.com')
  })

  it('sends an empty debtor block and an empty amount when neither is known', () => {
    const lines = serializeQrPayload({ ...EXAMPLE_2, amount: null, debtor: null }).split('\n')
    expect(lines[18]).toBe('')
    expect(lines.slice(20, 27)).toEqual(['', '', '', '', '', '', ''])
    expect(lines[27]).toBe('QRR') // line 28 did not move
  })
})

// ---------------------------------------------------------------------------
// From an invoice
// ---------------------------------------------------------------------------

const company: QrCompany = {
  legal_name: 'Blackcode Sàrl',
  street: 'Rue du Marché',
  building: '12',
  postal_code: '1204',
  city: 'Genève',
  country: 'CH',
  iban: 'CH5204835012345671000',
  qr_iban: 'CH4431999123000889012',
}

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    seq: 7,
    company: 'blackcode',
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
    client: { name: 'Junod SA', street: 'Avenue de la Gare', building: '3', postal_code: '1003', city: 'Lausanne', country: 'CH' },
    vat_rate: null,
    prices_include_vat: false,
    message: '  Facture BC-2026-0007  ',
    void: null,
    sent_at: null,
    sent_message_id: null,
    pdf_sha256: null,
    items: [],
    totals: { subtotal: '1590.60', vat: [], vat_total: '0.00', rounding: '0.00', total: '1590.60' },
    external_ref: null,
    metadata: {},
    ...over,
  } as Invoice
}

describe('qrBillFieldsFor', () => {
  it('uses the company’s LEGAL name and ordinary IBAN for a SCOR bill, with the derived reference', () => {
    const f = qrBillFieldsFor(invoice(), company)
    expect(f.creditor.name).toBe('Blackcode Sàrl')
    expect(f.account).toBe('CH5204835012345671000')
    expect(f.reference).toMatch(/^RF\d{2}BC20260007$/)
    expect(f.amount).toBe('1590.60')
    expect(f.unstructuredMessage).toBe('Facture BC-2026-0007') // trimmed: §4.1.3 forbids blank padding
  })

  it('uses the QR-IBAN and a 27-digit reference for a QRR bill', () => {
    const f = qrBillFieldsFor(invoice({ ref_type: 'QRR', ref_body: '21000000000313947143000901' }), company)
    expect(f.account).toBe('CH4431999123000889012')
    expect(f.reference).toBe('210000000003139471430009017')
  })

  it('includes the debtor only when its structured address is complete', () => {
    expect(qrBillFieldsFor(invoice(), company).debtor?.town).toBe('Lausanne')
    const partial = invoice({ client: { name: 'Junod SA', street: null, building: null, postal_code: null, city: 'Lausanne', country: 'CH' } })
    expect(qrBillFieldsFor(partial, company).debtor).toBeNull()
  })

  it('passes a malformed stored body through so validation can name it, instead of throwing', () => {
    const f = qrBillFieldsFor(invoice({ ref_body: 'BC-2026-0007' }), company)
    expect(f.reference).toBe('BC-2026-0007')
  })

  it('carries no billing information and no alternative procedures in v1', () => {
    const f = qrBillFieldsFor(invoice(), company)
    expect(f.billingInformation).toBeNull()
    expect(f.alternativeProcedures).toEqual([])
    expect(serializeQrPayload(f).endsWith('EPD')).toBe(true)
  })
})
