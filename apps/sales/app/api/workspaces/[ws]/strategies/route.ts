// GET  /api/workspaces/{ws}/strategies — the segment strategies
// POST /api/workspaces/{ws}/strategies — create one
//
// A strategy is WHY a segment was chosen: "watch & jewellery boutiques in
// Lausanne, pitched with the AP configurator demo plus the consciencegems.ch
// case study". Reusable reasoning that applies to ten prospects at once, which
// is why it is addressable on its own (`seq`, #number, URN) rather than a field
// on a prospect. The per-prospect half is `prospects.game_plan` — see migration
// 0010's header for why collapsing the two would have been wrong both ways.
//
// The products a strategy leads with are REPLACED as a whole set on write, not
// patched member by member; the reasoning is in
// `lib/db/queries/strategies.ts`'s header.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createStrategy, listStrategies } from '@/lib/db/queries/strategies'
import { publicStrategy } from '@/lib/views'
import { STRATEGY_NAME_MAX } from '@/lib/limits'
import { requireMaxLength, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

/**
 * `--product 3 --product 8` arrives as an array; a hand-rolled caller may send
 * `"3,8"` or `3`. All three mean the same thing and all three are accepted, for
 * the reason `bodyNumber` exists (sales #38): a body field's JSON type is
 * whatever the client's language produced, and a route that only understood one
 * of them refused a correct request.
 *
 * `undefined` (key absent) and `[]` (explicitly empty) are DIFFERENT and stay
 * different all the way down: absent leaves the set alone, empty clears it.
 */
export function parseProductNumbers(v: unknown): number[] | undefined {
  if (v === undefined) return undefined
  if (v === null) return []
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [v]
  const out: number[] = []
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(String(item).trim())
    if (!Number.isInteger(n) || n <= 0) {
      throw Errors.badRequest(
        'invalid_product',
        `${JSON.stringify(item)} is not a product #number`,
        'run `bk sales product list` for the numbers'
      )
    }
    out.push(n)
  }
  return out
}

/** Turn `resolveProductIds`' all-or-nothing throw into a 404 naming what is missing. */
export function rethrowUnknownProducts(err: unknown): never {
  const missing = (err as { missingProducts?: number[] })?.missingProducts
  if (missing?.length) {
    throw Errors.notFound(
      'product_not_found',
      `no product ${missing.map((n) => `#${n}`).join(', ')} in this workspace`,
      'run `bk sales product list` for the numbers — nothing was changed'
    )
  }
  throw err
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const rows = await listStrategies({
    workspaceId: ctx.workspace.id,
    q: req.nextUrl.searchParams.get('q') ?? undefined,
    includeDeleted: req.nextUrl.searchParams.get('include_deleted') === 'true',
  })
  // No cursor: a workspace has a handful of segments, not thousands, and a
  // paged one would make "what are we running" two calls. The envelope stays
  // `{ data, next_cursor }` because every list route serves that shape.
  return jsonList(
    rows.map((r) => publicStrategy(r, ctx.workspace.slug)),
    null
  )
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) {
    throw Errors.badRequest(
      'missing_name',
      'name is required',
      'pass --name "<what this segment is>"'
    )
  }
  requireMaxLength(name, STRATEGY_NAME_MAX, 'name')

  const productNumbers = parseProductNumbers(body?.products)
  const actor = await resolveActor(getDb(), req, ctx.user)
  const created = await createStrategy(
    ctx.workspace.id,
    {
      name,
      vertical: str(body?.vertical) ?? null,
      area: str(body?.area) ?? null,
      rationale: str(body?.rationale) ?? null,
      caseStudies: str(body?.case_studies) ?? null,
      productNumbers,
    },
    actor
  ).catch(rethrowUnknownProducts)

  return NextResponse.json(publicStrategy(created, ctx.workspace.slug), { status: 201 })
})
