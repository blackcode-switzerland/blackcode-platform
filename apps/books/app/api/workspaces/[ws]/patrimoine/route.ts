// GET /api/workspaces/{ws}/patrimoine — `bk books patrimoine`
//
// The sole proprietorship's net-worth statement: the second half of what art. 957
// al. 2 CO requires, alongside recettes/dépenses.
//
// `as_of` is the date the statement describes and `compiled` is when it was
// produced. Two fields on purpose: a reader needs both to judge it. `total` is
// derived on read and never stored.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getPatrimoine, publicPatrimoine, resolveScope } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)
  const rows = await getPatrimoine(scope.entity.id)
  return jsonList(rows.map(publicPatrimoine), null)
})
