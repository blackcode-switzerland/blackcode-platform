// POST /api/workspaces/{ws}/exercices/{year}/close — `bk books exercice close`
//
// The statutory routine that ends a fiscal year: it refuses over unposted
// work, refuses over a bilan that does not balance, carries the balance sheet
// into next year, adds the year's result to 2970, and only then marks the year
// closed. `queries/close.ts` carries the reasoning.
//
// ── THERE IS NO REOPEN, AND THERE WILL NOT BE ───────────────────────────────
// A closed year has been filed. art. 958f keeps it for ten years as it was, so
// the correction for something found afterwards is an entry in the CURRENT
// year, not an edit to a filed one — the same doctrine that gives this app no
// un-post and no delete. `already_closed` is therefore a wall, not a toggle.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug, listExercices } from '@/lib/db/queries/statutory'
import { closeExercice, CloseRefused } from '@/lib/db/queries/close'

interface Params { params: Promise<{ ws: string; year: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, year } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const y = Number(year)
  if (!Number.isInteger(y)) {
    throw Errors.badRequest('bad_year', `"${year}" is not a year`, 'bk books exercice close --year 2026')
  }

  const slug = typeof body?.entity === 'string' ? body.entity : ''
  if (!slug) {
    throw Errors.badRequest(
      'missing_entity',
      'closing is per book: a workspace may hold several, and they close separately',
      'pass --entity <book slug>'
    )
  }
  const entity = await getEntityBySlug(ctx.workspace.id, slug)
  if (!entity) throw Errors.notFound('entity_not_found', `no book with slug "${slug}"`, 'bk books entity list')

  const years = await listExercices(ctx.workspace.id, entity.id)
  const exercice = years.find((x) => x.year === y)
  if (!exercice) {
    throw Errors.notFound(
      'exercice_not_found',
      `book "${slug}" has no exercice ${y}`,
      years.length ? `known years: ${years.map((x) => x.year).join(', ')}` : 'bk books exercice create first'
    )
  }

  try {
    const r = await closeExercice(ctx.workspace.id, entity.id, exercice)
    return NextResponse.json({ entity: entity.slug, ...r })
  } catch (e) {
    if (e instanceof CloseRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
