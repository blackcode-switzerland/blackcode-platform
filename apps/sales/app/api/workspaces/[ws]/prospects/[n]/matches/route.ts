// GET    /api/workspaces/{ws}/prospects/{n}/matches — the triangulation
// POST   /api/workspaces/{ws}/prospects/{n}/matches — record one (upsert)
// DELETE /api/workspaces/{ws}/prospects/{n}/matches — clear one
//
//   ┌────────────────────────────────────────────────────────────────────────┐
//   │ THIS ROUTE STORES A JUDGEMENT. IT DOES NOT MAKE ONE.                   │
//   └────────────────────────────────────────────────────────────────────────┘
//
// Which product suits this client and which message to lead with is the one
// thing in this app that is genuinely judgement rather than arithmetic
// (`docs/backend.md` §1). The agent decides and POSTs the answer; a live
// recommender in the app contradicts the doctrine and doubles the surface (§2).
// If you are here to add "recompute", read `schema.ts` at `matches` first.
//
// POST is an UPSERT on (prospect, product), so re-running the triangulation
// replaces the verdict instead of accumulating three contradictory ones.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { clearMatch, listMatches, prospectIdBySeq, setMatch } from '@/lib/db/queries/prospect-children'
import { getProductBySeq, getTemplateBySeq } from '@/lib/db/queries/catalog'
import { publicMatch } from '@/lib/views'
import { bodyNumber, numberOr, requireNumberParam, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

async function requireProspect(workspaceId: number, raw: string): Promise<number> {
  const seq = requireNumberParam(raw, 'prospect')
  const id = await prospectIdBySeq(workspaceId, seq)
  if (id == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return id
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  return jsonList((await listMatches(ctx.workspace.id, prospectId)).map(publicMatch), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const productNumber = bodyNumber(body?.product)
  if (productNumber == null) {
    throw Errors.badRequest(
      'missing_product',
      'product is required (its #number)',
      'run `bk sales product list` for the numbers'
    )
  }
  const product = await getProductBySeq(ctx.workspace.id, productNumber)
  if (!product) {
    throw Errors.notFound(
      'product_not_found',
      `no product #${productNumber} in this workspace`,
      'run `bk sales product list` for the numbers'
    )
  }

  let templateId: number | null = null
  const templateNumber = bodyNumber(body?.template)
  if (templateNumber != null) {
    // `tpl`, not `template`. A local called `template` produces `template.id`,
    // which the cross-schema guard reads as a reference to the `template` app's
    // Postgres schema — the scaffold's slug and this app's entity name are the
    // same word. Renaming the variable is the cheap half of that collision; the
    // rest is reported in the phase notes rather than worked around here.
    const tpl = await getTemplateBySeq(ctx.workspace.id, templateNumber)
    if (!tpl) {
      throw Errors.notFound(
        'template_not_found',
        `no template #${templateNumber} in this workspace`,
        'run `bk sales template list` for the numbers'
      )
    }
    templateId = tpl.id
  }

  const fitRaw = body?.fit
  const fit = fitRaw == null ? null : Number(fitRaw)
  if (fit != null && (!Number.isInteger(fit) || fit < 0 || fit > 100)) {
    throw Errors.badRequest(
      'invalid_fit',
      `fit must be a whole number from 0 to 100, got ${JSON.stringify(fitRaw)}`,
      'it is a percentage, not a measurement'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  await setMatch(
    ctx.workspace.id,
    prospectId,
    { productId: product.id, fit, templateId, why: str(body?.why) ?? null },
    actor
  )
  const rows = await listMatches(ctx.workspace.id, prospectId)
  const created = rows.find((r) => r.product_id === product.id)
  return NextResponse.json(created ? publicMatch(created) : { ok: true }, { status: 201 })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)

  const productNumber = numberOr(req.nextUrl.searchParams.get('product'))
  if (productNumber == null) {
    throw Errors.badRequest(
      'missing_product',
      'product is required (its #number)',
      'run `bk sales match list <prospect>` to see which products are matched'
    )
  }
  const product = await getProductBySeq(ctx.workspace.id, productNumber)
  if (!product) {
    throw Errors.notFound(
      'product_not_found',
      `no product #${productNumber} in this workspace`,
      'run `bk sales product list` for the numbers'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const removed = await clearMatch(ctx.workspace.id, prospectId, product.id, actor)
  if (!removed) {
    throw Errors.notFound(
      'match_not_found',
      `no match between this prospect and product #${productNumber}`,
      'run `bk sales match list <prospect>` to see what is matched'
    )
  }
  return NextResponse.json({ deleted: true, type: 'match', product: productNumber })
})
