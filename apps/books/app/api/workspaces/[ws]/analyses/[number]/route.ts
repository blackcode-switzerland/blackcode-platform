// GET /api/workspaces/{ws}/analyses/{number} — `bk books analyse show`
//
// One filed analysis, whole: question, verdict, figures, and the `based_on`
// snapshot exactly as it was filed. NEVER recomputed — a stored answer that
// silently changes is worse than a stale one. Whether the inputs have moved
// since is a comparison a CLIENT may draw against the live routes; the record
// itself does not shift.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getAnalysis, publicAnalysis } from '@/lib/db/queries/management'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', 'number must be a positive integer', 'try `bk books analyse list` for the numbers')
  }
  const found = await getAnalysis(ctx.workspace.id, n)
  if (!found) throw Errors.notFound('analysis_not_found', `no analysis #${n} in this workspace`)
  return NextResponse.json(publicAnalysis(found))
})
