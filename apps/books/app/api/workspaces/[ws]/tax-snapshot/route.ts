// GET /api/workspaces/{ws}/tax-snapshot — `bk books tax`
//
// The PM tax position of one (book, exercice), derived at request time and
// never stored: VAT from the entries' own TVA columns, profit and equity from
// the statements, the two tax ESTIMATES from the entity's parameter record —
// canton, commune, rates, citations, `confirmed` flags. A book with no
// parameters answers `configured: false` and no invented rates. Position
// tracking over time is b/tax, not here; this is a snapshot only.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveScope } from '@/lib/db/queries/statutory'
import { getTaxSnapshot, ManagementRefused } from '@/lib/db/queries/management'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  try {
    const snap = await getTaxSnapshot(scope.entity, scope.exercice)
    return NextResponse.json({ entity: scope.entity.slug, exercice: scope.exercice.year, ...snap })
  } catch (e) {
    if (e instanceof ManagementRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
