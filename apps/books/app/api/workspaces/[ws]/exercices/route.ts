// GET  /api/workspaces/{ws}/exercices  — `bk books exercice list`
// POST /api/workspaces/{ws}/exercices  — `bk books exercice create`
//
// The fiscal year. Calendar years only for now: `entity.fiscal_year` records the
// convention and every seeded book uses `calendar`, so a non-calendar year is a
// conversation rather than something to guess at silently.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import {
  createExercice,
  getEntityBySlug,
  listExercices,
  publicExercice,
} from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const slug = req.nextUrl.searchParams.get('entity')
  let entityId: number | undefined
  if (slug) {
    const e = await getEntityBySlug(ctx.workspace.id, slug)
    if (!e) throw Errors.notFound('entity_not_found', `no book with slug "${slug}"`)
    entityId = e.id
  }
  const rows = await listExercices(ctx.workspace.id, entityId)
  return jsonList(rows.map(publicExercice), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const slug = typeof body?.entity === 'string' ? body.entity : ''
  const year = Number(body?.year)
  if (!slug) throw Errors.badRequest('missing_entity', 'entity is required', 'pass --entity blackcode')
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw Errors.badRequest('bad_year', 'year must be a four-digit year', 'pass --year 2026')
  }
  const entity = await getEntityBySlug(ctx.workspace.id, slug)
  if (!entity) throw Errors.notFound('entity_not_found', `no book with slug "${slug}"`)

  const row = await createExercice(ctx.workspace.id, { entityId: entity.id, year })
  return NextResponse.json(publicExercice(row), { status: 201 })
})
