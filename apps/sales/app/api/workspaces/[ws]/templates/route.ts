// GET  /api/workspaces/{ws}/templates — how we say it
// POST /api/workspaces/{ws}/templates — add one
//
// `variables` is PARSED FROM THE BODY on write and served back, so a caller
// knows what `render` will demand before it fails. It is never accepted as
// input: a declared list that could disagree with the body would make `render`
// validate against something the template does not contain.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createTemplate, listTemplates } from '@/lib/db/queries/catalog'
import { publicTemplate } from '@/lib/views'
import { TEMPLATE_NAME_MAX } from '@/lib/limits'
import { resolveStrategy } from '@/lib/api/strategy-ref'
import { bodyNumber, numberOr, requireMaxLength, requireStage, str } from '@/lib/http-input'
import { TEMPLATE_CATEGORY_VALUES, TEMPLATE_CHANNEL_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const channel = str(q.get('channel'))
  if (channel && !TEMPLATE_CHANNEL_VALUES.includes(channel)) {
    throw Errors.badRequest(
      'unknown_channel',
      `unknown template channel ${JSON.stringify(channel)}`,
      'run `bk meta` for the current values'
    )
  }
  const category = str(q.get('category'))
  if (category && !TEMPLATE_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      `unknown template category ${JSON.stringify(category)}`,
      'run `bk meta` for the current values'
    )
  }
  const stage = str(q.get('stage'))
  if (stage) requireStage(stage)

  // `?strategy=<n>`: only the messages written for that segment (#62). An
  // unknown #number is a 404, not an empty list — an empty list reads as "no
  // templates for it yet" when the truth is "no such strategy".
  const strategyId = await resolveStrategy(ctx.workspace.id, numberOr(q.get('strategy')))

  const rows = await listTemplates({
    workspaceId: ctx.workspace.id,
    channel,
    category,
    stage,
    strategyId,
    q: str(q.get('q')),
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
  })
  return jsonList(rows.map((t) => publicTemplate(t, ctx.workspace.slug)), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) throw Errors.badRequest('missing_name', 'name is required', 'pass --name "…"')
  requireMaxLength(name, TEMPLATE_NAME_MAX, 'name')

  const channel = str(body?.channel)
  if (!channel || !TEMPLATE_CHANNEL_VALUES.includes(channel)) {
    throw Errors.badRequest(
      'unknown_channel',
      channel ? `unknown template channel ${JSON.stringify(channel)}` : 'channel is required',
      'run `bk meta` for the current values'
    )
  }
  const category = str(body?.category)
  if (!category || !TEMPLATE_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      category ? `unknown template category ${JSON.stringify(category)}` : 'category is required',
      'run `bk meta` for the current values'
    )
  }
  const stage = str(body?.stage)
  if (stage) requireStage(stage)

  // The segment this message was written for (#62), by #number. Resolved to a
  // row id here — `strategy_id` is a serial and never crosses the wire.
  const strategyId = await resolveStrategy(ctx.workspace.id, bodyNumber(body?.strategy))

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await createTemplate(
    ctx.workspace.id,
    {
      channel,
      category,
      stage: stage ?? null,
      strategyId: strategyId ?? null,
      name,
      subject: str(body?.subject) ?? null,
      body: str(body?.body) ?? null,
    },
    actor
  )
  return NextResponse.json(publicTemplate(row, ctx.workspace.slug), { status: 201 })
})
