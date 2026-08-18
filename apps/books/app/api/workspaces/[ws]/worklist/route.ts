// GET /api/workspaces/{ws}/worklist — `bk books worklist`
//
// Everything that needs a human: unrecognized and inferred rows, from both the
// double-entry journal and the RI book, each with the rules that WOULD explain
// it computed live. This is the Reconnaissance screen's payload, and the count
// the overview shows is a summary of this list.
//
// Suggestions are the machine's opinion, never its action. Applying one is
// `POST /entries/{n}/resolve`, and only a human (or an agent a human runs)
// calls that.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveScope } from '@/lib/db/queries/statutory'
import { getWorklist } from '@/lib/db/queries/worklist'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const rows = await getWorklist(scope.entity.id, scope.exercice.id)
  return NextResponse.json({
    entity: scope.entity.slug,
    exercice: scope.exercice.year,
    count: rows.length,
    rows,
  })
})
