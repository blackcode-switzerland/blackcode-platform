// GET  /api/workspaces/{ws}/analyses — `bk books analyse list`
// POST /api/workspaces/{ws}/analyses — `bk books analyse record`
//
// The analyses journal. Each row is a question somebody asked an agent, the
// verdict it gave, and a `based_on` snapshot of what it READ at answer time.
//
// The POST is the agent write-back contract made real — the sixth write, and
// the second door built for an outside process (the first was the pièce
// ingest). No intelligence lives in the app: agents live outside, read the
// data contract, and file their answers HERE. The row is permanent the moment
// this returns: no update route exists and none will (0013 revokes UPDATE and
// DELETE from the app role). A drifted answer is re-asked, and both rows stand.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug } from '@/lib/db/queries/statutory'
import { listAnalyses, ManagementRefused, publicAnalysis, recordAnalysis } from '@/lib/db/queries/management'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const slug = req.nextUrl.searchParams.get('entity')
  let entityId: number | undefined
  if (slug) {
    const entity = await getEntityBySlug(ctx.workspace.id, slug)
    if (!entity) throw Errors.badRequest('bad_scope', `no book with slug "${slug}"`, 'bk books entity list names them')
    entityId = entity.id
  }
  const rows = await listAnalyses(ctx.workspace.id, entityId)
  return jsonList(rows.map(publicAnalysis), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books analyse record')
  const need = (k: string): string => {
    const v = body[k]
    if (typeof v !== 'string' || !v.trim()) {
      throw Errors.badRequest('missing_field', `${k} is required`, 'bk books analyse record --help shows the shape')
    }
    return v.trim()
  }

  try {
    const r = await recordAnalysis(ctx.workspace.id, {
      entitySlug: need('entity'),
      askedBy: need('asked_by'),
      agent: need('agent'),
      question: body.question,
      verdict: body.verdict,
      figures: Array.isArray(body.figures) ? body.figures : undefined,
      basedOn: Array.isArray(body.based_on) ? body.based_on : undefined,
      scenarioLabel: body.scenario_label,
      runwayAfterMonths: typeof body.runway_after_months === 'number' ? body.runway_after_months : null,
    })
    return NextResponse.json(publicAnalysis(r), { status: 201 })
  } catch (e) {
    if (e instanceof ManagementRefused) {
      if (e.code === 'entity_not_found') throw Errors.notFound(e.code, e.message)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
