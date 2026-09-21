// GET   /api/workspaces/{ws}/recurrences/{seq} — `bk billing recurrence show`
// PATCH /api/workspaces/{ws}/recurrences/{seq} — `bk billing recurrence edit`, `pause`, `resume`
//
// No DELETE, and there will not be one: a series is the record of what was
// agreed, and its invoices point at it. To end one early, lower
// `occurrences_total` to what is done.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { authVia } from '@/lib/api/actor'
import { refusalToApiError } from '@/lib/api/refusal'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { editRecurrence, getRecurrence } from '@/lib/db/queries/recurrences'
import { seriesSeq } from '@/lib/api/series-ref'

interface Params {
  params: Promise<{ ws: string; seq: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, seq } = await params
  const ctx = await resolveWorkspace(req, ws)
  const rec = await getRecurrence(ctx.workspace.id, seriesSeq(seq))
  if (!rec) throw Errors.notFound('recurrence_not_found', `no series #${seq} in this workspace`, 'bk billing recurrence list')
  return NextResponse.json(rec)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, seq } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  try {
    const rec = await editRecurrence({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, via: authVia(req) }, seriesSeq(seq), body)
    return NextResponse.json(rec)
  } catch (e) {
    if (e instanceof InvoiceRefused) throw refusalToApiError(e)
    throw e
  }
})
