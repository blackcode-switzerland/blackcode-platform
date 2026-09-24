// The company write door's field checks (ticket #757, 2026-09-23).
//
// ===========================================================================
// WHY THESE ARE CHECKED AT SAVE, AND WHY THAT NEEDS A TEST
// ===========================================================================
// Every field here reaches the payment part or an email header, and until this
// ticket the write paths stored whatever they were given: a mistyped IBAN, a
// country spelled out, an em dash in a legal name. Each saved cleanly and then
// refused EVERY bill the company issued, at PDF or send time, with a message
// naming the company rather than the keystroke. An unattended integration
// creating branch companies would discover that thousands of calls later.
//
// `normaliseCompanyFields` is pure and exported so this runs without a
// database, on every `npm test`. `write-paths.integration.test.ts` proves both
// write paths actually CALL it — a rule whose only home is a function nobody
// calls is the shape CLAUDE.md's table is full of.
//
// The positive cases come first in each block (finding #16): a guard built only
// on refusals cannot tell a working rule from one that refuses everything.

import { describe, expect, it } from 'vitest'
import { assertVatNumberIfRegistered, CompanyRefused, normaliseCompanyFields } from './companies'
import { EXTERNAL_REF_MAX } from '@/lib/limits'

function refusal(fn: () => unknown): CompanyRefused {
  try {
    fn()
  } catch (e) {
    if (e instanceof CompanyRefused) return e
    throw new Error(`expected a CompanyRefused, got ${String(e)}`)
  }
  throw new Error('expected a refusal and the call succeeded')
}

/** Spec example IBANs: an ordinary one and a QR-IBAN (IID 30000–31999). */
const IBAN = 'CH9300762011623852957'
const QR_IBAN = 'CH4431999123000889012'

describe('IBAN and QR-IBAN', () => {
  it('ACCEPTS a valid ordinary IBAN in iban and a valid QR-IBAN in qr_iban, compacted', () => {
    const out = normaliseCompanyFields({ iban: 'CH93 0076 2011 6238 5295 7', qr_iban: 'ch44 3199 9123 0008 8901 2' })
    expect(out.iban).toBe(IBAN)
    expect(out.qr_iban).toBe(QR_IBAN)
  })

  it('treats an empty string as "none"', () => {
    expect(normaliseCompanyFields({ iban: '', qr_iban: '  ' })).toEqual({ iban: null, qr_iban: null })
  })

  it('refuses a wrong check digit (ISO 13616 mod-97), and says which field', () => {
    const e = refusal(() => normaliseCompanyFields({ iban: 'CH9400762011623852957' }))
    expect(e.code).toBe('invalid_iban')
    expect(e.status).toBe(400)
    expect(e.message).toMatch(/^iban /)
    expect(e.suggestion).toMatch(/bank statement/)
  })

  it('refuses a transposed pair in qr_iban the same way', () => {
    // 31999 → 31989: still in the QR-IID range, so only the checksum can catch it.
    const e = refusal(() => normaliseCompanyFields({ qr_iban: 'CH4431989123000889012' }))
    expect(e.code).toBe('invalid_iban')
    expect(e.message).toMatch(/^qr_iban /)
  })

  it('refuses a non-CH/LI account before checking the digits', () => {
    // A valid German IBAN. The checksum passes; the country is the problem.
    const e = refusal(() => normaliseCompanyFields({ iban: 'DE89 3704 0044 0532 0130 00' }))
    expect(e.code).toBe('iban_country_not_allowed')
  })

  it('refuses an ordinary IBAN in qr_iban: the IID must be 30000–31999', () => {
    const e = refusal(() => normaliseCompanyFields({ qr_iban: IBAN }))
    expect(e.code).toBe('qr_iban_not_qr_iban')
    expect(e.message).toMatch(/30000/)
  })

  it('refuses a QR-IBAN in iban: it would make every SCOR and NON bill unsendable', () => {
    const e = refusal(() => normaliseCompanyFields({ iban: QR_IBAN }))
    expect(e.code).toBe('iban_is_qr_iban')
    expect(e.suggestion).toMatch(/qr_iban/)
  })
})

describe('country', () => {
  it('ACCEPTS an ISO 3166-1 alpha-2 code, uppercased', () => {
    expect(normaliseCompanyFields({ country: 'CH' }).country).toBe('CH')
    expect(normaliseCompanyFields({ country: 'li' }).country).toBe('LI')
    expect(normaliseCompanyFields({ country: '' }).country).toBeNull()
  })

  it('refuses a country name: the payment part carries the code', () => {
    const e = refusal(() => normaliseCompanyFields({ country: 'Schweiz' }))
    expect(e.code).toBe('invalid_country')
    expect(e.message).toMatch(/Schweiz/)
    expect(e.suggestion).toMatch(/CH/)
  })

  it('refuses digits and a three-letter code', () => {
    expect(refusal(() => normaliseCompanyFields({ country: 'CHE' })).code).toBe('invalid_country')
    expect(refusal(() => normaliseCompanyFields({ country: '41' })).code).toBe('invalid_country')
  })
})

describe('email', () => {
  it('ACCEPTS one syntactically valid address, trimmed', () => {
    expect(normaliseCompanyFields({ email: ' billing@example.ch ' }).email).toBe('billing@example.ch')
    expect(normaliseCompanyFields({ email: 'a.b+tag@sub.example.co.uk' }).email).toBe('a.b+tag@sub.example.co.uk')
    expect(normaliseCompanyFields({ email: '' }).email).toBeNull()
  })

  it('refuses a missing @, a missing domain, a list, and a display name', () => {
    for (const bad of ['billing', 'billing@', 'billing@example', 'a@x.ch, b@x.ch', 'a@x.ch;b@x.ch', 'Acme <a@x.ch>', 'a b@x.ch']) {
      const e = refusal(() => normaliseCompanyFields({ email: bad }))
      expect(e.code, bad).toBe('invalid_email')
    }
  })
})

describe('the legal name and address: the Swiss QR character set and Table 8 widths', () => {
  it('ACCEPTS accented Latin, the euro sign and Romanian comma-below letters', () => {
    const out = normaliseCompanyFields({ legal_name: 'Müller & Cie Sàrl', street: 'Rue du Marché', city: 'Genève', building: '12b', postal_code: '1204' })
    expect(out.legal_name).toBe('Müller & Cie Sàrl')
    expect(normaliseCompanyFields({ legal_name: 'Ștefan € Țară' }).legal_name).toBe('Ștefan € Țară')
  })

  it('turns an empty address field into null and refuses an empty legal name', () => {
    expect(normaliseCompanyFields({ street: '', building: '', postal_code: '', city: '' })).toEqual({ street: null, building: null, postal_code: null, city: null })
    expect(refusal(() => normaliseCompanyFields({ legal_name: '  ' })).code).toBe('invalid_legal_name')
  })

  it('refuses an em dash in the legal name, naming the character, its codepoint and position', () => {
    const e = refusal(() => normaliseCompanyFields({ legal_name: 'Acme — Genève' }))
    expect(e.code).toBe('character_not_allowed')
    expect(e.message).toMatch(/legal_name/)
    expect(e.message).toMatch(/U\+2014/)
    expect(e.message).toMatch(/character 6/)
    // Never substituted: the name must match the account holder.
    expect(e.suggestion).toMatch(/not substituted/)
  })

  it('refuses a line break in the street, and an emoji in the city', () => {
    expect(refusal(() => normaliseCompanyFields({ street: 'Rue A\nCase postale' })).message).toMatch(/line break/)
    expect(refusal(() => normaliseCompanyFields({ city: 'Genève 🏔' })).code).toBe('character_not_allowed')
  })

  it('refuses a value wider than the payment part allows, per field', () => {
    const e = refusal(() => normaliseCompanyFields({ legal_name: 'x'.repeat(71) }))
    expect(e.code).toBe('field_too_long')
    expect(e.message).toMatch(/71 characters/)
    expect(normaliseCompanyFields({ legal_name: 'x'.repeat(70) }).legal_name).toHaveLength(70)
    expect(refusal(() => normaliseCompanyFields({ building: 'x'.repeat(17) })).code).toBe('field_too_long')
    expect(refusal(() => normaliseCompanyFields({ postal_code: 'x'.repeat(17) })).code).toBe('field_too_long')
    expect(refusal(() => normaliseCompanyFields({ city: 'x'.repeat(36) })).code).toBe('field_too_long')
    expect(refusal(() => normaliseCompanyFields({ street: 'x'.repeat(71) })).code).toBe('field_too_long')
  })

  it('counts characters, not UTF-16 units', () => {
    // 70 accented letters are 70 characters and 70 units; the emoji case above
    // is what would differ, and it is refused for its character first.
    expect(normaliseCompanyFields({ legal_name: 'é'.repeat(70) }).legal_name).toHaveLength(70)
  })
})

describe('external_ref', () => {
  it(`ACCEPTS up to ${EXTERNAL_REF_MAX} characters and turns an empty string into null`, () => {
    expect(normaliseCompanyFields({ external_ref: 'x'.repeat(EXTERNAL_REF_MAX) }).external_ref).toHaveLength(EXTERNAL_REF_MAX)
    expect(normaliseCompanyFields({ external_ref: '' }).external_ref).toBeNull()
  })

  it(`refuses ${EXTERNAL_REF_MAX + 1} with a code, instead of a 500 from the column`, () => {
    const e = refusal(() => normaliseCompanyFields({ external_ref: 'x'.repeat(EXTERNAL_REF_MAX + 1) }))
    expect(e.code).toBe('invalid_external_ref')
    expect(e.status).toBe(400)
    expect(e.message).toMatch(new RegExp(`${EXTERNAL_REF_MAX + 1} characters`))
  })
})

describe('only the fields that are present are judged', () => {
  it('leaves an absent field absent and an explicit null null', () => {
    expect(normaliseCompanyFields({ name: 'Acme' })).toEqual({ name: 'Acme' })
    expect(normaliseCompanyFields({ iban: null, country: null, email: null })).toEqual({ iban: null, country: null, email: null })
  })

  it('does not mutate its input', () => {
    const input = { iban: 'CH93 0076 2011 6238 5295 7' }
    normaliseCompanyFields(input)
    expect(input.iban).toBe('CH93 0076 2011 6238 5295 7')
  })
})

describe('a registered company carries its VAT number', () => {
  it('ACCEPTS registered with a number, and unregistered with or without one', () => {
    expect(() => assertVatNumberIfRegistered(true, 'CHE-123.456.789 TVA')).not.toThrow()
    expect(() => assertVatNumberIfRegistered(false, null)).not.toThrow()
    expect(() => assertVatNumberIfRegistered(false, 'CHE-123.456.789 TVA')).not.toThrow()
  })

  it('refuses registered without a number, or with a blank one', () => {
    expect(refusal(() => assertVatNumberIfRegistered(true, null)).code).toBe('vat_number_required')
    expect(refusal(() => assertVatNumberIfRegistered(true, undefined)).code).toBe('vat_number_required')
    expect(refusal(() => assertVatNumberIfRegistered(true, '   ')).code).toBe('vat_number_required')
  })
})
