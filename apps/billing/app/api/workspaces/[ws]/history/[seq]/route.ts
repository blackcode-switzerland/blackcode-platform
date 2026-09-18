// GET /api/workspaces/{ws}/history/{seq} — `bk billing history show`
//
// One imported bill by its #number. There is no PATCH and no DELETE, and there
// will not be: the row is an archive entry, and the database refuses both even
// to the owner (migration 0010).
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getHistory } from '@/lib/db/queries/history'

interface Params {
  params: Promise<{ ws: string; seq: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, seq } = await params
  const ctx = await resolveWorkspace(req, ws)
  // Only the #number. The historical number is NOT an address here: it is not
  // unique (two companies, two systems), and resolving it would pick one of
  // several bills silently.
  if (!/^\d+$/.test(seq)) {
    throw Errors.badRequest(
      'invalid_history_ref',
      `${seq} is not an imported bill's #number`,
      'bk billing history list shows the #number; the historical number is not unique, so it is not an address'
    )
  }
  const entry = await getHistory(ctx.workspace.id, Number(seq))
  if (!entry) {
    throw Errors.notFound('history_not_found', `no imported bill #${seq} in this workspace`, 'bk billing history list')
  }
  return NextResponse.json(entry)
})
