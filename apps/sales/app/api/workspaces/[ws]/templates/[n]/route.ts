// GET    /api/workspaces/{ws}/templates/{n}
// PATCH  /api/workspaces/{ws}/templates/{n}
// DELETE /api/workspaces/{ws}/templates/{n} — bin it
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getTemplateBySeq, softDeleteTemplate, updateTemplate } from '@/lib/db/queries/catalog'
import { publicTemplate } from '@/lib/views'
import { TEMPLATE_NAME_MAX } from '@/lib/limits'
import { resolveStrategy } from '@/lib/api/strategy-ref'
import {
  bodyNumber,
  nullableStr,
  requireMaxLength,
  requireNumberParam,
  requireStage,
  str,
} from '@/lib/http-input'
import { TEMPLATE_CATEGORY_VALUES, TEMPLATE_CHANNEL_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'template_not_found',
    `no template #${seq} in this workspace`,
    'run `bk sales template list` for the numbers'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'template')
  const row = await getTemplateBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)
  return NextResponse.json(publicTemplate(row, ctx.workspace.slug))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'template')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (name) requireMaxLength(name, TEMPLATE_NAME_MAX, 'name')
  const channel = str(body?.channel)
  if (channel && !TEMPLATE_CHANNEL_VALUES.includes(channel)) {
    throw Errors.badRequest(
      'unknown_channel',
      `unknown template channel ${JSON.stringify(channel)}`,
      'run `bk meta` for the current values'
    )
  }
  const category = str(body?.category)
  if (category && !TEMPLATE_CATEGORY_VALUES.includes(category)) {
    throw Errors.badRequest(
      'unknown_category',
      `unknown template category ${JSON.stringify(category)}`,
      'run `bk meta` for the current values'
    )
  }
  const stage = nullableStr(body?.stage)
  if (typeof stage === 'string') requireStage(stage)

  // `strategy` is three-way like the rest: `null` unlinks, a #number links,
  // absent leaves it alone (#62) — the exact contract `PATCH …/prospects/{n}`
  // gives `strategy`, so the two read alike.
  let strategyId: number | null | undefined
  if (body?.strategy === null) {
    strategyId = null
  } else if (body?.strategy !== undefined) {
    strategyId = await resolveStrategy(ctx.workspace.id, bodyNumber(body.strategy))
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateTemplate(
    ctx.workspace.id,
    seq,
    {
      name,
      channel,
      category,
      stage,
      strategyId,
      subject: nullableStr(body?.subject),
      body: nullableStr(body?.body),
    },
    actor
  )
  if (!row) throw notFound(seq)
  return NextResponse.json(publicTemplate(row, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'template')

  const existing = await getTemplateBySeq(ctx.workspace.id, seq)
  if (!existing) throw notFound(seq)

  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'binning a template requires its name repeated back',
      `pass --confirm ${JSON.stringify(existing.name)}`
    )
  }
  if (confirm !== existing.name) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name template #${seq}`,
      `#${seq} is ${JSON.stringify(existing.name)}`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await softDeleteTemplate(ctx.workspace.id, seq, actor)
  if (!row) throw notFound(seq)
  return NextResponse.json({ deleted: true, type: 'template', number: row.seq, name: row.name })
})
