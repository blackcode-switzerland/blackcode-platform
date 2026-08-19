// GET /api/compliance-rules — `bk books compliance list`
//
// The 19 statutory rules, global like the vocabularies: the same law binds
// every book, so this is not under /workspaces. Unauthenticated like
// /api/meta, and for the same reason — the payload is law text with
// citations, holding no amounts and no names.
//
// Every rule carries `source_confidence` and `review_state`. ALL rules are
// born DRAFT: research against Fedlex is not a fiduciary's sign-off, and
// COMPLIANCE_META says so in capitals. Render the state honestly.
import { NextRequest } from 'next/server'
import { jsonList } from '@blackcode/platform-api'
import { apiHandler } from '@/lib/api'
import { listComplianceRules, publicComplianceRule } from '@/lib/db/queries/compliance'

export const GET = apiHandler(async (_req: NextRequest) => {
  const rows = await listComplianceRules()
  return jsonList(rows.map(publicComplianceRule), null)
})
