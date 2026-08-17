// GET    /api/workspaces/{ws}/strategies/{n} — one segment, with its prospects
// PATCH  /api/workspaces/{ws}/strategies/{n} — edit it
// DELETE /api/workspaces/{ws}/strategies/{n} — bin it (soft, restorable)
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  getStrategyBySeq,
  listStrategyProspects,
  softDeleteStrategy,
  updateStrategy,
} from '@/lib/db/queries/strategies'
import { publicStrategy } from '@/lib/views'
import { STRATEGY_NAME_MAX } from '@/lib/limits'
import { nullableStr, requireMaxLength, requireNumberParam, str } from '@/lib/http-input'
import {
  parseProductNumbers,
  rethrowUnknownProducts,
} from '@/app/api/workspaces/[ws]/strategies/route'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'strategy_not_found',
    `no strategy #${seq} in this workspace`,
    'run `bk sales strategy list` for the numbers'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'strategy')
  const row = await getStrategyBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)

  // The prospects are part of the strategy, not a sub-resource: "which deals is
  // this segment running against" is the question somebody opens a strategy to
  // ask, and there is no view that wants one without the other. Same call the
  // prospect route makes for its journey and contacts.
  const prospects = await listStrategyProspects(ctx.workspace.id, row.id)
  return NextResponse.json({ ...publicStrategy(row, ctx.workspace.slug), prospects })
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'strategy')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (name) requireMaxLength(name, STRATEGY_NAME_MAX, 'name')

  const actor = await resolveActor(getDb(), req, ctx.user)
  const updated = await updateStrategy(
    ctx.workspace.id,
    seq,
    {
      name,
      // Three-way, like every other patchable field: `""` clears, absent leaves.
      vertical: nullableStr(body?.vertical),
      area: nullableStr(body?.area),
      rationale: nullableStr(body?.rationale),
      caseStudies: nullableStr(body?.case_studies),
      productNumbers: parseProductNumbers(body?.products),
    },
    actor
  ).catch(rethrowUnknownProducts)
  if (!updated) throw notFound(seq)
  return NextResponse.json(publicStrategy(updated, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'strategy')

  const actor = await resolveActor(getDb(), req, ctx.user)
  const binned = await softDeleteStrategy(ctx.workspace.id, seq, actor)
  if (!binned) throw notFound(seq)

  // `prospect_count` is reported back and it is not decoration: binning a
  // segment leaves N live deals pointing at a strategy that is no longer in the
  // listing, and the caller should learn that from the command rather than from
  // a prospect page three days later. The links are NOT cut — see
  // `softDeleteStrategy` for why a soft delete that detached them would be
  // unrestorable.
  return NextResponse.json({
    deleted: true,
    type: 'strategy',
    number: binned.seq,
    name: binned.name,
    prospect_count: binned.prospect_count,
  })
})
