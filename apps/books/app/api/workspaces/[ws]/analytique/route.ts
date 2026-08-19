// GET /api/workspaces/{ws}/analytique — `bk books analytique`
//
// The management view of one (book, exercice): the cost breakdown per
// category and the monthly produits/charges series. Derived at request time
// from POSTED lines — staged money reaches no chart — and scoped to the
// exercice, so a metric cannot mix two years by construction.
//
// A simplified book answers too: its dépenses group by their own category
// label, its flows read the directions. Same route, the book's own shape.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveScope } from '@/lib/db/queries/statutory'
import { getAnalytique } from '@/lib/db/queries/management'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const r = await getAnalytique(scope.entity, scope.exercice)
  return NextResponse.json({
    entity: scope.entity.slug,
    exercice: scope.exercice.year,
    categories: r.categories,
    monthly_flows: r.monthly_flows,
  })
})
