// GET  /api/workspaces/{ws}/products — what we sell
// POST /api/workspaces/{ws}/products — add one
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createProduct, listProducts } from '@/lib/db/queries/catalog'
import { publicProduct } from '@/lib/views'
import { PRODUCT_NAME_MAX } from '@/lib/limits'
import { numberOr, requireMaxLength, requireMoney, str } from '@/lib/http-input'
import { PRODUCT_CATEGORY_VALUES } from '@/lib/pipeline'
import {
  requireExternalUrl,
  requireInternalPriceRange,
  requireReach,
} from '@/lib/api/product-fields'

interface Params {
  params: Promise<{ ws: string }>
}

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : null

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const category = str(q.get('category'))
  if (category && !PRODUCT_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      `unknown product category ${JSON.stringify(category)}`,
      'run `bk meta` for the current categories'
    )
  }
  const rows = await listProducts({
    workspaceId: ctx.workspace.id,
    category,
    q: str(q.get('q')),
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
  })
  return jsonList(rows.map((p) => publicProduct(p, ctx.workspace.slug)), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) throw Errors.badRequest('missing_name', 'name is required', 'pass --name "…"')
  requireMaxLength(name, PRODUCT_NAME_MAX, 'name')

  const category = str(body?.category)
  if (!category || !PRODUCT_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      category ? `unknown product category ${JSON.stringify(category)}` : 'category is required',
      'run `bk meta` for the current categories'
    )
  }

  const from = str(body?.price_from)
  const to = str(body?.price_to)
  if (from) requireMoney(from)
  if (to) requireMoney(to)

  // Migration 0011 — internal guidance (#27) and reach (#29).
  const internalMin = str(body?.internal_price_min)
  const internalMax = str(body?.internal_price_max)
  requireInternalPriceRange(internalMin, internalMax)
  const reach = str(body?.reach)
  if (reach) requireReach(reach)
  const externalUrl = str(body?.external_url)
  if (externalUrl) requireExternalUrl(externalUrl)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await createProduct(
    ctx.workspace.id,
    {
      category,
      name,
      // The price AS WRITTEN and the machine-readable half are separate fields
      // because half the catalogue is not a single number — "on request",
      // "CHF 4'800 + CHF 190/mo". Neither derives from the other.
      priceLabel: str(body?.price_label) ?? null,
      priceFrom: from ?? null,
      priceTo: to ?? null,
      currency: str(body?.currency)?.toUpperCase(),
      description: str(body?.description) ?? null,
      fit: strings(body?.fit),
      pitch: str(body?.pitch) ?? null,
      statusLabel: str(body?.status_label) ?? null,
      refs: strings(body?.refs),
      internalPriceMin: internalMin ?? null,
      internalPriceMax: internalMax ?? null,
      internalPriceNote: str(body?.internal_price_note) ?? null,
      reach,
      externalUrl: externalUrl ?? null,
    },
    actor
  )
  return NextResponse.json(publicProduct(row, ctx.workspace.slug), { status: 201 })
})
