// POST /api/workspaces/{ws}/entries/{number}/post — `bk books entry post`
//
// Write path #4 of the spec: staged -> posted, after review. This route flips
// ONE column; the 0004 guard has the last word at COMMIT (balanced, at least
// two lines, every line mapped). Posted is immutable — from here on, a
// correction is a reversing entry.
//
// Idempotent: posting a posted entry reports `already: true` rather than
// refusing, because the Companion retries and a retry is not an error.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { postEntry, PostRefused, sqlErrorText } from '@/lib/db/queries/imports'

interface Params { params: Promise<{ ws: string; number: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not an entry number`, 'from `bk books entry list`')
  }

  try {
    const r = await postEntry(ctx.workspace.id, n)
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof PostRefused) {
      if (e.code === 'entry_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    // 0004's deferred guard speaks at COMMIT in Postgres's words — which
    // drizzle wraps, so the sentence sits on the CAUSE CHAIN, not on
    // `e.message` (that one says "Failed query: COMMIT" and nothing else).
    // Found live by the frontend review: an unbalanced post answered a bare
    // 500 on every surface while psql said "entry 1272 does not balance".
    const msg = sqlErrorText(e)
    if (/does not balance|cannot be posted/.test(msg)) {
      const line = msg.split('\n').find((l) => /does not balance|cannot be posted/.test(l)) ?? msg
      throw Errors.badRequest('guard_refused', line.replace(/^.*?(entry \d+)/, '$1').trim(), 'resolve the lines, then post')
    }
    throw e
  }
})
