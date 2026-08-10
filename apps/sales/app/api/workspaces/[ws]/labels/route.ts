// GET  /api/workspaces/{ws}/labels — this app's labels
// POST /api/workspaces/{ws}/labels — create one
//
// The table is `sales.labels` (Phase 3). It used to be `platform.labels` with an
// `app` column and a predicate on every read; the predicate is gone because the
// table cannot hold another app's row. `app` is still a FIELD on the wire,
// answered with this app's slug — see `publicLabel` in lib/views.ts.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createLabel, listLabels } from '@/lib/db/queries/labels'
import { publicLabel } from '@/lib/views'
import { str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return jsonList((await listLabels(ctx.workspace.id)).map(publicLabel), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) throw Errors.badRequest('missing_name', 'name is required', 'pass --name "…"')

  const color = str(body?.color)
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw Errors.badRequest(
      'invalid_color',
      `color must be a #rrggbb hex value, got ${JSON.stringify(color)}`,
      'e.g. --color "#10a37f"'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await createLabel(
    ctx.workspace.id,
    { name, color, description: str(body?.description) ?? null },
    actor
  )
  return NextResponse.json(publicLabel({ ...row, usage: 0 }), { status: 201 })
})
