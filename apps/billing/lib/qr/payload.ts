// The Swiss QR Code payload: Table 8 of the standard, serialized.
//
// ===========================================================================
// THE LINE ENDINGS ARE LOAD-BEARING
// ===========================================================================
// A reader identifies every element by its LINE NUMBER. There are no keys. So:
//
//   - lines 1–31 are always present, empty where the element is unused (§4.1.4)
//   - the seven Ultimate Creditor lines (12–18) are status X: never filled, but
//     their separators are still sent
//   - lines 32–34 are status A: omitted, with their separators, when unused
//   - one line-ending style throughout, CR+LF or LF (§4.1.4)
//   - no separator after the last element
//
// An extra empty line anywhere shifts every element after it by one, and the
// result is still a perfectly scannable QR code carrying the wrong reference.
// `payload.test.ts` reproduces the standard's Example 2 byte for byte for that
// reason, and was watched failing on a changed line ending.
//
// ===========================================================================
// ONE DECISION THE STANDARD DOES NOT MAKE FOR US
// ===========================================================================
// §4.1.4 says an unused status-A element is omitted "and no further subsequent
// line is used". It does not say what happens when line 32 (billing
// information) is unused but line 33 (an alternative procedure) is used. If
// line 32 is dropped, the alternative procedure lands in position 32 and is read
// as billing information.
//
// This serializer keeps positions: it drops only TRAILING unused A-lines, and
// emits an empty line 32 when a later one is used. The `swissqrbill` package
// drops line 32 regardless (`oracle.test.ts` records the disagreement). v1 of
// this app emits neither line 32 nor 33–34 (positions P5 and P14), so the case
// is unreachable today; it is decided here so it is not decided by accident.
//
// This module does not validate. `validate.ts` refuses what the standard
// forbids; this one only lays out what it is given.

import { charLength } from './charset'
import { invoiceAccount, invoiceReference, ReferenceProblem } from './reference'
import { amountForPayload } from '@/lib/derive/format'
import type { Invoice, ReferenceType } from '@/types'

/** A structured address (§4.3.1). Only type `S` exists. */
export interface QrAddress {
  name: string
  street: string | null
  building: string | null
  postalCode: string | null
  town: string | null
  country: string | null
}

/** Everything the payload carries, already in its payload form. */
export interface QrBillFields {
  /** IBAN or QR-IBAN, electronic form: no spaces. */
  account: string
  creditor: QrAddress
  /** `1949.75`, or null for "the payer fills it in". */
  amount: string | null
  currency: string
  /** Null when the Ultimate Debtor group is not used. */
  debtor: QrAddress | null
  referenceType: ReferenceType
  /** The FULL reference, with check digits. Null for NON. */
  reference: string | null
  unstructuredMessage: string | null
  /** Line 32, status A. v1 never sets it (position P5). */
  billingInformation: string | null
  /** Lines 33–34, status A, at most two. v1 never sets them (P14). */
  alternativeProcedures: string[]
}

export type LineEnding = '\n' | '\r\n'

/** The maximum payload, separators included (§6.2). */
export const QR_PAYLOAD_MAX = 997

function addressLines(a: QrAddress | null): string[] {
  if (!a) return ['', '', '', '', '', '', '']
  return ['S', a.name, a.street ?? '', a.building ?? '', a.postalCode ?? '', a.town ?? '', a.country ?? '']
}

/** Lay the fields out as Table 8. No validation — see this file's header. */
export function serializeQrPayload(fields: QrBillFields, lineEnding: LineEnding = '\n'): string {
  if (lineEnding !== '\n' && lineEnding !== '\r\n') {
    throw new Error('the payload separator is CR+LF or LF (§4.1.4)')
  }
  const lines: string[] = [
    'SPC', // 1  QRType
    '0200', // 2  Version
    '1', // 3  Coding: UTF-8, restricted set
    fields.account, // 4
    'S', // 5  creditor address type
    fields.creditor.name, // 6
    fields.creditor.street ?? '', // 7
    fields.creditor.building ?? '', // 8
    fields.creditor.postalCode ?? '', // 9
    fields.creditor.town ?? '', // 10
    fields.creditor.country ?? '', // 11
    '', '', '', '', '', '', '', // 12–18 Ultimate Creditor: status X
    fields.amount ?? '', // 19
    fields.currency, // 20
    ...addressLines(fields.debtor), // 21–27
    fields.referenceType, // 28
    fields.reference ?? '', // 29
    fields.unstructuredMessage ?? '', // 30
    'EPD', // 31 Trailer
  ]

  // Lines 32–34, status A. Positional: see the header.
  const additional = [fields.billingInformation ?? '', ...fields.alternativeProcedures]
  let last = additional.length - 1
  while (last >= 0 && additional[last] === '') last--
  lines.push(...additional.slice(0, last + 1))

  return lines.join(lineEnding)
}

/** The payload's size in characters, the unit §6.2 states its limit in. */
export function payloadLength(payload: string): number {
  return charLength(payload)
}

// ---------------------------------------------------------------------------
// From an invoice
// ---------------------------------------------------------------------------

/** The company columns a payment part reads. */
export interface QrCompany {
  legal_name: string
  street: string | null
  building: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  iban: string | null
  qr_iban: string | null
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

/**
 * The fields for an invoice's payment part. Validate them before use.
 *
 * - **The creditor is the company's LEGAL name**, because §4.3.1 requires it to
 *   match the credit account's holder. The trading name belongs on the invoice.
 * - **The debtor group is used only when the client's structured address is
 *   complete** — name, postal code, town and country, the group's dependent
 *   elements (§4.1.5). Otherwise it is omitted and the payment part prints the
 *   "Payable by (name/address)" box to fill in by hand, which is the standard's
 *   own answer to an unknown debtor. Sending a half-filled group is invalid.
 * - **A malformed stored reference body is passed through without check
 *   digits**, so validation refuses it by name instead of this function throwing
 *   out of a render.
 * - Values are trimmed: §4.1.3 forbids padding with blanks.
 */
export function qrBillFieldsFor(invoice: Invoice, company: QrCompany): QrBillFields {
  const client = invoice.client
  const debtorComplete =
    clean(client?.name) && clean(client?.postal_code) && clean(client?.city) && clean(client?.country)

  let reference: string | null
  try {
    reference = invoiceReference(invoice.ref_type, invoice.ref_body)
  } catch (e) {
    if (!(e instanceof ReferenceProblem)) throw e
    reference = invoice.ref_body ?? ''
  }

  return {
    account: (invoiceAccount(invoice.ref_type, company) ?? '').replace(/\s+/g, '').toUpperCase(),
    creditor: {
      name: clean(company.legal_name) ?? '',
      street: clean(company.street),
      building: clean(company.building),
      postalCode: clean(company.postal_code),
      town: clean(company.city),
      country: clean(company.country),
    },
    amount: amountForPayload(invoice.totals.total),
    currency: invoice.currency,
    debtor: debtorComplete
      ? {
          name: clean(client.name)!,
          street: clean(client.street),
          building: clean(client.building),
          postalCode: clean(client.postal_code),
          town: clean(client.city),
          country: clean(client.country),
        }
      : null,
    referenceType: invoice.ref_type,
    reference,
    unstructuredMessage: clean(invoice.message),
    billingInformation: null,
    alternativeProcedures: [],
  }
}
