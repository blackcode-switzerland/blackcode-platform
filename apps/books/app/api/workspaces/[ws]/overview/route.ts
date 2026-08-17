// GET /api/workspaces/{ws}/overview — `bk books overview`
//
// One row per book, carrying whichever statement its legal form actually has.
//
// `bilan` and `ri` are separate nullable fields rather than one polymorphic
// `result`, because an RI has no balance sheet and a shared shape would invite a
// caller to render one.
//
// `unrecognized` is the Reconnaissance worklist's count: entries where money moved
// and nobody has yet said what it was for.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getOverview } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const books = await getOverview(ctx.workspace.id)
  return NextResponse.json({ books })
})
