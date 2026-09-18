// GET  /api/workspaces/{ws}/history — `bk billing history list`
// POST /api/workspaces/{ws}/history — `bk billing history import`
//
// The archive of bills issued before this app existed (phase 5). Neither route
// is in `lib/integration.ts`' public list: an import is a one-off an agent runs
// for the business that owns the archive, not something an outside system
// integrates against.
//
// ── THE POST IS ALL OR NOTHING ─────────────────────────────────────────────
// Every row is checked, every problem is reported at once, and one refused row
// means nothing is written. A row already in the archive is a 409 naming its
// #number rather than a skip — see lib/db/queries/history.ts for why a silent
// skip would make the import's own count a lie.
//
// No Idempotency-Key, deliberately: the unique index on (source, source_ref)
// already makes a retry of an import that committed answer "already imported",
// naming every row, and a second mechanism would be a second opinion about the
// same fact.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { authVia } from '@/lib/api/actor'
import { HistoryRefused, importHistory, listHistory } from '@/lib/db/queries/history'
import { HISTORY_SOURCES } from '@/lib/vocabularies'
import { LIST_LIMIT_MAX } from '@/lib/limits'
import { companyFilter } from '@/lib/api/company-filter'
import type { HistorySource } from '@/types'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  // Every filter is refused rather than ignored when it is not understood. A
  // dropped filter returns everything, which reads as "these are the flagged
  // ones" when it means "your filter was not understood".
  const source = q.get('source')
  if (source && !HISTORY_SOURCES.some((s) => s.value === source)) {
    throw Errors.badRequest(
      'invalid_source',
      `${source} is not a history source`,
      `one of ${HISTORY_SOURCES.map((s) => s.value).join(', ')} — run \`bk meta --app-server billing\``
    )
  }
  const year = q.get('year')
  if (year !== null && !/^\d{4}$/.test(year)) {
    throw Errors.badRequest('invalid_year', 'year is a four-digit calendar year', 'e.g. year=2021')
  }
  const flagged = q.get('flagged')
  if (flagged !== null && flagged !== 'true' && flagged !== 'false') {
    throw Errors.badRequest('invalid_flagged', 'flagged is true or false', 'flagged=true lists only rows carrying an import flag')
  }
  const limitRaw = q.get('limit')
  if (limitRaw !== null && !/^\d+$/.test(limitRaw)) {
    throw Errors.badRequest('invalid_limit', 'limit is a whole number', `1 to ${LIST_LIMIT_MAX}`)
  }
  const cursorRaw = q.get('cursor')
  if (cursorRaw !== null && !/^\d+$/.test(cursorRaw)) {
    throw Errors.badRequest('invalid_cursor', 'cursor is the next_cursor the previous page returned', 'drop it to start from the newest')
  }

  try {
    const page = await listHistory(ctx.workspace.id, {
      source: (source as HistorySource) ?? undefined,
      currency: q.get('currency')?.toUpperCase() ?? undefined,
      year: year !== null ? Number(year) : undefined,
      flagged: flagged === 'true',
      company: await companyFilter(ctx.workspace.id, q.get('company')),
      limit: limitRaw ? Number(limitRaw) : undefined,
      cursor: cursorRaw !== null ? Number(cursorRaw) : undefined,
    })
    return jsonList(page.data, page.next_cursor)
  } catch (e) {
    if (e instanceof HistoryRefused) throw refusalToApiError(e)
    throw e
  }
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  try {
    const result = await importHistory(
      { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, via: authVia(req) },
      body
    )
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof HistoryRefused) throw refusalToApiError(e)
    throw e
  }
})
