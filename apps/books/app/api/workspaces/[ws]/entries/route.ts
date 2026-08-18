// GET /api/workspaces/{ws}/entries — `bk books entry list`
//
// The grand livre. Filters: `?status=`, `?recognition=`, `?account=`.
//
// `?account=` returns WHOLE entries that touch the account, not just the matching
// line: a half-shown écriture is unreadable, because the other side is what says
// where the money went.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { listEntries, publicEntry, resolveScope } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const rows = await listEntries(scope.entity.id, scope.exercice.id, {
    status: q.get('status') ?? undefined,
    recognition: q.get('recognition') ?? undefined,
    account: q.get('account') ?? undefined,
    limit: q.get('limit') ? Number(q.get('limit')) : undefined,
  })
  return jsonList(rows.map(publicEntry), null)
})
