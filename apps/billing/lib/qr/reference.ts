// Payment references and accounts: the numbers a bank matches money against.
//
// ===========================================================================
// PURE, NO I/O, OURS TO READ — decision D-B2
// ===========================================================================
// Everything in `lib/qr/` is a function of its arguments. No database, no
// network, no clock. The QR-bill standard's §6 checklist is only an acceptance
// test if we own the code it tests, which is why none of this is delegated to a
// library. `oracle.test.ts` does use the maintained `swissqrbill` package — as a
// second opinion in a test, never on a request path.
//
// The authority is SIX's *Swiss Implementation Guidelines for the QR-bill*,
// v2.4 (24.02.2026). `§` references below are to it; the digest is
// docs/billing-app-plan/qr-bill.md and the full extraction is
// apps/billing/docs/qr-bill-spec.md.
//
// ===========================================================================
// THE BODY IS STORED, THE CHECK DIGITS ARE NOT
// ===========================================================================
// `billing.invoice.ref_body` holds the reference WITHOUT its check digits.
// They are computed on every read (invariant I6): a stored check digit is a
// value that can disagree with the body it checks.
//
// This file moved here from `lib/derive/reference.ts` on 2026-09-17 (ticket
// #84), so the body scheme lives beside the algorithms that complete it. The
// move found that the SCOR body was allowed 25 characters when ISO 11649 allows
// 25 for the WHOLE reference — see `SCOR_BODY_MAX`.

import type { ReferenceType } from '@/types'

/** A refusal this module can produce. The caller maps it onto its own error type. */
export class ReferenceProblem extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// QRR — modulo 10 recursive (§2.12.1, Annex B)
// ---------------------------------------------------------------------------

/**
 * The carry table, indexed by carry. The PDF prints it only as an image
 * (Figure 21); these ten values are the Swiss ESR table, and the Annex B worked
 * example reproduces through them digit by digit (`reference.test.ts`).
 */
const MOD10_CARRY = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5] as const

export const QRR_BODY_LENGTH = 26

/** The check digit for a 26-digit QRR body. */
export function qrrCheckDigit(body: string): string {
  if (!/^\d{26}$/.test(body)) {
    throw new ReferenceProblem(
      'invalid_qr_reference',
      `a QR reference body is exactly 26 digits; got ${JSON.stringify(body)}`,
      'the body is derived from the company and invoice numbers; supply ref_body only to override it'
    )
  }
  let carry = 0
  for (const ch of body) carry = MOD10_CARRY[(carry + Number(ch)) % 10]
  return String((10 - carry) % 10)
}

/** The full 27-digit QR reference. */
export function refQRR(body: string): string {
  return body + qrrCheckDigit(body)
}

/**
 * Is this a valid 27-digit QR reference? Exactly 27 digits, not all zeros, and
 * a correct check digit (§2.12.1).
 */
export function isValidQRR(reference: string): boolean {
  if (!/^\d{27}$/.test(reference) || /^0+$/.test(reference)) return false
  return qrrCheckDigit(reference.slice(0, 26)) === reference[26]
}

// ---------------------------------------------------------------------------
// SCOR — ISO 11649, modulo 97-10 (§2.12.2)
// ---------------------------------------------------------------------------

/**
 * 25 characters is the whole reference: `RF`, two check digits, and the body.
 * So the body is at most 21.
 *
 * Phase 1 derived the body as `invoiceNumber.slice(0, 25)`, and 0005's CHECK
 * allowed 25. A 22-to-25-character body produced a reference of 26 to 29
 * characters, which no bank accepts — and truncating at all meant two invoice
 * numbers sharing their first characters could share a reference. Migration
 * 0008 tightens the CHECK; `referenceBodyFor` refuses instead of truncating.
 */
export const SCOR_BODY_MAX = 21
const SCOR_BODY_RE = new RegExp(`^[0-9A-Za-z]{1,${SCOR_BODY_MAX}}$`)
const SCOR_REFERENCE_RE = new RegExp(`^RF\\d{2}[0-9A-Za-z]{1,${SCOR_BODY_MAX}}$`, 'i')

/** Letters become numbers (A=10 … Z=35), then the whole string mod 97, digit by digit. */
function mod97(alnum: string): number {
  let r = 0
  for (const ch of alnum.toUpperCase()) {
    const code = ch.charCodeAt(0)
    if (code >= 48 && code <= 57) {
      r = (r * 10 + (code - 48)) % 97
    } else if (code >= 65 && code <= 90) {
      // Two digits, 10–35.
      r = (r * 100 + (code - 55)) % 97
    } else {
      throw new Error(`mod97 over a non-alphanumeric character ${JSON.stringify(ch)}`)
    }
  }
  return r
}

/** The two check digits for a SCOR body. Letters are case-insensitive, as banks treat them. */
export function scorCheckDigits(body: string): string {
  if (!SCOR_BODY_RE.test(body)) {
    throw new ReferenceProblem(
      'invalid_creditor_reference',
      `a creditor reference body is 1 to ${SCOR_BODY_MAX} letters or digits; got ${JSON.stringify(body)}`,
      `use only A–Z and 0–9, at most ${SCOR_BODY_MAX} of them`
    )
  }
  return String(98 - mod97(body + 'RF00')).padStart(2, '0')
}

/**
 * The full creditor reference, `RF` + check digits + body, UPPERCASED. ISO 11649
 * is case-insensitive and banks process it that way, so the printed and encoded
 * form is the canonical one.
 */
export function refSCOR(body: string): string {
  return 'RF' + scorCheckDigits(body) + body.toUpperCase()
}

/** 5–25 alphanumerics, `RF`-prefixed, and mod 97 of the rearranged string is 1. */
export function isValidSCOR(reference: string): boolean {
  if (!SCOR_REFERENCE_RE.test(reference)) return false
  return mod97(reference.slice(4) + reference.slice(0, 4)) === 1
}

// ---------------------------------------------------------------------------
// IBAN — ISO 13616, CH and LI only (§2.7–2.10, §4.2.2 line 4)
// ---------------------------------------------------------------------------

/**
 * A Swiss or Liechtenstein IBAN in electronic form: `CH`/`LI`, two check digits,
 * a five-digit institution id, twelve account characters. 21 characters, no
 * spaces, uppercase.
 */
export function isValidIban(iban: string): boolean {
  if (!/^(CH|LI)\d{2}\d{5}[0-9A-Z]{12}$/.test(iban)) return false
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1
}

/** Spaces removed, uppercased — what a person types becomes what the payload needs. */
export function compactIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

/**
 * A QR-IBAN is an IBAN whose institution id, positions 5–9, is 30000–31999
 * (§2.9). The id is exclusively reserved, so this is a property of the account,
 * not a flag somebody sets.
 */
export function isQrIban(iban: string): boolean {
  const iid = iban.slice(4, 9)
  if (!/^\d{5}$/.test(iid)) return false
  const n = Number(iid)
  return n >= 30000 && n <= 31999
}

// ---------------------------------------------------------------------------
// What an invoice pays into, and what it quotes
// ---------------------------------------------------------------------------

/** QRR pays into the QR-IBAN; everything else into the ordinary IBAN (§7.1). */
export function invoiceAccount(
  refType: ReferenceType,
  company: { iban: string | null; qr_iban: string | null }
): string | null {
  return refType === 'QRR' ? company.qr_iban : company.iban
}

/**
 * The full reference for a stored body, or null for NON.
 *
 * Throws `ReferenceProblem` for a body that cannot form a valid reference. The
 * database's CHECKs make that unreachable for rows written since migration
 * 0008; the throw is for anything older, and for callers passing their own.
 */
export function invoiceReference(refType: ReferenceType, body: string | null): string | null {
  if (refType === 'NON') return null
  if (body === null || body === '') {
    throw new ReferenceProblem(
      refType === 'QRR' ? 'invalid_qr_reference' : 'invalid_creditor_reference',
      `a ${refType} invoice has no reference body`,
      'every QRR and SCOR invoice is given one at create; this row predates that rule'
    )
  }
  if (refType === 'QRR') {
    const ref = refQRR(body)
    if (!isValidQRR(ref)) {
      throw new ReferenceProblem(
        'invalid_qr_reference',
        'a QR reference may not consist only of zeros (§2.12.1)',
        'supply a body with at least one non-zero digit'
      )
    }
    return ref
  }
  return refSCOR(body)
}

// ---------------------------------------------------------------------------
// Printed forms (§3.5.4)
// ---------------------------------------------------------------------------

/** `CH44 3199 9123 0008 8901 2` — blocks of four. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ')
}

/** `21 00000 00003 13947 14300 09017` — two, then blocks of five. */
export function formatQRR(reference: string): string {
  return reference.slice(0, 2) + ' ' + reference.slice(2).replace(/(.{5})(?=.)/g, '$1 ')
}

/** `RF18 5390 0754 7034` — blocks of four. */
export function formatSCOR(reference: string): string {
  return reference.replace(/(.{4})(?=.)/g, '$1 ')
}

// ---------------------------------------------------------------------------
// The body scheme — position P11, and it is not settled
// ---------------------------------------------------------------------------
// The QRR layout, 26 digits:
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
// It is derived at CREATE time, not render time, because the invoice's own
// `seq_no` is in it and G1 freezes `seq_no` the moment the row exists; one
// derivation, stored, rather than every surface re-deriving a number a bank
// matches payments against. That derivation was missing entirely until the
// first real `POST …/invoices` on 2026-09-17 failed its CHECK.

const QRR_PAD = 14
const QRR_COMPANY_DIGITS = 4
const QRR_SEQ_DIGITS = 8

/**
 * The QRR body. Throws rather than truncating when a company or an invoice
 * outgrows its field: a truncated reference collides with an older invoice's,
 * so a payment would reconcile against the wrong bill.
 */
export function qrrBody(companySeq: number, seqNo: number): string {
  const c = String(companySeq)
  const s = String(seqNo)
  if (c.length > QRR_COMPANY_DIGITS || s.length > QRR_SEQ_DIGITS) {
    throw new ReferenceProblem(
      'reference_scheme_exhausted',
      `company #${companySeq} / invoice ${seqNo} does not fit the QR reference scheme ` +
        `(${QRR_COMPANY_DIGITS} and ${QRR_SEQ_DIGITS} digits)`,
      'widening the scheme must be agreed with the bank (position P11); until then use SCOR'
    )
  }
  return '0'.repeat(QRR_PAD) + c.padStart(QRR_COMPANY_DIGITS, '0') + s.padStart(QRR_SEQ_DIGITS, '0')
}

/**
 * What is wrong with a reference body for a type, or null. The write door's
 * check for a caller-supplied `ref_body`, and the same rule the CHECKs enforce.
 */
export function referenceBodyProblem(refType: ReferenceType, body: string | null | undefined): ReferenceProblem | null {
  const present = body !== null && body !== undefined && body !== ''
  if (refType === 'NON') {
    return present
      ? new ReferenceProblem(
          'non_takes_no_reference',
          'an invoice without a reference (NON) carries no reference body',
          'omit ref_body, or choose SCOR or QRR'
        )
      : null
  }
  if (!present) return null
  if (refType === 'QRR') {
    if (!/^\d{26}$/.test(body!)) {
      return new ReferenceProblem(
        'invalid_qr_reference',
        `a QR reference body is exactly 26 digits; got ${body!.length} characters`,
        'omit ref_body to have it derived, or supply 26 digits (the 27th, the check digit, is computed)'
      )
    }
    if (/^0+$/.test(body!)) {
      return new ReferenceProblem(
        'invalid_qr_reference',
        'a QR reference may not consist only of zeros (§2.12.1)',
        'omit ref_body to have it derived'
      )
    }
    return null
  }
  if (!/^[0-9A-Za-z]+$/.test(body!)) {
    return new ReferenceProblem(
      'invalid_creditor_reference',
      'a creditor reference body is letters and digits only',
      'remove spaces, hyphens and punctuation; the check digits and RF prefix are added for you'
    )
  }
  if (body!.length > SCOR_BODY_MAX) {
    return new ReferenceProblem(
      'invalid_creditor_reference',
      `a creditor reference body is at most ${SCOR_BODY_MAX} characters (25 with RF and its check digits); got ${body!.length}`,
      `shorten it to ${SCOR_BODY_MAX} characters or fewer`
    )
  }
  return null
}

/**
 * The body a new invoice stores, or null for NON.
 *
 * A caller-supplied body wins — a bank or a client may dictate a creditor
 * reference, and imported history carries references that already exist — and
 * is checked by `referenceBodyProblem` first.
 *
 * SCOR derives from the invoice number with non-alphanumerics removed
 * (`BC-2026-0007` → `BC20260007`): it is what a client quotes on the phone. A
 * number whose letters and digits exceed 21 is REFUSED, never truncated.
 */
export function referenceBodyFor(
  refType: ReferenceType,
  supplied: string | null | undefined,
  companySeq: number,
  seqNo: number,
  invoiceNumber: string
): string | null {
  const problem = referenceBodyProblem(refType, supplied)
  if (problem) throw problem
  if (refType === 'NON') return null
  if (supplied !== null && supplied !== undefined && supplied !== '') return supplied
  if (refType === 'QRR') return qrrBody(companySeq, seqNo)

  const alnum = invoiceNumber.replace(/[^0-9A-Za-z]/g, '')
  if (alnum === '' || alnum.length > SCOR_BODY_MAX) {
    throw new ReferenceProblem(
      'number_cannot_form_reference',
      alnum === ''
        ? `invoice number ${JSON.stringify(invoiceNumber)} has no letters or digits to form a creditor reference from`
        : `invoice number ${JSON.stringify(invoiceNumber)} has ${alnum.length} letters and digits; a creditor ` +
          `reference body holds ${SCOR_BODY_MAX}`,
      'supply ref_body, use a shorter number format for this company, or use NON'
    )
  }
  return alnum
}
