// The payment part and receipt: the bottom 105 mm of an A4 invoice.
//
// ===========================================================================
// WHERE EVERY NUMBER COMES FROM
// ===========================================================================
// Sizes the standard states in text (v2.4 §3, §6), and therefore asserted by
// `pdf.test.ts` against the SAVED file:
//
//   receipt 62 × 105 mm, left · payment part 148 × 105 mm, right · together
//   210 × 105 at the foot of the page · QR code 46 × 46 mm · Swiss cross 7 × 7
//   · 5 mm quiet zone and 5 mm between sections · blank amount field 40 × 15
//   (payment part) and 30 × 10 (receipt) · blank payable-by field 65 × 25 and
//   52 × 20 · 0.75 pt lines · title 11 pt bold · payment part headings 8 pt bold,
//   values 10 pt · receipt headings 6 pt bold, values 8 pt
//
// Positions WITHIN the sections are drawn in the standard's figures and in the
// SIX Style Guide, not stated in text. They follow `swissqrbill`'s renderer
// (MIT), which implements that Style Guide and is used as this app's test oracle
// for the payload: title at 5 mm, receipt information from 12 mm, QR code at
// (67, 17), amount sections at 68 mm, acceptance point at 82 mm, information
// column at 118 mm. The printed-and-gridded check against the Style Guide's
// grid sheet is a manual step (qr-bill.md §8), not something a test can do.
//
// ── WHAT IS NEVER PRINTED ──────────────────────────────────────────────────
// A heading whose value is absent (§3.5.4). The additional information on the
// receipt (§3.6). The header elements of the payload (§7.2).
//
// ── AND THE REFERENCE, DELIBERATELY, SINCE 2026-09-25 ─────────────────────
// Neither the receipt nor the payment part prints the reference, on any bill.
// A product decision, and a departure from the standard that should be read as
// one: v2.4 §3.5.4 prints the "Reference" heading and value whenever the bill
// carries a reference, so a SCOR or QRR slip without it is not a conforming
// layout, and the SIX validation portal may say so.
//
// What still carries it: the QR CODE (the payload is unchanged — a banking app
// reads the code, not the print, so payments still arrive referenced and
// matchable) and the invoice body's own meta block above the strip. A bill
// that must pass layout validation should be issued with `ref_type NON`, which
// has no reference to print and is fully conforming.

import type { PDFFont } from 'pdf-lib'
import { Sheet, lineHeightMm, wrap, A4 } from './sheet'
import { printAddress, printAmount } from './format'
import { qrMatrix } from './qr-matrix'
import { formatIban } from '@/lib/qr/reference'
import { serializeQrPayload, type QrBillFields } from '@/lib/qr/payload'
import { qrLabels, type QrLanguage } from '@/lib/qr/labels'

export const PAYMENT_STRIP = { height: 105, receiptWidth: 62, paymentWidth: 148 } as const
/** The strip's top edge, in mm from the top of an A4 page. */
export const STRIP_TOP = A4.height - PAYMENT_STRIP.height

export const QR = { x: 67, y: 17, size: 46, cross: 7 } as const
export const BLANK = {
  amountPayment: { x: 78, y: 72, w: 40, h: 15 },
  amountReceipt: { x: 27, y: 71, w: 30, h: 10 },
  payableByPayment: { w: 65, h: 25 },
  payableByReceipt: { w: 52, h: 20 },
} as const
const CORNER = 3 // mm, the length of each corner mark's arms
const LINE_PT = 0.75

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

/** A blank field drawn as its four corner marks (§3.5.3, §3.5.4). */
function blankField(sheet: Sheet, tag: string, x: number, y: number, w: number, h: number): void {
  sheet.marked(tag, () => {
    sheet.line(x, y, x + CORNER, y, LINE_PT)
    sheet.line(x, y, x, y + CORNER, LINE_PT)
    sheet.line(x + w - CORNER, y, x + w, y, LINE_PT)
    sheet.line(x + w, y, x + w, y + CORNER, LINE_PT)
    sheet.line(x, y + h, x + CORNER, y + h, LINE_PT)
    sheet.line(x, y + h - CORNER, x, y + h, LINE_PT)
    sheet.line(x + w - CORNER, y + h, x + w, y + h, LINE_PT)
    sheet.line(x + w, y + h - CORNER, x + w, y + h, LINE_PT)
  })
}

/**
 * Draw the payment part at the foot of `sheet`'s page. The fields must already
 * have passed `validateQrBill`; this function lays out, it does not judge.
 */
export function drawPaymentPart(sheet: Sheet, fields: QrBillFields, language: QrLanguage, fonts: Fonts): void {
  const L = qrLabels(language)
  const T = STRIP_TOP

  // ── separation (§3.7): a dashed line and the hint, ABOVE the line, outside
  // the payment part ─────────────────────────────────────────────────────────
  sheet.marked('Separation', () => {
    sheet.line(0, T, A4.width, T, LINE_PT, true)
    sheet.line(PAYMENT_STRIP.receiptWidth, T, PAYMENT_STRIP.receiptWidth, A4.height, LINE_PT, true)
  })
  const hint = L.separate_before_paying_in
  const hintWidth = fonts.regular.widthOfTextAtSize(hint, 7) / (72 / 25.4)
  sheet.text(hint, (A4.width - hintWidth) / 2, T - 3.5, { font: fonts.regular, size: 7 })

  // ── receipt ────────────────────────────────────────────────────────────────
  const rx = 5
  const rw = 52
  sheet.text(L.receipt, rx, T + 5, { font: fonts.bold, size: 11 })

  let y = T + 12
  const receiptHeading = (s: string) => {
    y += sheet.text(s, rx, y, { font: fonts.bold, size: 6 })
  }
  const receiptValue = (s: string) => {
    for (const line of wrap(s, fonts.regular, 8, rw)) y += sheet.text(line, rx, y, { font: fonts.regular, size: 8 })
  }
  const gapReceipt = () => {
    y += lineHeightMm(9)
  }

  receiptHeading(L.account_payable_to)
  receiptValue(formatIban(fields.account))
  for (const l of printAddress(fields.creditor)) receiptValue(l)
  gapReceipt()
  if (fields.debtor) {
    receiptHeading(L.payable_by)
    for (const l of printAddress(fields.debtor)) receiptValue(l)
  } else {
    receiptHeading(L.payable_by_name_address)
    blankField(sheet, 'BlankPayableByReceipt', rx, y + 1, BLANK.payableByReceipt.w, BLANK.payableByReceipt.h)
  }

  sheet.text(L.currency, rx, T + 68, { font: fonts.bold, size: 6 })
  sheet.text(L.amount, BLANK.amountReceipt.x, T + 68, { font: fonts.bold, size: 6 })
  sheet.text(fields.currency, rx, T + 71, { font: fonts.regular, size: 8 })
  if (fields.amount) {
    sheet.text(printAmount(fields.amount), BLANK.amountReceipt.x, T + 71, { font: fonts.regular, size: 8 })
  } else {
    const b = BLANK.amountReceipt
    blankField(sheet, 'BlankAmountReceipt', b.x, T + b.y, b.w, b.h)
  }

  sheet.text(L.acceptance_point, rx, T + 82, { font: fonts.bold, size: 6, alignRightWithin: rw })

  // ── payment part ───────────────────────────────────────────────────────────
  sheet.text(L.payment_part, QR.x, T + 5, { font: fonts.bold, size: 11 })

  // The QR code: the module matrix drawn as rectangles, scaled so the SYMBOL
  // (without its quiet zone) is exactly 46 × 46 mm whatever its version (§6.4).
  // Each row's run of dark modules is one rectangle — fewer operators, same
  // geometry.
  const matrix = qrMatrix(serializeQrPayload(fields))
  const moduleMm = QR.size / matrix.size
  sheet.marked('QRCode', () => {
    for (let row = 0; row < matrix.size; row++) {
      let col = 0
      while (col < matrix.size) {
        if (!matrix.isDark(row, col)) {
          col++
          continue
        }
        const start = col
        while (col < matrix.size && matrix.isDark(row, col)) col++
        sheet.fill(QR.x + start * moduleMm, T + QR.y + row * moduleMm, (col - start) * moduleMm, moduleMm)
      }
    }
  })

  // The Swiss cross (§6.4.2): 7 × 7 mm, centred. A white field, a black square,
  // a white cross — proportions as the SIX logo file draws them.
  sheet.marked('SwissCross', () => {
    const c = { x: QR.x + QR.size / 2, y: T + QR.y + QR.size / 2 }
    sheet.fill(c.x - 3.5, c.y - 3.5, 7, 7, true)
    sheet.fill(c.x - 3, c.y - 3, 6, 6)
    const arm = 3.89
    const bar = 1.17
    sheet.fill(c.x - bar / 2, c.y - arm / 2, bar, arm, true)
    sheet.fill(c.x - arm / 2, c.y - bar / 2, arm, bar, true)
  })

  sheet.text(L.currency, QR.x, T + 68, { font: fonts.bold, size: 8 })
  sheet.text(fields.currency, QR.x, T + 72, { font: fonts.regular, size: 10 })
  if (fields.amount) {
    sheet.text(L.amount, 89, T + 68, { font: fonts.bold, size: 8 })
    sheet.text(printAmount(fields.amount), 89, T + 72, { font: fonts.regular, size: 10 })
  } else {
    const b = BLANK.amountPayment
    sheet.text(L.amount, b.x, T + 68, { font: fonts.bold, size: 8 })
    blankField(sheet, 'BlankAmountPayment', b.x, T + b.y, b.w, b.h)
  }

  // Information, from x = 118.
  const ix = 118
  const iw = 87
  y = T + 5
  const heading = (s: string) => {
    y += sheet.text(s, ix, y, { font: fonts.bold, size: 8 })
  }
  const value = (s: string, maxLines = Infinity) => {
    const lines = wrap(s, fonts.regular, 10, iw)
    const shown = lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}...`] : lines
    for (const line of shown) y += sheet.text(line, ix, y, { font: fonts.regular, size: 10 })
  }
  const gap = () => {
    y += lineHeightMm(9)
  }

  heading(L.account_payable_to)
  value(formatIban(fields.account))
  for (const l of printAddress(fields.creditor)) value(l)
  gap()
  if (fields.unstructuredMessage) {
    // Printed on the payment part and never on the receipt (§3.6). Truncation is
    // marked with "..." (§3.5.4); v1 carries no billing information, so no
    // personal data can be what is cut.
    heading(L.additional_information)
    value(fields.unstructuredMessage, 3)
    gap()
  }
  if (fields.debtor) {
    heading(L.payable_by)
    for (const l of printAddress(fields.debtor)) value(l)
  } else {
    heading(L.payable_by_name_address)
    const b = BLANK.payableByPayment
    blankField(sheet, 'BlankPayableByPayment', ix, y + 1, b.w, b.h)
  }
}
