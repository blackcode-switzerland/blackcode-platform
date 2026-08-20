// GET /api/workspaces/{ws}/openings — `bk books opening list`
// PUT /api/workspaces/{ws}/openings — `bk books opening set`
//
// The figures a book starts from. `queries/openings.ts` carries the doctrine;
// the short version is that only a book's FIRST fiscal year may be typed, and
// every later year's openings are produced by `bk books exercice close`.
//
// PUT, not POST, and deliberately: this replaces the whole set for the year.
// A balance sheet is one statement that must balance, not a list of rows to
// append to, and whole-set replacement is what lets the door refuse an
// unbalanced migration on the day somebody types it.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveScope } from '@/lib/db/queries/statutory'
import { listOpenings, setOpenings, OpeningRefused, type OpeningLine } from '@/lib/db/queries/openings'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(
    ctx.workspace.id,
    q.get('entity'),
    q.get('exercice') ? Number(q.get('exercice')) : null
  )
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const rows = await listOpenings(scope.entity.id, scope.exercice.id)
  // The book and year are echoed on every row: the caller may have taken the
  // default scope and a bare list of numbers would not say which year it is.
  return jsonList(
    rows.map((r) => ({
      entity: scope.entity.slug,
      exercice: scope.exercice.year,
      account: r.account_no,
      amount: r.amount,
    }))
  )
})

export const PUT = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books opening set --file <balances.json>')

  const scope = await resolveScope(
    ctx.workspace.id,
    typeof body.entity === 'string' ? body.entity : null,
    body.exercice != null ? Number(body.exercice) : null
  )
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const raw = body.balances
  if (!Array.isArray(raw)) {
    throw Errors.badRequest(
      'missing_balances',
      'balances must be an array of { account, amount }',
      'an empty array is allowed and clears the year'
    )
  }
  const lines: OpeningLine[] = raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    const account = typeof o.account === 'string' ? o.account.trim() : ''
    const amount =
      typeof o.amount === 'string' ? o.amount.trim() : typeof o.amount === 'number' ? o.amount.toFixed(2) : ''
    if (!account || !amount) {
      throw Errors.badRequest(
        'bad_balance_row',
        `balances[${i}] needs both an account and an amount`,
        '{ "account": "1020", "amount": "15000.00" }'
      )
    }
    return { account, amount }
  })

  try {
    const r = await setOpenings(ctx.workspace.id, scope.entity.id, scope.exercice, lines)
    return NextResponse.json({
      entity: scope.entity.slug,
      exercice: scope.exercice.year,
      ...r,
    })
  } catch (e) {
    if (e instanceof OpeningRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
