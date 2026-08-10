// Workspace storage management (owner-only): list every file uploaded into the
// workspace, with what currently references each one and the workspace's total
// usage. This is the data behind the Storage settings page and `bk storage list`.
//
// References are computed by a live scan of every registered app's content
// INCLUDING trashed items, so a file shown with 0 references is genuinely an
// orphan and safe to delete. Deletion itself re-checks at delete time — see
// ./[id]/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { listWorkspaceUploads, computeWorkspaceStorageUsage } from '@/lib/db/queries/uploads'
import { getWorkspaceById } from '@/lib/db/queries/workspaces'
import { computeWorkspaceReferences } from '@/lib/storage'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  // `?app=` filters the LEDGER to one app's files. Usage stays workspace-wide
  // and unfiltered on purpose: the quota belongs to the workspace, not to an
  // app, and a total that shrank with a filter would read as free space.
  const app = req.nextUrl.searchParams.get('app')

  // `storage_limit_bytes` is read from the row rather than from `ctx.workspace`
  // as of 2026-08-10. `WorkspaceContext.workspace` narrowed to the five columns
  // every app's workspace table has, and a per-workspace storage quota is not
  // one of them — `sales.workspaces` deliberately has no such column, because a
  // quota over ONE shared Blob store is not a per-app fact. Same column, same
  // workspace, same `?? null`; one extra primary-key lookup, run in parallel so
  // it costs no latency. See packages/platform-api/src/workspace-source.ts.
  const [rows, refMap, usageBytes, wsRow] = await Promise.all([
    listWorkspaceUploads(ctx.workspace.id, { app }),
    computeWorkspaceReferences(ctx.workspace.id),
    computeWorkspaceStorageUsage(ctx.workspace.id),
    getWorkspaceById(ctx.workspace.id),
  ])

  const data = rows.map((u) => {
    const references = refMap.get(u.url) ?? []
    return {
      id: u.id,
      // Which app wrote the file. NULL only for rows written in the window
      // between migration 0036 and the deploy that stamps it — the backfill
      // covers everything older.
      app: u.app,
      url: u.url,
      filename: u.filename,
      // `size` is a bigint, and a raw-SQL read hands bigints back as STRINGS —
      // Drizzle's `mode: 'number'` only applies to the query builder. Serialised
      // unconverted, it made `bk storage list` fail to decode for every
      // workspace holding a sized file (found 2026-08-05; the bug predates
      // Phase 7 and is not caused by it). The web page survived only because JS
      // coerces a string in arithmetic.
      size: u.size == null ? null : Number(u.size),
      mime_type: u.mime_type,
      uploaded_by: u.uploaded_by,
      uploader_name: u.uploader_name,
      uploader_avatar: u.uploader_avatar,
      created_at: u.created_at,
      reference_count: references.length,
      references,
    }
  })

  return NextResponse.json({
    data,
    next_cursor: null,
    total: data.length,
    usage_bytes: usageBytes,
    limit_bytes: wsRow?.storage_limit_bytes ?? null,
  })
})
