// The mockup's data, as `scripts/extract-mockup.mjs` extracted it into
// `fixtures/mockup.json` — the seed's source and the parity tests' oracle.
//
// Mechanical, never hand-edited: `MOCKUP.source` names the mockup commit and the
// file's sha256, so "matches the mockup" always says which one.

import data from '@/fixtures/mockup.json'
import type { ImportHistoryRow } from '@/types'

export const MOCKUP = data

type MockupHistory = (typeof data.history)[number]

/**
 * The mockup's imported-history rows, in the shape an agent would post.
 *
 * `companySlug` maps the mockup's company id to a slug in the target workspace.
 * The mockup keeps amounts as JS numbers; each has at most two decimals, so
 * `toFixed(2)` is exact for them — and the result is the STRING the import
 * requires, which is the point of converting here rather than posting numbers.
 */
export function mockupHistoryRows(companySlug: (mockupCompanyId: number) => string): ImportHistoryRow[] {
  return data.history.map((h: MockupHistory) => ({
    source: h.source as ImportHistoryRow['source'],
    source_ref: h.source_ref,
    company: companySlug(h.company_id),
    number: h.number,
    client_name: h.client_name,
    issue_date: h.issue_date,
    currency: h.currency,
    total: h.total.toFixed(2),
    status: h.status as ImportHistoryRow['status'],
    import_flag: h.import_flag ? { fr: h.import_flag.fr, en: h.import_flag.en } : null,
    drive_path: h.drive_path,
  }))
}
