// THE ONE PLACE AN INVOICE BECOMES A DOCUMENT: validate, then render.
//
// ===========================================================================
// ONE FUNCTION, NEVER TWO
// ===========================================================================
// `send`, `GET …/pdf` and `GET …/qr` all come through here. Validation and
// rendering are one exported step each way — never a `validate()` and a
// `render()` a caller pairs up itself — because two functions can be called
// separately and one of them can be forgotten. A renderer that trusted its
// caller would, one refactor later, mail a slip with a blank IBAN.
//
// (`renderInvoiceDocument` validates again on its own. That is deliberate: it is
// the last line, and it throws a bare error rather than a refusal a person can
// act on. This file is where the refusal gets its words.)
//
// ===========================================================================
// THE COMPANY IT RENDERS FROM IS THE ISSUER, NOT THE COMPANY ROW
// ===========================================================================
// `DocumentSource.issuer` is what `lib/issuer.ts` resolved: the copy taken at
// issue, or — for a draft — the company as it is now. Nothing in this file or
// under `lib/pdf/` reads `billing.company`; `lib/issuer.test.ts` holds that.
//
// ===========================================================================
// HISTORY: THIS REFUSED UNTIL 2026-09-18
// ===========================================================================
// Phase 3 (send) was built before phase 2 (the PDF). Rather than mail a
// placeholder, this function refused with 501 `document_renderer_not_built` and
// named `mark-sent` as the recovery. That code no longer exists on any path; a
// client that switches on it can drop the branch.

import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { renderInvoicePdf } from '@/lib/pdf/invoice'
import { qrBillFieldsFor, serializeQrPayload } from '@/lib/qr/payload'
import { hasPaymentPart, validateQrBill, type QrRefusal } from '@/lib/qr/validate'
import type { IssuerSource } from '@/lib/issuer'
import type { Invoice } from '@/types'

export interface DocumentSource {
  invoice: Invoice
  /** From `getInvoiceDocumentSource` or `issuerSnapshot` — never a raw company row picked by hand. */
  issuer: IssuerSource
}

export const PAYMENT_PART_INVALID = 'payment_part_invalid'
export const NO_PAYMENT_PART = 'no_payment_part'

/**
 * Every problem in one refusal. 422: the request is fine and the RECORD is not
 * yet a bill the QR-bill standard accepts. One stable code, because the list of
 * underlying problems is open-ended and an agent needs one thing to switch on;
 * the individual codes are in the message and, structured, in the invoice's
 * `derived.problems`.
 */
function refuse(invoice: Invoice, problems: QrRefusal[]): never {
  const n = problems.length
  throw new InvoiceRefused(
    PAYMENT_PART_INVALID,
    `invoice ${invoice.number} would carry an invalid payment part (${n} problem${n === 1 ? '' : 's'}): ` +
      problems.map((p) => `[${p.code}] ${p.message}`).join('; '),
    n === 1
      ? problems[0].suggestion
      : `${problems[0].suggestion} — then \`bk billing invoice show ${invoice.seq}\` lists what is left`,
    422
  )
}

/** The payment-part fields, validated. Null when this invoice has no payment part. */
function validatedFields({ invoice, issuer }: DocumentSource) {
  if (!hasPaymentPart(invoice.currency) || invoice.status === 'void') return null
  const fields = qrBillFieldsFor(invoice, issuer)
  const problems = validateQrBill(fields)
  if (problems.length > 0) refuse(invoice, problems)
  return fields
}

/**
 * The PDF for an invoice, validated against the QR-bill standard first.
 *
 * Deterministic: the same invoice and issuer produce the same bytes (position
 * P10), which is what makes `pdf_sha256` on a sent invoice checkable later.
 */
export async function prepareInvoiceDocument(src: DocumentSource): Promise<Buffer> {
  validatedFields(src)
  return Buffer.from(await renderInvoicePdf({ invoice: src.invoice, company: src.issuer }))
}

/**
 * The Swiss QR Code payload, exactly as the PDF encodes it.
 *
 * Refuses 409 where there is no payment part to have a payload — a currency the
 * standard does not carry, or a void invoice — rather than answering with an
 * empty string, which pasted into a validator reads as "this app produced
 * nothing" instead of "this bill has no slip, by design".
 */
export function prepareQrPayload(src: DocumentSource): string {
  const { invoice } = src
  if (invoice.status === 'void') {
    throw new InvoiceRefused(
      NO_PAYMENT_PART,
      `invoice ${invoice.number} is void: its PDF carries no payment part, so there is no payload`,
      'a cancelled bill must not be payable; create a new invoice instead',
      409
    )
  }
  const fields = validatedFields(src)
  if (!fields) {
    throw new InvoiceRefused(
      NO_PAYMENT_PART,
      `invoice ${invoice.number} is in ${invoice.currency}; a QR-bill payment part exists for CHF and EUR only, so its PDF has none`,
      `bk billing invoice pdf ${invoice.seq} still renders the invoice itself`,
      409
    )
  }
  return serializeQrPayload(fields)
}
