// GET    /api/workspaces/{ws}/labels/{id}
// PATCH  /api/workspaces/{ws}/labels/{id}
// DELETE /api/workspaces/{ws}/labels/{id}
//
// `{id}` is the label's row id, and here that IS the address: a label is a
// `sales.labels` row with no per-workspace #number, and `bk <app> label` has
// always addressed it that way. Since Phase 3 the ids are this app's own
// serials, so an id from another app is simply not a row here — a 404 by
// existence rather than by a scope predicate.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { deleteLabel, getLabel, updateLabel } from '@/lib/db/queries/labels'
import { publicLabel } from '@/lib/views'
import { nullableStr, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

function labelId(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw Errors.notFound(
      'label_not_found',
      `${JSON.stringify(raw)} is not a label id`,
      'run `bk sales label list` for the ids'
    )
  }
  return n
}

const notFound = (id: number) =>
  Errors.notFound(
    'label_not_found',
    `no label ${id} in this workspace`,
    'run `bk sales label list` for the ids'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const ctx = await resolveWorkspace(req, ws)
  const lid = labelId(id)
  const row = await getLabel(ctx.workspace.id, lid)
  if (!row) throw notFound(lid)
  return NextResponse.json(publicLabel(row))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const ctx = await resolveWorkspace(req, ws)
  const lid = labelId(id)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const color = str(body?.color)
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw Errors.badRequest(
      'invalid_color',
      `color must be a #rrggbb hex value, got ${JSON.stringify(color)}`,
      'e.g. --color "#10a37f"'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateLabel(
    ctx.workspace.id,
    lid,
    { name: str(body?.name), color, description: nullableStr(body?.description) },
    actor
  )
  if (!row) throw notFound(lid)
  const full = await getLabel(ctx.workspace.id, lid)
  return NextResponse.json(publicLabel(full!))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const ctx = await resolveWorkspace(req, ws)
  const lid = labelId(id)
  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await deleteLabel(ctx.workspace.id, lid, actor)
  if (!row) throw notFound(lid)
  // Attachments cascade with the label. A label is metadata, so removing it
  // removes the metadata and nothing else — no prospect is touched.
  return NextResponse.json({ deleted: true, type: 'label', id: row.id, name: row.name })
})
