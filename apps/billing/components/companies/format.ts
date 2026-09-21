// Display-only formatting for a company's bank fields. The server never sees
// this — `iban`/`qr_iban` are stored and sent back to the routes exactly as
// typed, in `lib/db/queries/companies.ts`; this only groups the digits into
// fours for a human to read, the way a bank statement prints one.

/** `"CH4431999123000889012"` → `"CH44 3199 9123 0008 8901 2"`. Null-safe. */
export function formatIban(v: string | null | undefined): string {
  if (!v) return '—'
  return v.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}
