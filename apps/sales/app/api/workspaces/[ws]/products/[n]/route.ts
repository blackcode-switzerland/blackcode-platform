// GET    /api/workspaces/{ws}/products/{n}
// PATCH  /api/workspaces/{ws}/products/{n}
// DELETE /api/workspaces/{ws}/products/{n} — bin it
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getProductBySeq, softDeleteProduct, updateProduct } from '@/lib/db/queries/catalog'
import { publicProduct } from '@/lib/views'
import { PRODUCT_NAME_MAX } from '@/lib/limits'
import { nullableStr, requireMaxLength, requireMoney, requireNumberParam, str } from '@/lib/http-input'
import { PRODUCT_CATEGORY_VALUES } from '@/lib/pipeline'
import {
  requireExternalUrl,
  requireInternalPriceRange,
  requireReach,
} from '@/lib/api/product-fields'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'product_not_found',
    `no product #${seq} in this workspace`,
    'run `bk sales product list` for the numbers'
  )

const strings = (v: unknown): string[] | null | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : null

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'product')
  const row = await getProductBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)
  return NextResponse.json(publicProduct(row, ctx.workspace.slug))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'product')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (name) requireMaxLength(name, PRODUCT_NAME_MAX, 'name')
  const category = str(body?.category)
  if (category && !PRODUCT_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      `unknown product category ${JSON.stringify(category)}`,
      'run `bk meta` for the current categories'
    )
  }
  const from = nullableStr(body?.price_from)
  const to = nullableStr(body?.price_to)
  if (from) requireMoney(from)
  if (to) requireMoney(to)

  // Migration 0011. Three-way like the rest — `--internal-price-min ""` clears
  // the floor, omitting it leaves it. The ordering check reads the INCOMING
  // values only, so clearing one end never trips it.
  const internalMin = nullableStr(body?.internal_price_min)
  const internalMax = nullableStr(body?.internal_price_max)
  requireInternalPriceRange(internalMin, internalMax)
  const reach = str(body?.reach)
  if (reach) requireReach(reach)
  const externalUrl = nullableStr(body?.external_url)
  if (externalUrl) requireExternalUrl(externalUrl)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateProduct(
    ctx.workspace.id,
    seq,
    {
      name,
      category,
      priceLabel: nullableStr(body?.price_label),
      priceFrom: from,
      priceTo: to,
      currency: str(body?.currency)?.toUpperCase(),
      description: nullableStr(body?.description),
      fit: strings(body?.fit),
      pitch: nullableStr(body?.pitch),
      statusLabel: nullableStr(body?.status_label),
      refs: strings(body?.refs),
      internalPriceMin: internalMin,
      internalPriceMax: internalMax,
      internalPriceNote: nullableStr(body?.internal_price_note),
      reach,
      externalUrl,
    },
    actor
  )
  if (!row) throw notFound(seq)
  return NextResponse.json(publicProduct(row, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'product')

  const existing = await getProductBySeq(ctx.workspace.id, seq)
  if (!existing) throw notFound(seq)

  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'binning a product requires its name repeated back',
      `pass --confirm ${JSON.stringify(existing.name)}`
    )
  }
  if (confirm !== existing.name) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name product #${seq}`,
      `#${seq} is ${JSON.stringify(existing.name)}`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await softDeleteProduct(ctx.workspace.id, seq, actor)
  if (!row) throw notFound(seq)
  return NextResponse.json({ deleted: true, type: 'product', number: row.seq, name: row.name })
})
