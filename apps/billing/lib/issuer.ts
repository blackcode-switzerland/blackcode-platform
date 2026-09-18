// The issuer of an invoice: the company as it is NOW for a draft, and the copy
// taken at issue for everything else. Invariant I12.
//
// ===========================================================================
// ONE FUNCTION DECIDES WHICH, AND EVERY READER GOES THROUGH IT
// ===========================================================================
// `issuerOf(snapshot, live)` is the whole rule: a stored snapshot wins, always;
// the live company is read only when there is none, which the database holds to
// "only while the invoice is a draft" (migration 0011's iff-CHECK).
//
// The totals, the account on the payment part, the creditor block, the PDF and
// the `derived` block on the wire all take their company from here. A reader
// that reached for `billing.company` directly would be right for every draft
// and for every sent invoice whose company was never edited — which is nearly
// all of them, and is exactly why it would not be noticed. `lib/issuer.test.ts`
// greps the render and derivation paths for that reach.
//
// ===========================================================================
// WHAT IS IN THE COPY, AND THE TEST FOR WHAT BELONGS
// ===========================================================================
// Everything the document prints or derives from the company: both names, the
// address, the email, both accounts, the VAT identity, the two footers, the
// logo — and `rounding`, which prints nothing and decides every total (D-B7).
//
// Not in it: `slug` and `seq` (addresses, not content — and `company_id` on the
// invoice is frozen by G1), the `default_*` prefills (never read at render
// time), `number_format` and `next_seq` (the number is already minted and
// frozen), `retired_at` (a retired company's old bills still render).
//
// The test for a new company column: **would an already-sent PDF look or add up
// differently if it changed?** Yes → it goes in `ISSUER_FIELDS`, in 0011's shape
// CHECK by a new migration, and `lib/issuer.test.ts` fails until both agree.

import type { IssuerSnapshot, RoundingPolicy } from '@/types'

/** The company columns a snapshot copies. `captured_at` is added beside them. */
export const ISSUER_FIELDS = [
  'name',
  'legal_name',
  'street',
  'building',
  'postal_code',
  'city',
  'country',
  'email',
  'logo_initials',
  'logo_color',
  'iban',
  'qr_iban',
  'vat_registered',
  'uid',
  'vat_number',
  'rounding',
  'footer_fr',
  'footer_en',
] as const

export type IssuerField = (typeof ISSUER_FIELDS)[number]

/** The issuer a document renders from: a snapshot, or the live company in the same shape. */
export type IssuerSource = { [K in IssuerField]: IssuerSnapshot[K] }

/**
 * What a company ROW must offer to be snapshotted. `rounding` is a plain string
 * there — the column is a `varchar` held to the vocabulary by a CHECK
 * (`company_rounding_check`), which TypeScript cannot see.
 */
export type IssuerRow = Omit<IssuerSource, 'rounding'> & { rounding: string }

/**
 * The copy to store when an invoice leaves `draft`.
 *
 * Built key by key from `ISSUER_FIELDS`, never by spreading the row: a spread
 * would carry `next_seq` and `id` into a legal document's record, and would
 * change shape every time the company table did.
 */
export function issuerSnapshot(company: IssuerRow, now: Date = new Date()): IssuerSnapshot {
  const out: Record<string, unknown> = {}
  for (const k of ISSUER_FIELDS) out[k] = company[k] ?? null
  out.vat_registered = Boolean(company.vat_registered)
  out.rounding = company.rounding as RoundingPolicy
  out.captured_at = now.toISOString()
  return out as unknown as IssuerSnapshot
}

/**
 * The issuer a document renders from: the stored copy if there is one, else the
 * live company. The live branch carries no `captured_at` — that absence is how a
 * caller can tell "as issued" from "as it would be issued today".
 */
export function issuerOf(snapshot: IssuerSnapshot | null | undefined, live: IssuerSource): IssuerSource {
  if (snapshot) return snapshot
  const out: Record<string, unknown> = {}
  for (const k of ISSUER_FIELDS) out[k] = live[k] ?? null
  out.vat_registered = Boolean(live.vat_registered)
  return out as unknown as IssuerSource
}
