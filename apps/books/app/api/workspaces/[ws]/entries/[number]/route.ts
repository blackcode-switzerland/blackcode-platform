// GET /api/workspaces/{ws}/entries/{number} — `bk books entry show`
//
// `{number}` is the workspace #number (`seq`), never the serial `id`. The payload
// also carries `entry_no`, the statutory journal number, because a reader
// comparing against a filing needs that one instead.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntryByNumber, publicEntry } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', 'number must be a positive integer', 'try `bk books entry list` for the numbers')
  }
  const found = await getEntryByNumber(ctx.workspace.id, n)
  if (!found) throw Errors.notFound('entry_not_found', `no entry #${n} in this workspace`)
  return NextResponse.json(publicEntry(found))
})
