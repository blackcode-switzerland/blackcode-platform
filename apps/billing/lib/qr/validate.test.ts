// Every refusal the standard requires, and — first — the bills that must pass.
//
// The positive cases lead, per CLAUDE.md finding #16: a validator that refuses
// everything passes every "was this refused?" assertion below.
//
// Watched failing on 2026-09-17, each restored:
//   - `validateQrBill` made to return `[]` → every refusal case went red
//   - made to refuse everything (a constant refusal pushed first) → the four
//     positive shapes and Example 2 went red
//   - the QR-IBAN matrix check removed → "QR-IBAN with SCOR" went red
//   - the 140 budget counted in UTF-16 units → the emoji budget case went red
import { describe, expect, it } from 'vitest'
import { hasPaymentPart, validateQrBill } from './validate'
import { qrBillFieldsFor, type QrBillFields, type QrCompany } from './payload'
import { EXAMPLE_2 } from './spec-examples'
import type { Invoice, ReferenceType } from '@/types'

const codes = (f: QrBillFields) => validateQrBill(f).map((r) => r.code)

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

function invoice(refType: ReferenceType, refBody: string | null, currency = 'CHF'): Invoice {
  return {
    seq: 7, company: 'blackcode', number: 'BC-2026-0007', seq_no: 7, status: 'draft',
    issue_date: '2026-09-17', due_date: '2026-10-17', paid_date: null, currency, language: 'fr',
    ref_type: refType, ref_body: refBody,
    client: { name: 'Junod SA', street: 'Avenue de la Gare', building: '3', postal_code: '1003', city: 'Lausanne', country: 'CH' },
    vat_rate: null, prices_include_vat: false, message: 'Facture BC-2026-0007', void: null,
    sent_at: null, sent_message_id: null, pdf_sha256: null, items: [],
    totals: { subtotal: '1590.60', vat: [], vat_total: '0.00', rounding: '0.00', total: '1590.60' },
    external_ref: null, metadata: {},
  } as unknown as Invoice
}

describe('the bills that must pass', () => {
  it('the standard’s Example 2', () => {
    expect(validateQrBill(EXAMPLE_2)).toEqual([])
  })

  it('the four shapes this app issues: CHF+QRR, CHF+SCOR, EUR+SCOR, CHF+NON', () => {
    const shapes: Array<[ReferenceType, string | null, string]> = [
      ['QRR', '00000000000000000100000007', 'CHF'],
      ['SCOR', 'BC20260007', 'CHF'],
      ['SCOR', 'BC20260007', 'EUR'],
      ['NON', null, 'CHF'],
    ]
    for (const [type, body, currency] of shapes) {
      const refusals = validateQrBill(qrBillFieldsFor(invoice(type, body, currency), company))
      expect(refusals, `${currency}+${type}`).toEqual([])
    }
  })

  it('a bill with no amount and no debtor — the payer fills both in', () => {
    expect(validateQrBill({ ...EXAMPLE_2, amount: null, debtor: null })).toEqual([])
  })
})

describe('the account and reference matrix (§7.1)', () => {
  it('refuses a QR-IBAN with SCOR or NON', () => {
    expect(codes({ ...EXAMPLE_2, referenceType: 'SCOR', reference: 'RF18539007547034' })).toContain('qr_iban_requires_qrr')
    expect(codes({ ...EXAMPLE_2, referenceType: 'NON', reference: null })).toContain('qr_iban_requires_qrr')
  })

  it('refuses QRR on an ordinary IBAN', () => {
    expect(codes({ ...EXAMPLE_2, account: 'CH5204835012345671000' })).toContain('qrr_requires_qr_iban')
  })

  it('refuses QRR in EUR (v2.4)', () => {
    expect(codes({ ...EXAMPLE_2, currency: 'EUR' })).toContain('qrr_chf_only')
  })

  it('refuses NON with a reference', () => {
    expect(codes({ ...EXAMPLE_2, account: 'CH5204835012345671000', referenceType: 'NON', reference: 'RF18539007547034' })).toContain('non_takes_no_reference')
  })

  it('refuses a missing account, a foreign account, and a wrong check digit', () => {
    expect(codes({ ...EXAMPLE_2, account: '' })).toContain('account_missing')
    expect(codes({ ...EXAMPLE_2, account: 'DE89370400440532013000' })).toContain('iban_country_not_allowed')
    expect(codes({ ...EXAMPLE_2, account: 'CH4431999123000889013' })).toContain('invalid_iban')
  })

  it('refuses invalid references, including the PDF’s own erratum', () => {
    expect(codes({ ...EXAMPLE_2, reference: '210000000003139471430009016' })).toContain('invalid_qr_reference')
    expect(
      codes({ ...EXAMPLE_2, account: 'CH5204835012345671000', referenceType: 'SCOR', reference: 'RF720191230100405JSH0438' })
    ).toContain('invalid_creditor_reference')
  })
})

describe('amount and currency', () => {
  it('has a payment part for CHF and EUR only', () => {
    expect(hasPaymentPart('CHF')).toBe(true)
    expect(hasPaymentPart('EUR')).toBe(true)
    expect(hasPaymentPart('USD')).toBe(false)
    expect(codes({ ...EXAMPLE_2, currency: 'USD' })).toContain('no_payment_part_for_currency')
  })

  it('refuses every amount the payload cannot carry', () => {
    for (const amount of ['0.00', '-5.00', '1,590.00', '1590.5', '01.00', '1000000000.00', '1 590.00']) {
      expect(codes({ ...EXAMPLE_2, amount }), amount).toContain('invalid_amount')
    }
    for (const amount of ['0.01', '0.50', '999999999.99']) {
      expect(codes({ ...EXAMPLE_2, amount }), amount).not.toContain('invalid_amount')
    }
  })
})

describe('addresses', () => {
  it('names every missing element of the creditor’s address in one refusal', () => {
    const r = validateQrBill({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, postalCode: null, town: null } })
    const incomplete = r.find((x) => x.code === 'creditor_address_incomplete')
    expect(incomplete?.message).toContain('postal code, town')
  })

  it('refuses a used debtor group with a missing dependent element (§4.1.5)', () => {
    expect(codes({ ...EXAMPLE_2, debtor: { ...EXAMPLE_2.debtor!, country: null } })).toContain('debtor_address_incomplete')
  })

  it('refuses a field over its payload width, measured in characters', () => {
    const r = validateQrBill({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, town: 'Ö'.repeat(36) } })
    expect(r.find((x) => x.code === 'field_too_long')?.field).toBe('creditor.town')
    expect(codes({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, town: 'Ö'.repeat(35) } })).not.toContain('field_too_long')
  })

  it('refuses a country that is not two capital letters', () => {
    expect(codes({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, country: 'ch' } })).toContain('invalid_country')
  })
})

describe('text', () => {
  it('refuses a character outside §4.1.1, naming the field, codepoint and position', () => {
    const r = validateQrBill({ ...EXAMPLE_2, unstructuredMessage: 'Order\nfrom 15.10.2020' })
    const bad = r.find((x) => x.code === 'character_not_allowed')
    expect(bad?.field).toBe('unstructuredMessage')
    expect(bad?.message).toContain('a line break (U+000A) at character 6')
  })

  it('refuses a creditor name the code cannot carry, naming the character and its position', () => {
    // The phase-2 done-when names this field specifically: the creditor name must
    // match the account holder, so it is the one a silent substitution breaks.
    const r = validateQrBill({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, name: 'Muster Əhne AG' } })
    const bad = r.find((x) => x.code === 'character_not_allowed')
    expect(bad?.field).toBe('creditor.name')
    expect(bad?.message).toContain('"Ə" (U+018F) at character 8')
  })

  it('shares 140 characters between the message and billing information, counted in characters', () => {
    const billing = EXAMPLE_2.billingInformation!
    const room = 140 - [...billing].length
    expect(codes({ ...EXAMPLE_2, unstructuredMessage: 'x'.repeat(room) })).not.toContain('additional_information_too_long')
    expect(codes({ ...EXAMPLE_2, unstructuredMessage: 'x'.repeat(room + 1) })).toContain('additional_information_too_long')
    // An emoji is refused by the character set, and counts as ONE character
    // toward the budget — not the two UTF-16 units `.length` reports.
    expect(codes({ ...EXAMPLE_2, unstructuredMessage: '😀'.repeat(room) })).not.toContain('additional_information_too_long')
  })

  it('refuses more than two alternative procedures', () => {
    expect(codes({ ...EXAMPLE_2, alternativeProcedures: ['a', 'b', 'c'] })).toContain('alternative_procedure_invalid')
  })

  it('refuses a payload over 997 characters', () => {
    const r = codes({ ...EXAMPLE_2, creditor: { ...EXAMPLE_2.creditor, name: 'M'.repeat(900) } })
    expect(r).toContain('payload_too_long')
    expect(r).toContain('field_too_long')
  })
})

describe('refusals are actionable', () => {
  it('every refusal carries a code, a sentence and a suggestion', () => {
    const everything: QrBillFields = {
      ...EXAMPLE_2,
      account: 'CH4431999123000889013',
      currency: 'USD',
      amount: '0.00',
      reference: 'x',
      creditor: { ...EXAMPLE_2.creditor, town: null, country: 'ch', name: 'Səhne' },
      unstructuredMessage: 'a\nb',
      alternativeProcedures: ['a', 'b', 'c'],
    }
    const r = validateQrBill(everything)
    expect(r.length).toBeGreaterThan(5)
    for (const x of r) {
      expect(x.code, JSON.stringify(x)).toMatch(/^[a-z_]+$/)
      expect(x.message.length).toBeGreaterThan(10)
      expect(x.suggestion.length).toBeGreaterThan(5)
    }
  })
})
