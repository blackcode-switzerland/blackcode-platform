// The write-door rules — the ones with no database object behind them.
//
// ===========================================================================
// WHY THESE FOUR NEED A TEST MORE THAN THE TRIGGERS DO
// ===========================================================================
// Most of this app's invariants are enforced by Postgres: the number freeze, the
// status machine, the document freeze, the combination matrix, the closed
// vocabularies. Those hold against a migration, a console session and a second
// deployment, and a test of them is a test of the database.
//
// Four rules cannot be. Two need a row from another table, which a CHECK
// constraint cannot reach; two are about a request rather than a row:
//
//   assertRefTypeAgainstCompany   QRR requires the company to HAVE a QR-IBAN
//   assertLinesAgainstCompany     an unregistered company charges no VAT
//   assertMessage                 the 140-character QR-bill budget
//   assertExpectedTotal           the caller's arithmetic against ours
//
// Their only home is a route, so **a write path that forgot to call one would
// pass every other guard in this repo**. That is what makes them worth a test,
// and it is why `invoices.ts` names them in its header rather than leaving a
// reader to discover the gap.
//
// They are pure functions of their arguments, so this is a unit test with no
// database — which also means it runs on every `npm test` rather than skipping
// when Postgres is absent. A skipped check reports success (finding #12).

import { describe, it, expect } from 'vitest'
import {
  assertExpectedTotal,
  assertLinesAgainstCompany,
  assertMessage,
  assertRefTypeAgainstCompany,
  assertVocabulary,
  InvoiceRefused,
} from './invoices'
import type { CreateInvoiceLineBody } from '@/types'

/** Pull the code and suggestion off a refusal, or fail loudly. */
function refusal(fn: () => void): InvoiceRefused {
  try {
    fn()
  } catch (e) {
    if (e instanceof InvoiceRefused) return e
    throw new Error(`expected an InvoiceRefused, got ${String(e)}`)
  }
  throw new Error('expected a refusal and the call succeeded')
}

describe('QRR requires the company to have a QR-IBAN', () => {
  it('ACCEPTS a CHF bill on a company that has one', () => {
    // The positive case first. A guard built only on refusals cannot tell a
    // working rule from one that refuses everything — finding #16.
    expect(() => assertRefTypeAgainstCompany('QRR', 'CHF', 'CH4431999123000889012')).not.toThrow()
  })

  it('refuses QRR when the company has no QR-IBAN, and names the way out', () => {
    const e = refusal(() => assertRefTypeAgainstCompany('QRR', 'CHF', null))
    expect(e.code).toBe('qrr_needs_qr_iban')
    expect(e.status).toBe(409)
    // The suggestion has to name the alternatives, because "you cannot do that"
    // leaves somebody with an invoice they cannot finish.
    expect(e.suggestion).toMatch(/SCOR/)
    expect(e.suggestion).toMatch(/30000/)
  })

  it('refuses QRR in any currency but CHF', () => {
    const e = refusal(() => assertRefTypeAgainstCompany('QRR', 'EUR', 'CH4431999123000889012'))
    expect(e.code).toBe('qrr_chf_only')
    expect(e.message).toMatch(/EUR/)
  })

  it('does not interfere with SCOR or NON', () => {
    // The rule is about QRR alone. A version that checked the QR-IBAN for every
    // reference type would make a company with no QR-IBAN unable to bill at all.
    expect(() => assertRefTypeAgainstCompany('SCOR', 'EUR', null)).not.toThrow()
    expect(() => assertRefTypeAgainstCompany('NON', 'GBP', null)).not.toThrow()
  })
})

describe('a company that is not VAT-registered charges no VAT', () => {
  const line = (vat: string | null | undefined): CreateInvoiceLineBody => ({
    description: 'x',
    unit_price: '10.00',
    ...(vat === undefined ? {} : { vat_rate: vat }),
  })

  it('ACCEPTS lines with no rate', () => {
    expect(() => assertLinesAgainstCompany([line(undefined), line(null)], false, 'praxis')).not.toThrow()
  })

  it('ACCEPTS any rate when the company IS registered', () => {
    expect(() => assertLinesAgainstCompany([line('8.1'), line('0')], true, 'acme')).not.toThrow()
  })

  it('refuses a rate on an unregistered company, and names the LINE', () => {
    const e = refusal(() => assertLinesAgainstCompany([line(null), line('8.1')], false, 'praxis'))
    expect(e.code).toBe('company_not_vat_registered')
    // Line 2, one-based: a message saying "some line" makes somebody read all
    // of them.
    expect(e.message).toMatch(/line 2/)
    expect(e.message).toMatch(/praxis/)
  })

  it('refuses a ZERO rate too, because zero is a rate', () => {
    // The distinction this app is built on: `"0"` is a real rate (export,
    // reverse charge) and an unregistered company may not claim one either.
    // A rule written as `vat_rate > 0` would let this through.
    const e = refusal(() => assertLinesAgainstCompany([line('0')], false, 'praxis'))
    expect(e.code).toBe('company_not_vat_registered')
  })
})

describe('the payment message budget', () => {
  it('ACCEPTS a message at exactly the limit', () => {
    expect(() => assertMessage('x'.repeat(140))).not.toThrow()
  })

  it('accepts nothing at all', () => {
    expect(() => assertMessage(null)).not.toThrow()
    expect(() => assertMessage(undefined)).not.toThrow()
    expect(() => assertMessage('')).not.toThrow()
  })

  it('refuses one character over, and says the budget is SHARED', () => {
    const e = refusal(() => assertMessage('x'.repeat(141)))
    expect(e.code).toBe('message_too_long')
    expect(e.message).toMatch(/141/)
    // The shared budget is why the limit is not simply "the column width": the
    // 140 characters are shared with structured billing information this app
    // does not emit yet, so emitting it later must not break every invoice.
    expect(e.suggestion).toMatch(/shared/)
  })
})

describe("the caller's arithmetic against ours", () => {
  const items: CreateInvoiceLineBody[] = [
    { description: 'Consulting', qty: '12', unit_price: '132.50', vat_rate: '8.1' },
  ]

  it('ACCEPTS a matching total', () => {
    // 12 × 132.50 = 1590.00; VAT 8.1% exclusive = 128.79 → line_0_05 → 128.80
    // total 1718.80
    expect(() => assertExpectedTotal(items, false, 'line_0_05', '1718.80', 'acme')).not.toThrow()
  })

  it('refuses a mismatch, and names the two settings that explain it', () => {
    const e = refusal(() => assertExpectedTotal(items, false, 'line_0_05', '1718.79', 'acme'))
    expect(e.code).toBe('total_mismatch')
    expect(e.status).toBe(409)
    expect(e.message).toMatch(/1718\.79/)
    expect(e.message).toMatch(/1718\.80/)
    // The whole value of this check is the DIAGNOSIS. "expected X got Y" sends
    // somebody hunting a bug in their own arithmetic; naming the policy and the
    // price mode points at the actual cause.
    expect(e.suggestion).toMatch(/line_0_05/)
    expect(e.suggestion).toMatch(/EXCLUDE/)
    expect(e.suggestion).toMatch(/no number was[\s\S]*allocated/)
  })

  it('is sensitive to the price mode, not just the numbers', () => {
    // Same lines, inclusive: the total is the subtotal, 1590.00.
    expect(() => assertExpectedTotal(items, true, 'line_0_05', '1590.00', 'acme')).not.toThrow()
    const e = refusal(() => assertExpectedTotal(items, true, 'line_0_05', '1718.80', 'acme'))
    expect(e.suggestion).toMatch(/INCLUDE/)
  })

  it('is sensitive to the rounding policy', () => {
    // `none` leaves the VAT at 128.79 and the total at 1718.79.
    expect(() => assertExpectedTotal(items, false, 'none', '1718.79', 'acme')).not.toThrow()
  })
})

describe('the vocabularies are checked at the door, not only by the CHECK', () => {
  it('ACCEPTS a real language and reference type', () => {
    expect(() => assertVocabulary('fr', 'QRR')).not.toThrow()
    expect(() => assertVocabulary('en', 'NON')).not.toThrow()
  })

  it('refuses an unknown language and points at `bk meta`', () => {
    const e = refusal(() => assertVocabulary('es', 'NON'))
    expect(e.code).toBe('invalid_language')
    // The suggestion names `bk meta` rather than listing the values, because a
    // list in an error message is a copy that goes stale.
    expect(e.suggestion).toMatch(/bk meta/)
  })

  it('refuses an unknown reference type', () => {
    expect(refusal(() => assertVocabulary('fr', 'IBAN')).code).toBe('invalid_ref_type')
  })
})
