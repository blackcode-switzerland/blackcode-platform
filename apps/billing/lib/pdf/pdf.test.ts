// The rendered PDF, MEASURED — from the saved file, not from the input.
//
// ===========================================================================
// WHY IT PARSES THE FILE
// ===========================================================================
// Every size in the QR-bill standard is a size on paper: 210 × 297 mm, a
// 46 × 46 mm code, a 62 mm receipt beside a 148 mm payment part, blank fields at
// mandated sizes. A test that asserted the CONSTANTS this renderer was given
// would pass on a renderer that ignored them — and "the geometry is wrong" is
// invisible on screen at 40% zoom and expensive at a bank counter.
//
// So the drawing writes rectangles and lines as raw operators with absolute
// coordinates (see `sheet.ts`), and this file reads them back out of the saved
// bytes: `x y w h re` inside `/Tag BMC … EMC`, converted from points back to
// millimetres. What cannot be read back is text in an embedded subset font, so
// the WORDS are asserted through the draw log instead, and the payment part's
// end-to-end correctness is the scripted QR decode recorded in
// apps/billing/docs/backend.md.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored, 16/16 green after
// ===========================================================================
//   - the QR module size computed from 45 mm → 1 failed: the 46 × 46 measurement
//   - `setCreationDate(new Date())` → 1 failed: the two-process byte comparison
//   - the receipt printing the `additional_information` heading → 2 failed:
//     "never on the receipt" and "no heading whose value is absent"
//   - `hasPaymentPart` forced true → 2 failed: both USD cases. They went red
//     because validation then REFUSED the USD bill, not because a slip was
//     drawn — the refusal is what stands between a USD invoice and a slip.

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFRef } from 'pdf-lib'
import { renderInvoiceDocument, PaymentPartRefused, type PdfCompany } from './invoice'
import { sampleCompany, sampleInvoice } from './fixtures'
import { A4, PT_PER_MM, Sheet } from './sheet'
import { drawPaymentPart, BLANK, QR, STRIP_TOP, PAYMENT_STRIP } from './payment-part'
import { qrBillFieldsFor } from '@/lib/qr/payload'
import type { Invoice } from '@/types'

// ---------------------------------------------------------------------------
// Reading geometry back out of a saved PDF
// ---------------------------------------------------------------------------

interface Shape {
  tag: string | null
  /** mm, from the TOP-left of the page. */
  x: number
  y: number
  w: number
  h: number
}

const NUM = String.raw`-?\d+(?:\.\d+)?`

async function shapesOf(bytes: Uint8Array, pageIndex = -1): Promise<Shape[]> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(pageIndex < 0 ? doc.getPageCount() + pageIndex : pageIndex)
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r as PDFRef)) : [contents]
  const content = streams
    .map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1'))
    .join('\n')

  const shapes: Shape[] = []
  const stack: string[] = []
  const re = new RegExp(
    String.raw`/(\w+)\s+BMC|(EMC)|(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+re|(${NUM})\s+(${NUM})\s+m\s+(${NUM})\s+(${NUM})\s+l`,
    'g'
  )
  const toMm = (pt: string) => Number(pt) / PT_PER_MM
  for (const m of content.matchAll(re)) {
    if (m[1]) stack.push(m[1])
    else if (m[2]) stack.pop()
    else if (m[3] !== undefined) {
      const [x, yBottom, w, h] = [toMm(m[3]), toMm(m[4]), toMm(m[5]), toMm(m[6])]
      shapes.push({ tag: stack.at(-1) ?? null, x, y: A4.height - yBottom - h, w, h })
    } else {
      const [x1, y1, x2, y2] = [toMm(m[7]), toMm(m[8]), toMm(m[9]), toMm(m[10])]
      shapes.push({
        tag: stack.at(-1) ?? null,
        x: Math.min(x1, x2),
        y: A4.height - Math.max(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      })
    }
  }
  return shapes
}

function boxOf(shapes: Shape[], tag: string): { x: number; y: number; w: number; h: number } | null {
  const own = shapes.filter((s) => s.tag === tag)
  if (own.length === 0) return null
  const x = Math.min(...own.map((s) => s.x))
  const y = Math.min(...own.map((s) => s.y))
  return {
    x,
    y,
    w: Math.max(...own.map((s) => s.x + s.w)) - x,
    h: Math.max(...own.map((s) => s.y + s.h)) - y,
  }
}

const texts = (doc: Awaited<ReturnType<typeof renderInvoiceDocument>>, page = -1): string[] => {
  const log = doc.log.at(page)!
  return log.filter((e) => e.kind === 'text').map((e) => e.text!)
}

// ---------------------------------------------------------------------------

describe('the page and the payment part, measured from the saved file', () => {
  it('is A4: 210 × 297 mm', async () => {
    const { bytes } = await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany })
    const doc = await PDFDocument.load(bytes)
    const { width, height } = doc.getPage(0).getSize()
    expect(width / PT_PER_MM).toBeCloseTo(210, 2)
    expect(height / PT_PER_MM).toBeCloseTo(297, 2)
  })

  it('draws the QR code at exactly 46 × 46 mm, 17 mm below the strip’s top edge', async () => {
    const { bytes } = await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany })
    const box = boxOf(await shapesOf(bytes), 'QRCode')!
    expect(box.w).toBeCloseTo(QR.size, 2)
    expect(box.h).toBeCloseTo(QR.size, 2)
    expect(box.x).toBeCloseTo(QR.x, 2)
    expect(box.y).toBeCloseTo(STRIP_TOP + QR.y, 2)
  })

  it('overlays the Swiss cross at 7 × 7 mm, centred on the code', async () => {
    const { bytes } = await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany })
    const box = boxOf(await shapesOf(bytes), 'SwissCross')!
    expect(box.w).toBeCloseTo(QR.cross, 2)
    expect(box.h).toBeCloseTo(QR.cross, 2)
    expect(box.x + box.w / 2).toBeCloseTo(QR.x + QR.size / 2, 2)
    expect(box.y + box.h / 2).toBeCloseTo(STRIP_TOP + QR.y + QR.size / 2, 2)
  })

  it('splits the strip into a 62 mm receipt and a 148 mm payment part, 105 mm tall', async () => {
    const { bytes } = await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany })
    const shapes = await shapesOf(bytes)
    const lines = shapes.filter((s) => s.tag === 'Separation')
    const horizontal = lines.find((s) => s.h < 0.01)!
    const vertical = lines.find((s) => s.w < 0.01)!
    expect(horizontal.y).toBeCloseTo(STRIP_TOP, 2)
    expect(horizontal.w).toBeCloseTo(A4.width, 2)
    expect(vertical.x).toBeCloseTo(PAYMENT_STRIP.receiptWidth, 2)
    expect(vertical.y).toBeCloseTo(STRIP_TOP, 2)
    expect(vertical.h).toBeCloseTo(PAYMENT_STRIP.height, 2)
    // The two halves, from those two lines: 62 + 148 = 210.
    expect(A4.width - vertical.x).toBeCloseTo(PAYMENT_STRIP.paymentWidth, 2)
  })

  it('draws the blank “payable by” fields at their mandated sizes when the debtor is unknown', async () => {
    const invoice = sampleInvoice({
      client: { name: 'Junod SA', street: null, building: null, postal_code: null, city: null, country: null },
    })
    const shapes = await shapesOf((await renderInvoiceDocument({ invoice, company: sampleCompany })).bytes)
    const payment = boxOf(shapes, 'BlankPayableByPayment')!
    const receipt = boxOf(shapes, 'BlankPayableByReceipt')!
    // Millimetres measured back out of points: compare to the hundredth, not bit
    // for bit — 40 mm comes back as 40.000000000000014.
    expect(payment.w).toBeCloseTo(BLANK.payableByPayment.w, 2)
    expect(payment.h).toBeCloseTo(BLANK.payableByPayment.h, 2)
    expect(receipt.w).toBeCloseTo(BLANK.payableByReceipt.w, 2)
    expect(receipt.h).toBeCloseTo(BLANK.payableByReceipt.h, 2)
  })

  it('draws the blank amount fields at their mandated sizes when there is no amount', async () => {
    // Every invoice this app issues carries an amount, so this case is reached
    // by drawing the part directly. The standard requires the field, and a
    // renderer that cannot draw it would be found out by the first donation
    // slip or notification bill.
    const doc = await PDFDocument.create({ updateMetadata: false })
    const { default: fontkit } = await import('@pdf-lib/fontkit')
    doc.registerFontkit(fontkit)
    const { fontBytes } = await import('./fonts')
    const b = fontBytes()
    const fonts = {
      regular: await doc.embedFont(b.regular, { subset: true, customName: 'L' }),
      bold: await doc.embedFont(b.bold, { subset: true, customName: 'LB' }),
    }
    const page = doc.addPage([A4.width * PT_PER_MM, A4.height * PT_PER_MM])
    const fields = qrBillFieldsFor(sampleInvoice(), sampleCompany)
    drawPaymentPart(new Sheet(page, fonts.bold), { ...fields, amount: null }, 'fr', fonts)
    const shapes = await shapesOf(await doc.save({ updateFieldAppearances: false }))
    const payment = boxOf(shapes, 'BlankAmountPayment')!
    const receipt = boxOf(shapes, 'BlankAmountReceipt')!
    expect(payment.w).toBeCloseTo(BLANK.amountPayment.w, 2)
    expect(payment.h).toBeCloseTo(BLANK.amountPayment.h, 2)
    expect(receipt.w).toBeCloseTo(BLANK.amountReceipt.w, 2)
    expect(receipt.h).toBeCloseTo(BLANK.amountReceipt.h, 2)
  })

  it('renders a USD invoice as a body with NO payment part', async () => {
    const invoice = sampleInvoice({ currency: 'USD', ref_type: 'NON', ref_body: null })
    const out = await renderInvoiceDocument({ invoice, company: sampleCompany })
    expect(out.hasPaymentPart).toBe(false)
    const shapes = await shapesOf(out.bytes)
    expect(boxOf(shapes, 'QRCode')).toBeNull()
    expect(boxOf(shapes, 'Separation')).toBeNull()
    expect(texts(out)).not.toContain('Section paiement')
    // The body is still a complete invoice.
    expect(texts(out)).toContain('Facture BC-2026-0007')
  })
})

describe('the words on the page', () => {
  it('prints the payment part’s headings in the DOCUMENT’s language', async () => {
    const fr = texts(await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany }))
    expect(fr).toEqual(
      expect.arrayContaining([
        'Récépissé',
        'Section paiement',
        'Compte / Payable à',
        'Référence',
        'Informations supplémentaires',
        'Payable par',
        'Monnaie',
        'Montant',
        'Point de dépôt',
        'A détacher avant le versement',
      ])
    )
    const de = texts(await renderInvoiceDocument({ invoice: sampleInvoice({ language: 'de' }), company: sampleCompany }))
    expect(de).toEqual(expect.arrayContaining(['Empfangsschein', 'Zahlteil', 'Konto / Zahlbar an', 'Rechnung BC-2026-0007']))
    expect(de).not.toContain('Récépissé')
  })

  it('never prints the additional information on the receipt (§3.6)', async () => {
    const out = await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany })
    const log = out.log.at(-1)!.filter((e) => e.kind === 'text')
    const headings = log.filter((e) => e.text === 'Informations supplémentaires')
    expect(headings).toHaveLength(1)
    // x = 118 is the payment part's information column; the receipt is x < 62.
    expect(headings[0].x).toBeGreaterThan(62)
  })

  it('does not print a heading whose value is absent (§3.5.4)', async () => {
    const noRef = sampleInvoice({ ref_type: 'NON', ref_body: null, message: null })
    const out = await renderInvoiceDocument({ invoice: noRef, company: { ...sampleCompany, qr_iban: null } })
    expect(texts(out)).not.toContain('Référence')
    expect(texts(out)).not.toContain('Informations supplémentaires')
    expect(texts(out)).toContain('Compte / Payable à')
  })

  it('prints amounts with a space as the thousands separator, and the VAT states apart', async () => {
    const t = texts(await renderInvoiceDocument({ invoice: sampleInvoice(), company: sampleCompany }))
    expect(t).toContain('16 455.00')
    expect(t).toContain('TVA 8.1 % sur 15 000.00')
    expect(t).toContain('8.1%') // the taxable line
    expect(t).toContain('–') // the exempt line: not "0%"
  })

  it('prints “dont TVA” when the prices already contain it', async () => {
    const inclusive = sampleInvoice({
      prices_include_vat: true,
      totals: { subtotal: '16455.00', vat: [{ rate: '8.10', base: '15000.00', amount: '1123.03' }], vat_total: '1123.03', rounding: '0.00', total: '16455.00' },
    })
    expect(texts(await renderInvoiceDocument({ invoice: inclusive, company: sampleCompany }))).toContain('dont TVA 8.1 %')
  })
})

describe('byte stability (position P10)', () => {
  it('renders the same invoice to the same bytes in two separate processes', () => {
    const run = () => execFileSync('npx', ['tsx', 'lib/pdf/render-hash.ts'], { encoding: 'utf8' }).trim()
    const first = run()
    const second = run()
    expect(first).toMatch(/^[0-9a-f]{64} \d+$/)
    expect(second).toBe(first)
  }, 120_000)
})

describe('it refuses to draw a payment part the standard would reject', () => {
  it('throws rather than printing a slip with no account', async () => {
    const company: PdfCompany = { ...sampleCompany, qr_iban: null }
    await expect(renderInvoiceDocument({ invoice: sampleInvoice(), company })).rejects.toBeInstanceOf(PaymentPartRefused)
  })

  it('still renders the body for a currency with no payment part', async () => {
    const invoice: Invoice = sampleInvoice({ currency: 'GBP', ref_type: 'NON', ref_body: null })
    const out = await renderInvoiceDocument({ invoice, company: { ...sampleCompany, qr_iban: null } })
    expect(out.hasPaymentPart).toBe(false)
    expect(out.pageCount).toBe(1)
  })
})

describe('long invoices', () => {
  it('continues onto a second page, numbers the pages, and puts the slip on the last one', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      line_no: i + 1,
      description: `Prestation ${i + 1} — description assez longue pour occuper toute la largeur de la colonne`,
      qty: '1.000',
      unit: 'pcs',
      unit_price: '100.00',
      vat_rate: '8.10',
      line_total: '100.00',
    }))
    const out = await renderInvoiceDocument({ invoice: sampleInvoice({ items }), company: sampleCompany })
    expect(out.pageCount).toBeGreaterThan(1)
    expect(texts(out, 0)).toContain(`Page 1 / ${out.pageCount}`)
    // The payment part is on the LAST page and nowhere else.
    expect(texts(out, 0)).not.toContain('Section paiement')
    expect(texts(out, -1)).toContain('Section paiement')
  })
})
