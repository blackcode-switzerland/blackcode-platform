// `?company=` on a LIST is a subject, and an unknown one is refused.
//
// ===========================================================================
// WHY A FILTER THAT MATCHES NOTHING IS NOT AN EMPTY ANSWER
// ===========================================================================
// A company slug changes what a page is ABOUT, not how it reads. So when it
// names no company in this workspace, the honest answer is "there is no such
// company", not "that company has no invoices". Until 2026-09-18 the invoice
// list, the overview and the history list all answered the second: `--company
// nope` printed "No invoices." and exited 0 — which is exactly what a typo in a
// slug, or a slug from ANOTHER workspace, looks like to an agent that believes
// it. Phase 6's rule for subject parameters (docs/billing-app-plan/
// phase-6-seed-and-production.md): refuse, or state the substitution.
//
// Resolved through `getCompany`, so a `#number` works as well as a slug, and
// the list is then filtered by the company's REAL slug — a `?company=2` would
// otherwise have matched no row's slug and come back empty.

import { Errors } from '@blackcode/platform-api'
import { getCompany } from '@/lib/db/queries/companies'

/** The company's slug, or `undefined` when no filter was asked for. Throws a 404 when it names nothing. */
export async function companyFilter(workspaceId: number, raw: string | null): Promise<string | undefined> {
  if (raw === null || raw === '') return undefined
  const company = await getCompany(workspaceId, raw)
  if (!company) {
    throw Errors.notFound(
      'company_not_found',
      `no company "${raw}" in this workspace, so there is nothing to filter by`,
      'bk billing company list — a slug from another workspace is not one of these'
    )
  }
  return company.slug
}
