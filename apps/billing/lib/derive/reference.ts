// The reference BODY — the digits, without their check digit.
//
// ===========================================================================
// WHAT THIS IS, AND WHAT PHASE 2 ADDS
// ===========================================================================
// A Swiss payment reference has two halves. This file produces the BODY; phase 2
// (`lib/qr/reference.ts`) computes the CHECK DIGIT over it and formats both for
// the payment part.
//
// The split is not arbitrary. The body is STORED, in `billing.invoice.ref_body`,
// because it encodes which invoice the payment belongs to and a bank quotes it
// back on the statement. The check digit is DERIVED on every render (invariant
// I6), because storing it would be storing a value that can disagree with the
// body it checks.
//
// ===========================================================================
// THE QRR SCHEME IS POSITION P11 AND IS NOT SETTLED
// ===========================================================================
// 26 digits, laid out as the plan specifies:
//
//     00000000000000  CCCC  SSSSSSSS
//     14 zeros        company #  invoice seq_no
//
// **This must be agreed with the bank before the first real QRR bill.** Banks
// commonly want the leading digits as a grouping key — a customer number, a
// mandate, a division — and changing the scheme after bills are out means two
// schemes in the wild, each valid, with a reconciliation that has to know which
// era a payment came from.
//
// So the layout lives HERE, in one function, with that warning. Changing it is
// editing one expression; discovering it needs changing after a thousand
// invoices is not.
//
// ── WHY IT IS DERIVED AT CREATE TIME AND NOT AT RENDER TIME ────────────────
// Because the invoice's own `seq_no` is in it, and `seq_no` is frozen by G1 the
// moment the row exists. A reference derived at render time would be identical
// forever anyway — and it would be re-derived by every surface, which is two
// implementations of a number a bank matches payments against.
//
// It was also the thing that made `POST /api/workspaces/{ws}/invoices` fail its
// first real HTTP call on 2026-09-17: `ref_body` was left null while the company
// default was QRR, and `invoice_qrr_matrix_check` refused the insert. The CHECK
// was right and the code had no reference generator at all. Found by curl, not
// by a unit test — the routes compiled and the parity guard was green.

import type { ReferenceType } from '@/types'

/** 14 zeros, then the company #number in 4, then the invoice seq_no in 8. */
const QRR_PAD = 14
const QRR_COMPANY_DIGITS = 4
const QRR_SEQ_DIGITS = 8

/**
 * The QRR body: exactly 26 digits, which `invoice_qrr_matrix_check` enforces.
 *
 * Throws rather than truncating when a company or an invoice outgrows its field.
 * A truncated reference is a reference that collides with an older invoice's —
 * so a payment would reconcile against the wrong bill, which is worse than a
 * refused create. At these widths that is 9,999 companies and 99,999,999
 * invoices per company; the throw is for the day somebody scripts a migration.
 */
export function qrrBody(companySeq: number, seqNo: number): string {
  const c = String(companySeq)
  const s = String(seqNo)
  if (c.length > QRR_COMPANY_DIGITS) {
    throw new Error(
      `company #${companySeq} does not fit the ${QRR_COMPANY_DIGITS} digits the QRR scheme ` +
        'reserves for it. Widening the field changes the reference scheme, which must be agreed ' +
        'with the bank (position P11) — truncating it would make this reference collide with ' +
        'another company\u2019s.'
    )
  }
  if (s.length > QRR_SEQ_DIGITS) {
    throw new Error(
      `invoice number ${seqNo} does not fit the ${QRR_SEQ_DIGITS} digits the QRR scheme reserves ` +
        'for it. See the note on the company field above; the same reasoning applies.'
    )
  }
  return (
    '0'.repeat(QRR_PAD) + c.padStart(QRR_COMPANY_DIGITS, '0') + s.padStart(QRR_SEQ_DIGITS, '0')
  )
}

/**
 * The reference body for a new invoice, or null when the type carries none.
 *
 * A caller-supplied body wins, and that is deliberate: a bank or a client may
 * dictate a creditor reference, and phase 5's history import carries references
 * that already exist and must not be regenerated.
 *
 * ── SCOR USES THE INVOICE NUMBER ───────────────────────────────────────────
 * ISO 11649 permits up to 25 alphanumeric characters, and the invoice number is
 * what a client will quote when they call about a payment. The alternative — the
 * same digit string as QRR — would be a reference nobody could read back over
 * the phone, for no gain: SCOR has no digits-only constraint.
 *
 * Non-alphanumerics are stripped, because the standard's character set for the
 * reference is narrower than the one the rest of the payload permits, and a
 * number format containing a hyphen is the common case (`BC-2026-0007`).
 */
export function referenceBodyFor(
  refType: ReferenceType,
  supplied: string | null | undefined,
  companySeq: number,
  seqNo: number,
  invoiceNumber: string
): string | null {
  if (refType === 'NON') {
    // The CHECK refuses a body here, and so does this: a reference body with no
    // reference type to interpret it is a value nothing will ever read.
    return null
  }
  if (supplied != null && supplied !== '') return supplied
  if (refType === 'QRR') return qrrBody(companySeq, seqNo)
  const alnum = invoiceNumber.replace(/[^0-9A-Za-z]/g, '').slice(0, 25)
  if (alnum === '') {
    throw new Error(
      `invoice number ${JSON.stringify(invoiceNumber)} has no alphanumeric characters, so no ` +
        'creditor reference can be derived from it. Supply ref_body, or give the company a ' +
        'number format that contains letters or digits.'
    )
  }
  return alnum
}
