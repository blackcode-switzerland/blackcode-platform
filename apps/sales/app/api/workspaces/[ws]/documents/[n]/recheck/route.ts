// POST /api/workspaces/{ws}/documents/{n}/recheck — ask again whether an
// external file is viewable, and re-derive where it lives (sales #40).
//
// ===========================================================================
// WHY A WRITE VERB FOR WHAT LOOKS LIKE A READ
// ===========================================================================
// It performs a network call and it UPDATES stored columns (`preview_status`,
// `preview_checked_at`, and `storage_provider` for a row the migration could not
// classify). A GET that mutates is a GET a proxy may cache and a crawler may
// fire; POST says what this does.
//
// ===========================================================================
// THE TWO REASONS IT EXISTS
// ===========================================================================
//  1. **The fix loop.** `doc add` says "NOT viewable without access". The agent
//     shares the file in Drive. Without this there is no way to confirm the fix
//     took, and the next thing anybody learns is a human seeing a request-access
//     screen. Attach → warn → share → recheck → confirmed is the whole workflow.
//  2. **Backfill.** Migration 0012 could only classify the INTERNAL half in SQL
//     (`platform.is_uploaded_asset` is the authority for that one question);
//     deciding *which* external provider is implemented once, in TypeScript.
//     `?all=true` walks the library through the real recogniser, which is the
//     documented way to fill the column for rows that predate this feature.
//
// A recheck never changes what the page SHOWS about a file's kind or embed —
// those are derived on every read anyway. It changes only what could not be
// recomputed without asking somebody else.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getDocumentBySeq, listDocuments, updateDocument } from '@/lib/db/queries/catalog'
import { publicDocument } from '@/lib/views'
import { describeFile } from '@blackcode/platform-file-providers'
import { previewStatusNote, probePreview } from '@/lib/api/preview-probe'
import { requireNumberParam } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

/** Re-derive and re-probe one row. Returns what changed, for the receipt. */
async function recheckOne(
  workspaceId: number,
  seq: number,
  doc: { upload_url: string | null; external_url: string | null; mime_type: string | null; title: string; preview_status: string | null },
  actor: Parameters<typeof updateDocument>[3]
) {
  // No `filename` hint — the title is a label, not a filename. See
  // `publicDocument` for the bug that taught us.
  const file = describeFile(doc.upload_url ?? doc.external_url ?? '', { mime: doc.mime_type })
  // Same rule as the create path: nothing to embed means a verdict would say
  // nothing. A folder is the case that matters — it can never be previewed, so
  // "restricted" would advise a fix that changes nothing.
  const probeable = !file.internal && file.embed.mode !== 'none'
  const status = probeable ? await probePreview(file.provider, file.external_id, file.embed.url) : null
  await updateDocument(
    workspaceId,
    seq,
    {
      storageProvider: file.provider,
      externalId: file.external_id,
      previewStatus: status,
      previewCheckedAt: status ? new Date() : null,
    },
    actor
  )
  return {
    number: seq,
    provider: file.provider,
    was: doc.preview_status,
    now: status,
    changed: (doc.preview_status ?? null) !== (status ?? null),
    note: previewStatusNote(status, file.provider),
  }
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const actor = await resolveActor(getDb(), req, ctx.user)

  // `{n}` is `all` for the sweep. A sub-path (`…/documents/recheck`) would have
  // collided with `…/documents/{n}` in the router, and a query flag on a
  // per-document url would have made `{n}` meaningless while it was set.
  if (n === 'all') {
    const rows = await listDocuments({ workspaceId: ctx.workspace.id, limit: 500 })
    const results = []
    // Sequential, deliberately: this fans out to a third party, and firing 500
    // unauthenticated requests at Drive in parallel is how an IP gets rate
    // limited — which would return `unknown` for the rest of the sweep and look
    // like the files were the problem.
    for (const doc of rows) {
      results.push(await recheckOne(ctx.workspace.id, doc.seq, doc, actor))
    }
    return NextResponse.json({
      checked: results.length,
      changed: results.filter((r) => r.changed).length,
      restricted: results.filter((r) => r.now === 'restricted').map((r) => r.number),
      results,
    })
  }

  const seq = requireNumberParam(n, 'document')
  const doc = await getDocumentBySeq(ctx.workspace.id, seq)
  if (!doc) {
    throw Errors.notFound(
      'document_not_found',
      `no document #${seq} in this workspace`,
      'run `bk sales doc list` for the numbers'
    )
  }
  const result = await recheckOne(ctx.workspace.id, seq, doc, actor)
  const full = await getDocumentBySeq(ctx.workspace.id, seq)
  return NextResponse.json({ ...publicDocument(full!, ctx.workspace.slug), recheck: result })
})
