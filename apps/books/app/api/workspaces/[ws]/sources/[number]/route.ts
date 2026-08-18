// GET /api/workspaces/{ws}/sources/{number} — `bk books source show`
//
// One source in full: the computed status, the raw files pulled from it, and
// the runbook that says how to pull the next one. `credential_ref` in the
// runbook is a vault reference; if a real secret ever appears in this payload,
// the bug is in whoever wrote the runbook, and the fix is rotation, not CSS.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import {
  getSourceBySeq,
  pullsOf,
  runbookOf,
  publicSource,
  publicPull,
  publicRunbook,
  entitySlugsById,
} from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  const src = await getSourceBySeq(ctx.workspace.id, n)
  if (!src) throw Errors.notFound('source', String(n))

  const today = new Date().toISOString().slice(0, 10)
  const [pulls, runbook, slugs] = await Promise.all([pullsOf(src.id), runbookOf(src.id), entitySlugsById(ctx.workspace.id)])
  return NextResponse.json({
    ...publicSource(src, today, src.entity_id === null ? null : (slugs.get(src.entity_id) ?? null)),
    pulls: pulls.map(publicPull),
    runbook: runbook ? publicRunbook(runbook) : null,
  })
})
