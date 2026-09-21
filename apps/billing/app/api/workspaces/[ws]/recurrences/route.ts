// GET  /api/workspaces/{ws}/recurrences — `bk billing recurrence list [--due]`
// POST /api/workspaces/{ws}/recurrences — `bk billing recurrence create`
//
// A series is a FINITE rule stored as data (phase 4, invariant I9). Nothing in
// this app fires on it: `?due=true` is the whole discovery mechanism, and the
// agent that reads it is what asks for the next occurrence.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { authVia } from '@/lib/api/actor'
import { companyFilter } from '@/lib/api/company-filter'
import { withIdempotency } from '@/lib/api/idempotency'
import { refusalToApiError } from '@/lib/api/refusal'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { createRecurrence, listRecurrences } from '@/lib/db/queries/recurrences'
import { LIST_LIMIT_MAX } from '@/lib/limits'
import { RECURRENCE_STATUSES } from '@/lib/vocabularies'
import type { RecurrenceStatus } from '@/types'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const status = q.get('status')
  if (status && !RECURRENCE_STATUSES.some((s) => s.value === status)) {
    throw Errors.badRequest(
      'invalid_status',
      `${status} is not a series status`,
      `one of ${RECURRENCE_STATUSES.map((s) => s.value).join(', ')} — run \`bk meta --app-server billing\``
    )
  }
  // `due` is a boolean and is refused otherwise: `?due=yes` silently meaning
  // "all series" would read as "everything is due".
  const due = q.get('due')
  if (due !== null && due !== 'true' && due !== 'false') {
    throw Errors.badRequest('invalid_due', 'due is true or false', 'bk billing recurrence list --due')
  }
  for (const k of ['limit', 'cursor'] as const) {
    const v = q.get(k)
    if (v !== null && !/^\d+$/.test(v)) {
      throw Errors.badRequest(`invalid_${k}`, `${k} is a whole number`, k === 'limit' ? `1 to ${LIST_LIMIT_MAX}` : 'pass the next_cursor the previous page returned')
    }
  }

  const page = await listRecurrences(ctx.workspace.id, {
    company: await companyFilter(ctx.workspace.id, q.get('company')),
    status: (status as RecurrenceStatus) ?? undefined,
    due: due === 'true',
    limit: q.get('limit') ? Number(q.get('limit')) : undefined,
    cursor: q.get('cursor') ? Number(q.get('cursor')) : undefined,
  })
  return jsonList(page.data, page.next_cursor)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  return withIdempotency(req, ctx.workspace.id, body, async () => {
    try {
      const rec = await createRecurrence({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, via: authVia(req) }, body)
      return NextResponse.json(rec, { status: 201 })
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
