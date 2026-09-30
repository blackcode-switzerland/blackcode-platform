// GET /api/workspaces/{ws}/prospects/facets — the values the prospect filters can take
//
// The read half of the combinable filters (#98). City, sector and source are
// free text, so what is filterable is exactly what somebody — or Companion —
// wrote, and a caller (a web dropdown, an agent choosing `--city`) has to be
// able to ask what that is. Served from the data, never a list: a value written
// tomorrow is filterable tomorrow with no code change.
//
// Its own route rather than a field on the listing, because the listing is
// FILTERED and this must not be: the options in a dropdown may not shrink to the
// current result, or choosing one hides every other and the only way back is
// Clear (`components/catalog/catalog-pages.tsx` says the same about tags).
//
// A static segment beside `[n]`: Next resolves `facets` before the dynamic one,
// and `requireNumberParam` would 404 it anyway if that ever changed.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { prospectFacets } from '@/lib/db/queries/prospects'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return NextResponse.json(await prospectFacets(ctx.workspace.id))
})
