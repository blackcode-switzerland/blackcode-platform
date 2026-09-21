// The seam: an invoice becomes a document through ONE function that validates
// and then renders — for `send`, `…/pdf` and `…/qr` alike.
//
// Until 2026-09-18 this file asserted the opposite: that the seam REFUSED with
// 501 `document_renderer_not_built`, because phase 3 was built before phase 2
// and a placeholder PDF would have mailed a client a bill with no payment part.
// Its header said "phase 2 rewrites this test", and this is that rewrite.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored
// ===========================================================================
//   - `validatedFields(src)` removed from `prepareInvoiceDocument`
//       → "refuses a bill the standard would reject" red, plus the send and
//         mark-sent cases in `send.integration.test.ts`. The renderer's own check
//         still threw, but as a bare `PaymentPartRefused` — no status, no code, no
//         suggestion — which is a 500 to a caller. Two layers, and only this one
//         speaks to a person
//   - …and the renderer's check removed as well → the same three, plus pdf.test.ts'
//         "throws rather than printing a slip with no account"
//   - the void check removed from `prepareQrPayload`  → "has no payload" red
//   - `const isVoid = false` in the renderer          → both void PDF cases red
//   - `serializeQrPayload(fields, '\r\n')` in the seam → "is, character for character, what the PDF encodes" red

import { describe, expect, it } from 'vitest'
import { NO_PAYMENT_PART, PAYMENT_PART_INVALID, prepareInvoiceDocument, prepareQrPayload } from './document'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { renderInvoiceDocument } from '@/lib/pdf/invoice'
import { sampleCompany, sampleInvoice } from '@/lib/pdf/fixtures'
import { qrBillFieldsFor, serializeQrPayload } from '@/lib/qr/payload'
import { ISSUER_FIELDS, issuerOf, type IssuerSource } from '@/lib/issuer'

const issuer: IssuerSource = issuerOf(null, {
  ...(Object.fromEntries(ISSUER_FIELDS.map((k) => [k, null])) as unknown as IssuerSource),
  ...sampleCompany,
  rounding: 'line_0_05',
})

const refusalOf = async (run: () => unknown): Promise<InvoiceRefused> => {
  try {
    await run()
  } catch (e) {
    return e as InvoiceRefused
  }
  throw new Error('expected a refusal, and the call succeeded')
}

describe('prepareInvoiceDocument', () => {
  it('returns a PDF for a valid bill (the positive half, first)', async () => {
    const pdf = await prepareInvoiceDocument({ invoice: sampleInvoice(), issuer })
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(10_000)
  })

  it('refuses a bill the standard would reject, with every problem in one 422', async () => {
    const e = await refusalOf(() =>
      prepareInvoiceDocument({ invoice: sampleInvoice(), issuer: { ...issuer, qr_iban: null, city: null } })
    )
    expect(e).toBeInstanceOf(InvoiceRefused)
    expect(e.status).toBe(422)
    expect(e.code).toBe(PAYMENT_PART_INVALID)
    // BOTH problems, not the first one.
    expect(e.message).toMatch(/2 problems/)
    expect(e.message).toContain('creditor_address_incomplete')
    expect(e.suggestion).toContain('bk billing invoice show 7')
  })

  it('renders a USD invoice — no payment part is not a problem', async () => {
    const usd = sampleInvoice({ currency: 'USD', ref_type: 'NON', ref_body: null })
    const pdf = await prepareInvoiceDocument({ invoice: usd, issuer: { ...issuer, iban: null, qr_iban: null } })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})

describe('prepareQrPayload', () => {
  it('is, character for character, what the PDF encodes', () => {
    const invoice = sampleInvoice()
    const payload = prepareQrPayload({ invoice, issuer })
    expect(payload).toBe(serializeQrPayload(qrBillFieldsFor(invoice, issuer)))
    expect(payload.split('\n')).toHaveLength(31)
    expect(payload.includes('\r')).toBe(false)
    expect(payload.endsWith('EPD')).toBe(true)
  })

  it('refuses the same record `…/pdf` refuses', async () => {
    const e = await refusalOf(() => prepareQrPayload({ invoice: sampleInvoice(), issuer: { ...issuer, qr_iban: null } }))
    expect([e.status, e.code]).toEqual([422, PAYMENT_PART_INVALID])
  })

  it('a currency the QR-bill does not carry has no payload, and says so rather than answering ""', async () => {
    const e = await refusalOf(() => prepareQrPayload({ invoice: sampleInvoice({ currency: 'USD', ref_type: 'NON', ref_body: null }), issuer }))
    expect([e.status, e.code]).toEqual([409, NO_PAYMENT_PART])
    expect(e.message).toContain('USD')
  })
})

describe('a void invoice', () => {
  const voided = sampleInvoice({
    status: 'void',
    void: { ts: '2026-09-18T10:00:00.000Z', by: 'a@b.ch', reason: { fr: 'Erreur', en: 'Mistake' } },
  })

  it('has no payload', async () => {
    const e = await refusalOf(() => prepareQrPayload({ invoice: voided, issuer }))
    expect([e.status, e.code]).toEqual([409, NO_PAYMENT_PART])
    expect(e.message).toContain('void')
  })

  it('…and its PDF carries no payment part and says ANNULÉE, while the same bill un-voided carries one', async () => {
    const live = await renderInvoiceDocument({ invoice: sampleInvoice(), company: issuer })
    const dead = await renderInvoiceDocument({ invoice: voided, company: issuer })
    const words = (r: typeof live) => r.log.flat().map((l) => l.text)
    // Positive first: the instrument can see a payment part when there is one.
    expect(live.hasPaymentPart).toBe(true)
    expect(words(live)).toContain('Récépissé')
    expect(words(live)).not.toContain('ANNULÉE')
    expect(dead.hasPaymentPart).toBe(false)
    expect(words(dead)).not.toContain('Récépissé')
    expect(words(dead)).toContain('ANNULÉE')
  })

  it('renders even when its issuer could no longer pass validation', async () => {
    // No slip is drawn, so nothing about the account can be wrong.
    const pdf = await prepareInvoiceDocument({ invoice: voided, issuer: { ...issuer, qr_iban: null, iban: null } })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
