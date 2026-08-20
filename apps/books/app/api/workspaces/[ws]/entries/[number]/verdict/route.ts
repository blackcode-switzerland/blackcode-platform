// POST /api/workspaces/{ws}/entries/{number}/verdict — `bk books verdict`
//
// The Devil's Advocate's door — the eighth write, and the third built for an
// outside process. An external agent pass reads the rules and the records and
// files a structured verdict back: accepted, accepted_with_warning, or
// blocked, with the rules that triggered, the worst case, and what would
// resolve it. It NEVER corrects the record; the one enforced consequence
// (blocked refuses to post) lives in the posting path.
//
// History-first like resolve: a verdict that replaces an earlier one leaves
// the earlier one in the trail.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace, appContext } from '@/lib/api'
import { ComplianceRefused, recordVerdict, type VerdictData } from '@/lib/db/queries/compliance'

interface Params { params: Promise<{ ws: string; number: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const user = await appContext.resolveUser(req)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', 'number must be a positive integer', 'the entry list shows the numbers')
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books verdict')

  try {
    const r = await recordVerdict(ctx.workspace.id, n, {
      entity: typeof body.entity === 'string' ? body.entity : null,
      verdict: body.verdict as VerdictData['verdict'],
      rules: Array.isArray(body.rules) ? (body.rules as string[]) : [],
      worstCase: body.worst_case,
      resolves: body.resolves,
      by: user?.email ?? 'unknown caller',
    })
    return NextResponse.json(r, { status: 201 })
  } catch (e) {
    if (e instanceof ComplianceRefused) {
      if (e.code.endsWith('not_found')) throw Errors.notFound(e.code, e.message)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
