// An invoice as a PDF: the A4 body in the DOCUMENT's language, and — for CHF
// and EUR — the QR-bill payment part at the foot of the last page.
//
// ===========================================================================
// THE SAME INVOICE PRODUCES THE SAME BYTES. THAT IS A REQUIREMENT.
// ===========================================================================
// Position P10: a sent PDF is not archived; it is regenerated on demand, and
// the sha256 of the bytes that were emailed is recorded on the invoice
// (`pdf_sha256`, phase 3). That only means something if regenerating yields the
// same bytes. So nothing derived from the run goes into the file:
//
//   - `CreationDate` and `ModDate` are the invoice's `issue_date`, not now
//   - `updateMetadata: false`, so pdf-lib writes no producer or date of its own
//   - the embedded fonts carry fixed names (pdf-lib's own suffix is from a
//     seeded generator, and a fixed name removes even that dependence)
//   - no document id, no timestamp, no random anything
//
// `pdf.test.ts` renders the same invoice in two separate PROCESSES and compares
// the hashes; a same-process comparison would pass on a memoised buffer.
//
// If this ever becomes unreachable, the honest move is to archive the PDF and
// revisit P10 — not to record a hash of something that cannot be reproduced.
//
// ===========================================================================
// IT REFUSES TO DRAW A PAYMENT PART THE STANDARD WOULD REJECT
// ===========================================================================
// The document seam validates before rendering, and so does this. A renderer
// that trusted its caller would, one refactor later, draw a slip with a blank
// IBAN — a perfectly formed page telling a client to pay nowhere.

import { PDFDocument, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { A4, Sheet, lineHeightMm, wrap, type LogEntry } from './sheet'
import { fontBytes } from './fonts'
import { printAddress, printAmount, printDate } from './format'
import { INVOICE_COPY, fill } from './copy'
import { drawPaymentPart, STRIP_TOP } from './payment-part'
import { qrBillFieldsFor, type QrCompany } from '@/lib/qr/payload'
import { hasPaymentPart, validateQrBill } from '@/lib/qr/validate'
import { formatQRR, formatSCOR, invoiceReference, ReferenceProblem } from '@/lib/qr/reference'
import type { Invoice } from '@/types'

/** The company columns the document prints. A `billing.company` row satisfies it. */
export interface PdfCompany extends QrCompany {
  name: string
  email: string | null
  uid: string | null
  vat_registered: boolean
  vat_number: string | null
  footer_fr: string | null
  footer_en: string | null
}

export interface RenderInput {
  invoice: Invoice
  company: PdfCompany
}

export interface RenderedInvoice {
  bytes: Uint8Array
  hasPaymentPart: boolean
  pageCount: number
  /** What was drawn, per page — for tests; custom-font text is unreadable in the file itself. */
  log: LogEntry[][]
}

export class PaymentPartRefused extends Error {
  constructor(public refusals: ReturnType<typeof validateQrBill>) {
    super(`the payment part would be invalid: ${refusals.map((r) => r.code).join(', ')}`)
  }
}

const MARGIN = 20
const RIGHT = A4.width - MARGIN
const BODY_BOTTOM_WITH_SLIP = STRIP_TOP - 12
const BODY_BOTTOM = A4.height - MARGIN

/** Columns of the line table: [x, width, right-aligned]. */
const COL = {
  description: [MARGIN, 76, false],
  qty: [98, 16, true],
  unit: [117, 15, false],
  price: [133, 23, true],
  vat: [157, 11, true],
  total: [168, 22, true],
} as const

export async function renderInvoiceDocument({ invoice, company }: RenderInput): Promise<RenderedInvoice> {
  const withSlip = hasPaymentPart(invoice.currency)
  const fields = withSlip ? qrBillFieldsFor(invoice, company) : null
  if (fields) {
    const refusals = validateQrBill(fields)
    if (refusals.length > 0) throw new PaymentPartRefused(refusals)
  }

  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  const bytes = fontBytes()
  const fonts = {
    regular: await doc.embedFont(bytes.regular, { subset: true, customName: 'LiberationSans' }),
    bold: await doc.embedFont(bytes.bold, { subset: true, customName: 'LiberationSans-Bold' }),
  }

  const issued = new Date(`${invoice.issue_date}T00:00:00Z`)
  doc.setCreationDate(issued)
  doc.setModificationDate(issued)
  doc.setTitle(invoice.number)
  doc.setLanguage(invoice.language)

  const copy = INVOICE_COPY[invoice.language] ?? INVOICE_COPY.en
  const bottom = withSlip ? BODY_BOTTOM_WITH_SLIP : BODY_BOTTOM
  const sheets: Sheet[] = []
  const newPage = (): Sheet => {
    const s = new Sheet(doc.addPage([(A4.width * 72) / 25.4, (A4.height * 72) / 25.4]), fonts.bold)
    sheets.push(s)
    return s
  }

  let sheet = newPage()
  const R = (size: number) => ({ font: fonts.regular, size })
  const B = (size: number) => ({ font: fonts.bold, size })

  // ── issuer, top left ───────────────────────────────────────────────────────
  let y = MARGIN
  y += sheet.text(company.name, MARGIN, y, B(12))
  const issuerLines = printAddress({
    name: company.legal_name !== company.name ? company.legal_name : '',
    street: company.street,
    building: company.building,
    postalCode: company.postal_code,
    town: company.city,
    country: company.country,
  }).filter(Boolean)
  for (const l of issuerLines) y += sheet.text(l, MARGIN, y, R(9))
  if (company.email) y += sheet.text(company.email, MARGIN, y, R(9))
  if (company.vat_registered && company.vat_number) {
    y += sheet.text(`${copy.vat_number} ${company.vat_number}`, MARGIN, y, R(9))
  }

  // ── client, in the right-hand window position ──────────────────────────────
  let cy = 50
  const client = invoice.client
  for (const l of printAddress({
    name: client.name,
    street: client.street,
    building: client.building,
    postalCode: client.postal_code,
    town: client.city,
    country: client.country,
  })) {
    cy += sheet.text(l, 118, cy, R(10))
  }

  // ── title and dates ────────────────────────────────────────────────────────
  y = 85
  y += sheet.text(`${copy.invoice} ${invoice.number}`, MARGIN, y, B(14)) + 2
  const meta: Array<[string, string]> = [[copy.issue_date, printDate(invoice.issue_date)]]
  if (invoice.due_date) meta.push([copy.due_date, printDate(invoice.due_date)])
  let ref: string | null = null
  try {
    ref = invoiceReference(invoice.ref_type, invoice.ref_body)
  } catch (e) {
    if (!(e instanceof ReferenceProblem)) throw e
  }
  if (ref) meta.push([copy.reference, invoice.ref_type === 'QRR' ? formatQRR(ref) : formatSCOR(ref)])
  for (const [label, value] of meta) {
    sheet.text(label, MARGIN, y, R(9))
    y += sheet.text(value, MARGIN + 28, y, R(9))
  }

  // ── the lines ──────────────────────────────────────────────────────────────
  const showVat = invoice.items.some((l) => l.vat_rate !== null)
  const cell = (s: Sheet, text: string, col: readonly [number, number, boolean], yy: number, bold = false) => {
    const [x, w, right] = col
    s.text(text, x, yy, { ...(bold ? B(8.5) : R(9)), ...(right ? { alignRightWithin: w } : {}) })
  }
  const header = (s: Sheet, yy: number): number => {
    cell(s, copy.description, COL.description, yy, true)
    cell(s, copy.qty, COL.qty, yy, true)
    cell(s, copy.unit, COL.unit, yy, true)
    cell(s, copy.unit_price, COL.price, yy, true)
    if (showVat) cell(s, copy.vat, COL.vat, yy, true)
    cell(s, copy.amount, COL.total, yy, true)
    const under = yy + lineHeightMm(8.5) + 0.8
    s.line(MARGIN, under, RIGHT, under, 0.5)
    return under + 1.5
  }

  y = header(sheet, y + 8)
  for (const line of invoice.items) {
    const desc = wrap(line.description, fonts.regular, 9, COL.description[1])
    const height = desc.length * lineHeightMm(9) + 1
    if (y + height > bottom) {
      sheet = newPage()
      y = header(sheet, MARGIN)
    }
    let dy = y
    for (const d of desc) dy += sheet.text(d, COL.description[0], dy, R(9))
    cell(sheet, qtyText(line.qty), COL.qty, y)
    if (line.unit) cell(sheet, line.unit, COL.unit, y)
    cell(sheet, printAmount(line.unit_price), COL.price, y)
    if (showVat) cell(sheet, line.vat_rate === null ? '–' : `${trimRate(line.vat_rate)}%`, COL.vat, y)
    cell(sheet, printAmount(line.line_total), COL.total, y)
    y += height
  }

  // ── totals ─────────────────────────────────────────────────────────────────
  const t = invoice.totals
  const totalRows: Array<[string, string, boolean]> = [[copy.subtotal, printAmount(t.subtotal), false]]
  for (const v of t.vat) {
    const label = invoice.prices_include_vat
      ? fill(copy.vat_included, { rate: trimRate(v.rate) })
      : fill(copy.vat_on, { rate: trimRate(v.rate), base: printAmount(v.base) })
    totalRows.push([label, printAmount(v.amount), false])
  }
  if (t.rounding !== '0.00') totalRows.push([copy.rounding, printAmount(t.rounding), false])
  totalRows.push([`${copy.total} ${invoice.currency}`, printAmount(t.total), true])

  const totalsHeight = totalRows.length * lineHeightMm(10) + 4
  if (y + totalsHeight > bottom) {
    sheet = newPage()
    y = MARGIN
  }
  sheet.line(118, y + 1, RIGHT, y + 1, 0.5)
  y += 3
  for (const [label, value, bold] of totalRows) {
    const style = bold ? B(10) : R(9)
    sheet.text(label, 118, y, style)
    y += sheet.text(value, 118, y, { ...style, alignRightWithin: RIGHT - 118 })
  }

  // ── footer ─────────────────────────────────────────────────────────────────
  const footer = invoice.language === 'fr' ? company.footer_fr ?? company.footer_en : company.footer_en ?? company.footer_fr
  if (footer) {
    const lines = wrap(footer, fonts.regular, 8, RIGHT - MARGIN)
    const fy = bottom - lines.length * lineHeightMm(8)
    if (fy > y + 4) {
      let yy = fy
      for (const l of lines) yy += sheet.text(l, MARGIN, yy, R(8))
    }
  }

  // ── page numbers, when there is more than one page ─────────────────────────
  if (sheets.length > 1) {
    sheets.forEach((s, i) => {
      s.text(fill(copy.page, { n: String(i + 1), of: String(sheets.length) }), MARGIN, 10, {
        ...R(8),
        alignRightWithin: RIGHT - MARGIN,
      })
    })
  }

  // ── the payment part, on the last page ─────────────────────────────────────
  if (fields) drawPaymentPart(sheet, fields, invoice.language, fonts)

  return {
    bytes: await doc.save({ updateFieldAppearances: false }),
    hasPaymentPart: withSlip,
    pageCount: sheets.length,
    log: sheets.map((s) => s.log),
  }
}

/** The bytes alone. What the document seam and the PDF route use. */
export async function renderInvoicePdf(input: RenderInput): Promise<Uint8Array> {
  return (await renderInvoiceDocument(input)).bytes
}

/** `12.000` → `12`, `0.500` → `0.5`: a quantity is printed as a person writes it. */
function qtyText(qty: string): string {
  return qty.includes('.') ? qty.replace(/0+$/, '').replace(/\.$/, '') : qty
}

/** `8.10` → `8.1`, `0.00` → `0`. */
function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate
}

export type { PDFFont }
