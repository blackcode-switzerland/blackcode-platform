// GET /api/workspaces/{ws}/accounts — `bk books account list`
//
// The Swiss PME chart for one book. `statement_position` is the only mapping
// anybody may touch, and it is a NOT NULL foreign key into the legal line list, so
// an unmapped account is impossible rather than merely discouraged.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { listAccounts, publicAccount, resolveScope } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)
  const rows = await listAccounts(scope.entity.id)
  return jsonList(rows.map(publicAccount), null)
})
