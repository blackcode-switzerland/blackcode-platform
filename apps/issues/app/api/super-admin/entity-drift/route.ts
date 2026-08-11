// The reconciliation job (Phase 6) — re-derive `platform.entities` from this
// app's source tables and report the difference.
//
// WHY THIS SHIPS IN THE SAME PHASE AS THE PROJECTION, not later.
//
// Phase 3 failed loudly, Phase 4 failed quietly, Phase 6 fails SLOWLY. A write
// path that forgets to project breaks nothing today: search returns a slightly
// stale set, activity misses an entry, and by the time anyone notices you cannot
// tell which rows are wrong or when they went wrong. There is no exception to
// catch and no 500 to alert on — so the only way to know is to ask.
//
// It is built NOW because there is exactly one writer. That is the only window in
// which a difference this reports is unambiguously a bug in that writer rather
// than a race with another one. Written after a second app exists, its first run
// would report a pile of drift of unknown age and unknown cause.
//
// READ A REPAIR AS A BUG REPORT. `?repair=1` is safe to run at any time — it
// performs the same upsert the write paths do — but it is not routine
// maintenance. If it fixes something, a write path is wrong; find it.
//
// Super-admin gated because it reads every workspace. `?ws=<slug>` narrows it.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { reconcileEntities } from '@/lib/db/queries/entities'
import { getWorkspaceBySlug } from '@/lib/db/queries/workspaces'

/** How many drift rows the response lists before it just reports the count. */
const MAX_LISTED = 200

async function run(req: NextRequest, repair: boolean) {
  await requireSuperAdminUser(req)
  const wsRef = req.nextUrl.searchParams.get('ws')

  let workspaceId: number | null = null
  if (wsRef) {
    const ws = await getWorkspaceBySlug(wsRef)
    if (!ws) {
      throw Errors.notFound(
        'workspace_not_found',
        `no workspace with slug ${wsRef}`,
        'run `bk issues workspace list` to see every workspace'
      )
    }
    workspaceId = ws.id
  }

  const result = await reconcileEntities({ workspaceId, repair })

  // Truncation is REPORTED, never silent. A response that quietly listed the
  // first 200 of 4000 would read as "we found 200 problems", which is a
  // different and much more comfortable fact than the true one.
  const truncated = result.drift.length > MAX_LISTED
  return NextResponse.json({
    scope: wsRef ?? 'all workspaces',
    source_counts: result.source_counts,
    projected_counts: result.projected_counts,
    counts_match:
      JSON.stringify(result.source_counts) === JSON.stringify(result.projected_counts),
    drift_count: result.drift.length,
    drift: result.drift.slice(0, MAX_LISTED),
    drift_truncated: truncated ? result.drift.length - MAX_LISTED : 0,
    repaired: result.repaired,
  })
}

/** Report drift. Read-only — never writes, however bad the news is. */
export const GET = apiHandler(async (req: NextRequest) => run(req, false))

/** Report AND repair. See the note above: a repair means something is broken. */
export const POST = apiHandler(async (req: NextRequest) => run(req, true))
