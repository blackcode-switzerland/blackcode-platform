// The blob-reference reconciliation job (Phase 8) — re-derive this app's rows in
// `platform.blob_references` from a live scan and report the difference.
//
// The sibling of `entity-drift`, and the more important of the two. Entity drift
// costs a stale search result. Blob-reference drift in the `missing` direction
// costs a FILE: another deployment consults the index, sees no reference, and
// calls `del()`, which has no undo. See `lib/storage/drift.ts` for why the index
// is trigger-maintained and what that buys.
//
// This is also the only place the trigger mechanism is ever checked against
// reality. Every future app will have the index and no scanner; `issues` has
// both. So this route is the standing proof, run by the one app that can run it,
// that the thing every other app depends on actually works.
//
// READ A REPAIR AS A BUG REPORT. `?repair=1` re-triggers the source rows (and
// purges true orphans), which is safe at any time — but a repair that changes
// something means a trigger did not fire, and that is a fault in the schema, not
// a chore. Find out which one.
//
// Super-admin gated because it reads every workspace. `?ws=<slug>` narrows it.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { reconcileBlobReferences } from '@/lib/storage/drift'
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

  const result = await reconcileBlobReferences({ workspaceId, repair })

  // The two kinds are counted separately because they are not the same news.
  // A single `missing` row is a file at risk; a hundred `orphaned` ones are
  // leaked bytes. A single "drift_count" would flatten that distinction away.
  const missing = result.drift.filter((d) => d.kind === 'missing').length
  const orphaned = result.drift.length - missing

  // Truncation is REPORTED, never silent — the same rule as entity-drift.
  const truncated = result.drift.length > MAX_LISTED
  return NextResponse.json({
    scope: wsRef ?? result.scope,
    scanned_counts: result.scanned_counts,
    indexed_counts: result.indexed_counts,
    missing_count: missing,
    orphaned_count: orphaned,
    drift_count: result.drift.length,
    // Rows the reconciliation could not reach at all. Reported next to the drift
    // counts rather than buried, because a zero drift_count over a partial index
    // is the most reassuring wrong answer this route can give.
    unreconciled_count: result.unreconciled,
    // `missing` first: it is the direction that loses data, so it must be what
    // a truncated list shows.
    drift: [...result.drift].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'missing' ? -1 : 1)).slice(0, MAX_LISTED),
    drift_truncated: truncated ? result.drift.length - MAX_LISTED : 0,
    repaired: result.repaired,
  })
}

/** Report drift. Read-only — never writes, however bad the news is. */
export const GET = apiHandler(async (req: NextRequest) => run(req, false))

/** Report AND repair. See the note above: a repair means something is broken. */
export const POST = apiHandler(async (req: NextRequest) => run(req, true))
