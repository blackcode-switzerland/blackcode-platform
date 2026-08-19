// GET /api/workspaces/{ws}/tax-params — `bk books tax-params show`
// PUT /api/workspaces/{ws}/tax-params — `bk books tax-params set`
//
// Where a company is taxed and at what rates. `queries/tax-params.ts` carries
// the reasoning; the short version is that `books.tax_params` was SELECT-only
// in the whole application, so `tax: null, configured: false` was the only
// answer a book created through the app could ever give.
//
// PUT because it is one settled set per book (`tax_params.entity_id` is
// UNIQUE), and because a coefficient that has been voted replaces the one
// before it rather than being appended to.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug } from '@/lib/db/queries/statutory'
import { getTaxParams } from '@/lib/db/queries/management'
import { setTaxParams, TaxParamsRefused } from '@/lib/db/queries/tax-params'

interface Params { params: Promise<{ ws: string }> }

async function bookOf(workspaceId: number, slug: string | null) {
  if (!slug) {
    throw Errors.badRequest(
      'missing_entity',
      'tax parameters are per book: a workspace may hold several, in different communes',
      'pass --entity <book slug>'
    )
  }
  const entity = await getEntityBySlug(workspaceId, slug)
  if (!entity) throw Errors.notFound('entity_not_found', `no book with slug "${slug}"`, 'bk books entity list')
  return entity
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const entity = await bookOf(ctx.workspace.id, req.nextUrl.searchParams.get('entity'))
  const row = await getTaxParams(entity.id)
  // `configured: false` is a real answer and is served as one, never filled in
  // with a default: a supplied rate would be inventing somebody's tax bill.
  return NextResponse.json({
    entity: entity.slug,
    configured: !!row,
    canton: row?.canton ?? null,
    commune: row?.commune ?? null,
    params: row?.params ?? null,
  })
})

export const PUT = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books tax-params set')

  const entity = await bookOf(ctx.workspace.id, typeof body.entity === 'string' ? body.entity : null)
  const p = (body.params ?? {}) as Record<string, unknown>
  const num = (flat: string, nested: unknown) => (nested !== undefined ? nested : body[flat])

  try {
    const row = await setTaxParams(ctx.workspace.id, entity, {
      canton: String(body.canton ?? ''),
      commune: String(body.commune ?? ''),
      ifd_rate_pct: Number(num('ifd_rate_pct', (p.ifd as Record<string, unknown>)?.rate_pct)),
      cantonal_base_rate_pct: Number(
        num('cantonal_base_rate_pct', (p.cantonal as Record<string, unknown>)?.base_rate_pct)
      ),
      cantonal_coefficient_pct: Number(
        num('cantonal_coefficient_pct', (p.cantonal as Record<string, unknown>)?.coefficient_pct)
      ),
      communal_coefficient_pct: Number(
        num('communal_coefficient_pct', (p.communal as Record<string, unknown>)?.coefficient_pct)
      ),
      capital_tax_base_rate_permille: Number(
        num('capital_tax_base_rate_permille', (p.capital_tax as Record<string, unknown>)?.base_rate_permille)
      ),
    })
    return NextResponse.json({
      entity: entity.slug,
      configured: true,
      canton: row.canton,
      commune: row.commune,
      params: row.params,
    })
  } catch (e) {
    if (e instanceof TaxParamsRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
