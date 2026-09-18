// Every mockup invoice, derived by THIS app, against the answers the MOCKUP's
// own code gives — to the rappen and to the character.
//
// ===========================================================================
// WHY THE ORACLE IS THE MOCKUP'S CODE, NOT ITS SCREENSHOTS
// ===========================================================================
// `fixtures/mockup.json` is written by `scripts/extract-mockup.mjs`, which runs
// the mockup's `billing-data.js` and records what its `computeTotals`,
// `invoiceReference`, `fmtRef`, `fmtIBAN` and `invoiceAccount` return for every
// invoice. Nothing below is a number somebody typed. So this is the test that
// catches a rounding rule implemented differently from the one Andrea reviewed —
// and it catches it on the mockup's own data, not on a fixture chosen to pass.
//
// The mockup prints amounts with a thin-space thousands separator (`19 200.00`);
// the comparison strips whitespace, and asserts the digits.
//
// ── WHAT IT DOES NOT PROVE ─────────────────────────────────────────────────
// That the SEED reproduces these numbers: `scripts/seed.ts` reads every seeded
// invoice back through the app's own read path and compares it to the same
// answers, and refuses to finish if one differs. This file proves the
// derivation; the seed proves the data.
//
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md

import { describe, expect, it } from 'vitest'
import { MOCKUP } from '@/lib/mockup'
import { computeTotals, hasVatBlock, type TotalsLine } from './totals'
import { renderNumber } from './number'
import { formatIban, formatQRR, formatSCOR, invoiceAccount, invoiceReference } from '@/lib/qr/reference'
import type { ReferenceType } from '@/types'

const digits = (s: string) => s.replace(/\s/g, '')

/** The mockup's lines as this app's: strings, and the invoice's one rate on every line. */
function linesOf(inv: (typeof MOCKUP.invoices)[number]): TotalsLine[] {
  return inv.items.map((it) => ({
    qty: String(it.qty),
    unit_price: it.unit_price.toFixed(2),
    vat_rate: inv.vat_rate === null ? null : String(inv.vat_rate),
  }))
}

describe('parity with the mockup, invoice by invoice', () => {
  it('has the mockup’s eleven invoices and an answer for each (guards against a vacuous pass)', () => {
    expect(MOCKUP.invoices).toHaveLength(11)
    for (const inv of MOCKUP.invoices) {
      expect(MOCKUP.answers[String(inv.id) as keyof typeof MOCKUP.answers], `no answer for ${inv.id}`).toBeDefined()
    }
    expect(MOCKUP.source.commit, 'the fixture does not say which mockup it came from').toMatch(/^[0-9a-f]{40}$/)
  })

  for (const inv of MOCKUP.invoices) {
    describe(`${inv.number} (${inv.currency}, ${inv.ref_type}, VAT ${inv.vat_rate ?? 'none'})`, () => {
      const a = MOCKUP.answers[String(inv.id) as keyof typeof MOCKUP.answers]
      const company = MOCKUP.companies.find((c) => c.id === inv.company_id)!
      const lines = linesOf(inv)

      it('subtotal, VAT and total, to the rappen — under the mockup’s own policy', () => {
        // `line_0_05` with prices EXCLUDING VAT is the mockup's behaviour, and it
        // is the default a company is created with.
        const t = computeTotals(lines, false, 'line_0_05')
        expect(t.subtotal).toBe(digits(a.subtotal))
        expect(t.vat_total).toBe(digits(a.vat))
        expect(t.total).toBe(digits(a.total))
        expect(hasVatBlock(lines)).toBe(a.has_vat)
      })

      it('the full reference, check digit included, and how it is printed', () => {
        const ref = invoiceReference(inv.ref_type as ReferenceType, inv.ref_body)
        expect(ref).toBe(a.reference)
        const printed = ref === null ? null : inv.ref_type === 'QRR' ? formatQRR(ref) : formatSCOR(ref)
        expect(printed).toBe(a.reference_formatted)
      })

      it('the account it settles on, and how it is printed', () => {
        const account = invoiceAccount(inv.ref_type as ReferenceType, company)
        expect(account).toBe(a.account)
        expect(account === null ? '—' : formatIban(account)).toBe(a.account_formatted)
      })

      it('the number, rendered from the company’s format', () => {
        expect(renderNumber(company.number_format, Number(inv.issue_date.slice(0, 4)), inv.seq)).toBe(inv.number)
      })
    })
  }
})
