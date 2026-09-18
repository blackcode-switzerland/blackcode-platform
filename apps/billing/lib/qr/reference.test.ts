// Check digits and accounts, against the standard's own numbers.
//
// The vectors come from the SIX QR-bill guidelines v2.4 (24.02.2026): the Annex B
// worked example, the references and accounts in Annex A's examples 1–3 and 5–6,
// and the documented erratum in example 4. Every one was re-computed here rather
// than trusted — a spec example is only a vector once something has checked it.
//
// Watched failing on 2026-09-17, each restored:
//   - the carry table's last two entries swapped (3, 5 → 5, 3) → the Annex B
//     vector and example 1's reference went red
//   - SCOR check digits as `97 - …` instead of `98 - …` → both SCOR vectors
//   - `SCOR_BODY_MAX` back to 25 → the 22-character body was accepted
import { describe, expect, it } from 'vitest'
import {
  compactIban,
  formatIban,
  formatQRR,
  formatSCOR,
  invoiceAccount,
  invoiceReference,
  isQrIban,
  isValidIban,
  isValidQRR,
  isValidSCOR,
  qrrBody,
  qrrCheckDigit,
  refQRR,
  refSCOR,
  ReferenceProblem,
  referenceBodyFor,
  referenceBodyProblem,
  scorCheckDigits,
} from './reference'

describe('QRR — modulo 10 recursive', () => {
  it('reproduces the Annex B worked example: …0901 → 7', () => {
    expect(qrrCheckDigit('21000000000313947143000901')).toBe('7')
    expect(refQRR('21000000000313947143000901')).toBe('210000000003139471430009017')
  })

  it('validates the references printed in Annex A examples 1 and 2', () => {
    expect(isValidQRR('000008207791225857421286694')).toBe(true) // example 1
    expect(isValidQRR('210000000003139471430009017')).toBe(true) // example 2
  })

  it('refuses a wrong check digit, all zeros, and the wrong length', () => {
    expect(isValidQRR('210000000003139471430009016')).toBe(false)
    expect(isValidQRR('0'.repeat(27))).toBe(false)
    expect(isValidQRR('21000000000313947143000901')).toBe(false)
    expect(() => qrrCheckDigit('2100000000031394714300090A')).toThrow(ReferenceProblem)
  })
})

describe('SCOR — ISO 11649, modulo 97-10', () => {
  it('reproduces the vector used by Annex A examples 5 and 6: 539007547034 → RF18…', () => {
    expect(scorCheckDigits('539007547034')).toBe('18')
    expect(refSCOR('539007547034')).toBe('RF18539007547034')
    expect(isValidSCOR('RF18539007547034')).toBe(true)
  })

  it('keeps the PDF erratum in code: example 4’s reference does NOT validate', () => {
    // qr-bill.md §4. The PDF prints RF72; the correct check digits are 24.
    expect(isValidSCOR('RF720191230100405JSH0438')).toBe(false)
    expect(refSCOR('0191230100405JSH0438')).toBe('RF240191230100405JSH0438')
    expect(isValidSCOR('RF240191230100405JSH0438')).toBe(true)
  })

  it('treats letters case-insensitively and prints the reference uppercase', () => {
    expect(refSCOR('bc20260007')).toBe(refSCOR('BC20260007'))
    expect(refSCOR('bc20260007')).toMatch(/^RF\d{2}BC20260007$/)
  })

  it('refuses a body over 21 characters — 25 is the whole reference', () => {
    expect(() => scorCheckDigits('A'.repeat(21))).not.toThrow()
    expect(() => scorCheckDigits('A'.repeat(22))).toThrow(ReferenceProblem)
    expect(isValidSCOR('RF18' + '5'.repeat(22))).toBe(false)
  })
})

describe('IBAN — ISO 13616, CH and LI', () => {
  it('validates the accounts in Annex A, and tells QR-IBANs apart by institution id', () => {
    expect(isValidIban('CH6431961000004421557')).toBe(true) // example 1, QR-IBAN
    expect(isQrIban('CH6431961000004421557')).toBe(true)
    expect(isValidIban('CH4431999123000889012')).toBe(true) // example 2, QR-IBAN (31999, the top of the range)
    expect(isQrIban('CH4431999123000889012')).toBe(true)
    expect(isValidIban('CH5204835012345671000')).toBe(true) // example 3, ordinary IBAN
    expect(isQrIban('CH5204835012345671000')).toBe(false)
  })

  it('draws the QR-IID range at exactly 30000–31999', () => {
    expect(isQrIban('CH0029999000000000000')).toBe(false)
    expect(isQrIban('CH0030000000000000000')).toBe(true)
    expect(isQrIban('CH0031999000000000000')).toBe(true)
    expect(isQrIban('CH0032000000000000000')).toBe(false)
  })

  it('refuses one changed digit, spaces, lowercase and other countries', () => {
    expect(isValidIban('CH4431999123000889013')).toBe(false)
    expect(isValidIban('CH44 3199 9123 0008 8901 2')).toBe(false)
    expect(isValidIban(compactIban('ch44 3199 9123 0008 8901 2'))).toBe(true)
    expect(isValidIban('DE89370400440532013000')).toBe(false)
  })

  it('pays a QRR bill into the QR-IBAN and everything else into the IBAN', () => {
    const company = { iban: 'CH5204835012345671000', qr_iban: 'CH4431999123000889012' }
    expect(invoiceAccount('QRR', company)).toBe(company.qr_iban)
    expect(invoiceAccount('SCOR', company)).toBe(company.iban)
    expect(invoiceAccount('NON', company)).toBe(company.iban)
  })
})

describe('printed forms (§3.5.4)', () => {
  it('groups IBAN in fours, QRR as 2 + 5×5, SCOR in fours', () => {
    expect(formatIban('CH4431999123000889012')).toBe('CH44 3199 9123 0008 8901 2')
    expect(formatQRR('210000000003139471430009017')).toBe('21 00000 00003 13947 14300 09017')
    expect(formatSCOR('RF18539007547034')).toBe('RF18 5390 0754 7034')
  })
})

describe('the body scheme and the write door', () => {
  it('lays out the QRR body as 14 zeros, company # in 4, seq_no in 8 (position P11)', () => {
    expect(qrrBody(3, 7)).toBe('00000000000000' + '0003' + '00000007')
    expect(() => qrrBody(10000, 1)).toThrow(ReferenceProblem)
  })

  it('derives SCOR from the invoice number without its punctuation', () => {
    expect(referenceBodyFor('SCOR', null, 1, 7, 'BC-2026-0007')).toBe('BC20260007')
    expect(referenceBodyFor('QRR', null, 1, 7, 'BC-2026-0007')).toBe(qrrBody(1, 7))
    expect(referenceBodyFor('NON', null, 1, 7, 'BC-2026-0007')).toBeNull()
  })

  it('REFUSES a number too long for a creditor reference instead of truncating it', () => {
    // 21 letters and digits: fits.
    expect(referenceBodyFor('SCOR', null, 1, 7, 'ACME-INVOICE-2026-000007')).toBe('ACMEINVOICE2026000007')
    // 22: the phase-1 code sliced this to 25 and produced an invalid reference;
    // truncating to 21 would let two numbers share one.
    const e = (() => {
      try {
        referenceBodyFor('SCOR', null, 1, 7, 'ACME-INVOICES-2026-000007')
      } catch (err) {
        return err
      }
    })()
    expect(e).toBeInstanceOf(ReferenceProblem)
    expect((e as ReferenceProblem).code).toBe('number_cannot_form_reference')
  })

  it('checks a supplied body against the type it will carry', () => {
    expect(referenceBodyProblem('SCOR', 'INV-7')?.code).toBe('invalid_creditor_reference')
    expect(referenceBodyProblem('SCOR', 'A'.repeat(22))?.code).toBe('invalid_creditor_reference')
    expect(referenceBodyProblem('SCOR', 'A'.repeat(21))).toBeNull()
    expect(referenceBodyProblem('QRR', '1'.repeat(25))?.code).toBe('invalid_qr_reference')
    expect(referenceBodyProblem('QRR', '0'.repeat(26))?.code).toBe('invalid_qr_reference')
    expect(referenceBodyProblem('NON', '123')?.code).toBe('non_takes_no_reference')
    expect(referenceBodyProblem('QRR', null)).toBeNull()
  })

  it('completes a stored body into the reference a bill carries', () => {
    expect(invoiceReference('QRR', '21000000000313947143000901')).toBe('210000000003139471430009017')
    expect(invoiceReference('SCOR', '539007547034')).toBe('RF18539007547034')
    expect(invoiceReference('NON', null)).toBeNull()
    expect(() => invoiceReference('SCOR', null)).toThrow(ReferenceProblem)
  })
})
