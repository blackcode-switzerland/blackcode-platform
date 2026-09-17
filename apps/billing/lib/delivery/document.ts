// THE SEAM PHASE 2 FILLS: an invoice → the PDF bytes that go out.
//
// ===========================================================================
// WHY PHASE 3 SHIPS WITH THIS REFUSING
// ===========================================================================
// Phase 3 (lifecycle and delivery) was built before phase 2 (references, QR
// payload, PDF). `send` needs two things phase 2 owns:
//
//   1. the PAYLOAD VALIDATION — "a bill the standard would refuse must not leave
//      the building" (lib/qr/validate.ts: the combination matrix, the address
//      widths, the character set, the 140-character budget);
//   2. the RENDER — the A4 invoice with its payment part (lib/pdf/).
//
// Neither is written, and there were two ways to stand in for them. A
// placeholder PDF would have made `send` "work" by mailing a real client a
// document with no payment part and no validated reference — a second
// implementation of the numbers on a legal document, which lib/db/queries/
// invoices.ts's header refuses by name. A silently-passing validator would be
// CLAUDE.md's "a skipped check reports success" in its purest form.
//
// So this function is the ONE place both arrive, and until they do it refuses —
// with a code an agent can switch on, a sentence naming what is missing, and the
// recovery that works today (`mark-sent`). `send` reaches it after every check it
// can make itself and BEFORE anything is written or mailed, so the refusal
// leaves no trace.
//
// ===========================================================================
// WHAT PHASE 2 PUTS HERE
// ===========================================================================
// Validate, then render, in this one function — never two exported functions,
// because two can be called separately and one of them can be forgotten.
//
//     export async function prepareInvoiceDocument(src) {
//       const refusal = validatePaymentPart(src)   // lib/qr/validate.ts
//       if (refusal) throw new InvoiceRefused(refusal.code, refusal.message, refusal.suggestion, 422)
//       return renderInvoicePdf(src)               // lib/pdf/invoice.ts — deterministic bytes (P10)
//     }
//
// `lib/delivery/document.test.ts` asserts the refusal today, and is the test
// phase 2 rewrites: its assertion flips from "refuses with
// document_renderer_not_built" to "returns bytes starting %PDF-".

import { InvoiceRefused } from '@/lib/db/queries/invoices'
import type { Invoice } from '@/types'

/** What the renderer needs. The company is the issuer, as a row, because the payment part prints its account and address. */
export interface DocumentSource {
  invoice: Invoice
  company: {
    slug: string
    name: string
    legal_name: string
    street: string | null
    building: string | null
    postal_code: string | null
    city: string | null
    country: string | null
    iban: string | null
    qr_iban: string | null
    uid: string | null
    vat_number: string | null
  }
}

export const DOCUMENT_RENDERER_NOT_BUILT = 'document_renderer_not_built'

/**
 * The PDF for `src.invoice`, validated against the QR-bill standard first.
 *
 * **Refuses until phase 2 lands** — see this file's header. Status 501: the
 * request is well-formed and this build does not implement what it needs.
 */
export async function prepareInvoiceDocument(src: DocumentSource): Promise<Buffer> {
  throw new InvoiceRefused(
    DOCUMENT_RENDERER_NOT_BUILT,
    `invoice ${src.invoice.number} cannot be emailed yet: this build has no invoice PDF renderer ` +
      'or QR-bill validator (b/billing phase 2), and a bill is never mailed without both',
    `deliver it yourself and record that with \`bk billing invoice mark-sent ${src.invoice.seq}\``,
    501
  )
}
