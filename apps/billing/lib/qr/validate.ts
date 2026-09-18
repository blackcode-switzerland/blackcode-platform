// Everything that makes a QR-bill invalid, as refusals a person can act on.
//
// ===========================================================================
// A BILL THE STANDARD WOULD REFUSE MUST NOT LEAVE THE BUILDING
// ===========================================================================
// A payment part that looks right and is wrong is not caught by anyone who
// looks at it. A bank's scanner rejects it at the counter, or — worse — the
// payment settles and cannot be matched. So this runs before a PDF is rendered
// and before an invoice is sent (phase 3's `prepareInvoiceDocument` seam), and
// every rule the standard states as MUST is here.
//
// ── ALL PROBLEMS, NOT THE FIRST ────────────────────────────────────────────
// It returns every refusal it finds, in the order a person should fix them:
// currency, account, the account/reference matrix, the reference, the amount,
// the addresses, the character set, the budgets, the size. An agent fixing a
// company record should learn about the postal code AND the town in one
// round trip, not two. Callers that need one sentence take the first.
//
// ── WHAT IT DOES NOT CHECK ─────────────────────────────────────────────────
// Whether the creditor name matches the name the BANK holds for that account
// (§4.3.1). Nothing in this app can see that; it is why the company's
// `legal_name` is a separate column and why the owner alone may set an IBAN.

import { charLength, findDisallowed } from './charset'
import { isQrIban, isValidIban, isValidQRR, isValidSCOR } from './reference'
import { QR_PAYLOAD_MAX, serializeQrPayload, payloadLength, type QrAddress, type QrBillFields } from './payload'
import { PAYMENT_MESSAGE_MAX } from '@/lib/limits'

export interface QrRefusal {
  code: string
  /** The payload element it concerns, where there is one: `creditor.town`. */
  field?: string
  message: string
  suggestion: string
}

/** Currencies a payment part exists for (§4.2.2 line 20). Others get an invoice with no slip. */
export const PAYMENT_PART_CURRENCIES = ['CHF', 'EUR'] as const

export function hasPaymentPart(currency: string): boolean {
  return (PAYMENT_PART_CURRENCIES as readonly string[]).includes(currency)
}

const ADDRESS_LIMITS = { name: 70, street: 70, building: 16, postalCode: 16, town: 35 } as const

/** No leading zeros, exactly two decimals, `.`, at most 9 integer digits (§4.2.2 line 19). */
const AMOUNT_RE = /^(0|[1-9]\d{0,8})\.\d{2}$/

/**
 * §4.2.2's shared budget for the message and billing information. The SAME
 * number as the write door's `PAYMENT_MESSAGE_MAX`, and read from it: until
 * 2026-09-18 each file typed its own 140, so a change to one would have left an
 * invoice the write door accepted and this check refused (or the reverse).
 */
export const ADDITIONAL_INFORMATION_BUDGET = PAYMENT_MESSAGE_MAX
const ALT_PROCEDURE_MAX = 2
const ALT_PROCEDURE_LENGTH = 100

function checkAddress(
  role: 'creditor' | 'debtor',
  a: QrAddress,
  out: QrRefusal[]
): void {
  const who = role === 'creditor' ? 'the issuing company' : 'the client'
  const fix =
    role === 'creditor'
      ? 'bk billing company edit <slug> with the missing field'
      : 'bk billing invoice edit <ref> with the client’s full address, or leave it incomplete to print the hand-fill box'

  const missing: string[] = []
  if (!a.name) missing.push('name')
  if (!a.postalCode) missing.push('postal code')
  if (!a.town) missing.push('town')
  if (!a.country) missing.push('country')
  if (missing.length > 0) {
    out.push({
      code: `${role}_address_incomplete`,
      field: role,
      message: `${who}’s address is missing its ${missing.join(', ')}; a QR-bill address must have a name, postal code, town and country (§4.3.1)`,
      suggestion: fix,
    })
  }

  if (a.country && !/^[A-Z]{2}$/.test(a.country)) {
    out.push({
      code: 'invalid_country',
      field: `${role}.country`,
      message: `${JSON.stringify(a.country)} is not an ISO 3166-1 alpha-2 country code`,
      suggestion: 'two capital letters, e.g. CH',
    })
  }

  for (const [key, max] of Object.entries(ADDRESS_LIMITS) as [keyof typeof ADDRESS_LIMITS, number][]) {
    const v = a[key]
    if (v && charLength(v) > max) {
      out.push({
        code: 'field_too_long',
        field: `${role}.${key}`,
        message: `${who}’s ${key} is ${charLength(v)} characters; the QR-bill allows ${max}`,
        suggestion: 'shorten it; the limit is the payload’s, and a longer value is not truncated for you',
      })
    }
  }
}

export function validateQrBill(fields: QrBillFields): QrRefusal[] {
  const out: QrRefusal[] = []

  // ── currency ─────────────────────────────────────────────────────────────
  if (!hasPaymentPart(fields.currency)) {
    out.push({
      code: 'no_payment_part_for_currency',
      field: 'currency',
      message: `a QR-bill payment part is CHF or EUR only; this invoice is in ${fields.currency}`,
      suggestion: 'the invoice is valid without a payment part; bill in CHF or EUR for one',
    })
  }

  // ── account ──────────────────────────────────────────────────────────────
  const account = fields.account
  let accountUsable = false
  if (!account) {
    out.push({
      code: 'account_missing',
      field: 'account',
      message:
        fields.referenceType === 'QRR'
          ? 'a QR reference is paid into a QR-IBAN, and the issuing company has none'
          : 'the issuing company has no IBAN, so the bill would tell the client to pay nowhere',
      suggestion: 'ask the workspace owner to set it: bk billing company edit <slug> --iban … / --qr-iban …',
    })
  } else if (!/^(CH|LI)/.test(account)) {
    out.push({
      code: 'iban_country_not_allowed',
      field: 'account',
      message: `a QR-bill pays into a Swiss or Liechtenstein account only; ${account.slice(0, 2)} is neither`,
      suggestion: 'use the company’s CH or LI account',
    })
  } else if (!isValidIban(account)) {
    out.push({
      code: 'invalid_iban',
      field: 'account',
      message: `${JSON.stringify(account)} is not a valid IBAN: 21 characters, no spaces, and correct check digits`,
      suggestion: 'copy it again from the bank statement; one wrong digit fails the check, which is what the check is for',
    })
  } else {
    accountUsable = true
  }

  // ── the account / reference matrix (§7.1) ─────────────────────────────────
  if (accountUsable) {
    const qr = isQrIban(account)
    if (qr && fields.referenceType !== 'QRR') {
      out.push({
        code: 'qr_iban_requires_qrr',
        field: 'referenceType',
        message: `a QR-IBAN only accepts a QR reference, and this bill uses ${fields.referenceType}`,
        suggestion: 'use QRR for this account, or pay into the company’s ordinary IBAN',
      })
    }
    if (!qr && fields.referenceType === 'QRR') {
      out.push({
        code: 'qrr_requires_qr_iban',
        field: 'account',
        message: 'a QR reference needs a QR-IBAN (institution id 30000–31999), and this account is an ordinary IBAN',
        suggestion: 'use SCOR or NON with this IBAN, or set the company’s qr_iban',
      })
    }
  }
  if (fields.referenceType === 'QRR' && fields.currency !== 'CHF') {
    out.push({
      code: 'qrr_chf_only',
      field: 'referenceType',
      message: `a QR reference is CHF only (v2.4), and this bill is in ${fields.currency}`,
      suggestion: 'use SCOR for a EUR bill',
    })
  }

  // ── the reference ────────────────────────────────────────────────────────
  if (fields.referenceType === 'QRR' && !(fields.reference && isValidQRR(fields.reference))) {
    out.push({
      code: 'invalid_qr_reference',
      field: 'reference',
      message: `${JSON.stringify(fields.reference ?? '')} is not a valid QR reference: 27 digits, not all zeros, correct check digit`,
      suggestion: 'omit ref_body to have the reference derived',
    })
  }
  if (fields.referenceType === 'SCOR' && !(fields.reference && isValidSCOR(fields.reference))) {
    out.push({
      code: 'invalid_creditor_reference',
      field: 'reference',
      message: `${JSON.stringify(fields.reference ?? '')} is not a valid creditor reference: RF, two check digits, 1–21 letters or digits`,
      suggestion: 'omit ref_body to have it derived from the invoice number',
    })
  }
  if (fields.referenceType === 'NON' && fields.reference) {
    out.push({
      code: 'non_takes_no_reference',
      field: 'reference',
      message: 'a bill without a reference (NON) carries an empty reference line',
      suggestion: 'remove the reference, or choose SCOR or QRR',
    })
  }
  if (!['QRR', 'SCOR', 'NON'].includes(fields.referenceType)) {
    out.push({
      code: 'invalid_reference_type',
      field: 'referenceType',
      message: `${JSON.stringify(fields.referenceType)} is not a reference type`,
      suggestion: 'QRR, SCOR or NON',
    })
  }

  // ── the amount ───────────────────────────────────────────────────────────
  if (fields.amount !== null && (!AMOUNT_RE.test(fields.amount) || fields.amount === '0.00')) {
    out.push({
      code: 'invalid_amount',
      field: 'amount',
      message: `${JSON.stringify(fields.amount)} is not a payable amount: 0.01 to 999999999.99, two decimals, no separators`,
      suggestion:
        fields.amount === '0.00'
          ? 'a 0.00 bill is a notification bill, which this app does not issue'
          : 'a bill for a negative amount is a credit note, which this app does not issue yet',
    })
  }

  // ── addresses ────────────────────────────────────────────────────────────
  checkAddress('creditor', fields.creditor, out)
  if (fields.debtor) checkAddress('debtor', fields.debtor, out)

  // ── the character set (§4.1.1), on every text element ────────────────────
  const texts: Array<[string, string | null]> = [
    ['creditor.name', fields.creditor.name],
    ['creditor.street', fields.creditor.street],
    ['creditor.building', fields.creditor.building],
    ['creditor.postalCode', fields.creditor.postalCode],
    ['creditor.town', fields.creditor.town],
    ['debtor.name', fields.debtor?.name ?? null],
    ['debtor.street', fields.debtor?.street ?? null],
    ['debtor.building', fields.debtor?.building ?? null],
    ['debtor.postalCode', fields.debtor?.postalCode ?? null],
    ['debtor.town', fields.debtor?.town ?? null],
    ['unstructuredMessage', fields.unstructuredMessage],
    ['billingInformation', fields.billingInformation],
    ...fields.alternativeProcedures.map((p, i): [string, string] => [`alternativeProcedures[${i}]`, p]),
  ]
  for (const [field, value] of texts) {
    if (!value) continue
    const bad = findDisallowed(value)
    if (bad) {
      const shown = bad.codepoint === 'U+000A' || bad.codepoint === 'U+000D' ? 'a line break' : JSON.stringify(bad.character)
      out.push({
        code: 'character_not_allowed',
        field,
        message: `${field} contains ${shown} (${bad.codepoint}) at character ${bad.position}, which a Swiss QR Code cannot carry (§4.1.1)`,
        suggestion: 'replace it yourself — it is not substituted for you, because a changed creditor name can fail to match the account holder',
      })
    }
  }

  // ── the shared 140-character budget (§4.2.2 lines 30 and 32) ─────────────
  const budget = charLength(fields.unstructuredMessage ?? '') + charLength(fields.billingInformation ?? '')
  if (budget > ADDITIONAL_INFORMATION_BUDGET) {
    out.push({
      code: 'additional_information_too_long',
      field: 'unstructuredMessage',
      message: `the payment message and billing information total ${budget} characters; they share ${ADDITIONAL_INFORMATION_BUDGET}`,
      suggestion: 'shorten the payment message',
    })
  }

  // ── alternative procedures (lines 33–34) ─────────────────────────────────
  if (
    fields.alternativeProcedures.length > ALT_PROCEDURE_MAX ||
    fields.alternativeProcedures.some((p) => charLength(p) > ALT_PROCEDURE_LENGTH)
  ) {
    out.push({
      code: 'alternative_procedure_invalid',
      field: 'alternativeProcedures',
      message: `at most ${ALT_PROCEDURE_MAX} alternative procedures of ${ALT_PROCEDURE_LENGTH} characters each`,
      suggestion: 'this app does not emit alternative procedures in v1',
    })
  }

  // ── the whole payload (§6.2) ─────────────────────────────────────────────
  const size = payloadLength(serializeQrPayload(fields))
  if (size > QR_PAYLOAD_MAX) {
    out.push({
      code: 'payload_too_long',
      message: `the QR payload is ${size} characters; the standard allows ${QR_PAYLOAD_MAX}`,
      suggestion: 'shorten the longest text fields — the addresses and the payment message',
    })
  }

  return out
}
