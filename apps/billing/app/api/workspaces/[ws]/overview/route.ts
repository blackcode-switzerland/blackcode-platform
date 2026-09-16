// GET /api/workspaces/{ws}/overview — `bk billing overview`
//
// The dashboard's aggregates, and the one thing to know about them is that the
// money figures are **per currency and never merged** (invariant I8). Adding CHF
// to EUR produces a number that is not money in any currency, and a dashboard
// that shows one is worse than a dashboard that shows nothing — because somebody
// will read it and act on it.
//
// So there is no `total_outstanding` field in the response. A caller wanting one
// number has to pick a currency, which is the decision this app declines to make
// on their behalf.
//
// Not in `lib/integration.ts`: it is a screen's aggregate, shaped for a screen,
// and an integration that depended on it would be depending on a layout.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getOverview } from '@/lib/db/queries/overview'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const company = req.nextUrl.searchParams.get('company') ?? undefined
  return NextResponse.json(await getOverview(ctx.workspace.id, company))
})
