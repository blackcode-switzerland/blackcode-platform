// GET  /api/workspaces/{ws}/documents — the one library (D-8)
// POST /api/workspaces/{ws}/documents — add a file or a link
//
// A document is EITHER an uploaded file — through `POST /api/upload` on THIS
// host, so it lands in `platform.uploads` with `app = 'sales'` and the
// `sales/{ws}/` path prefix — OR an external link. The CHECK enforces exactly
// one, and this route refuses both or neither before the database has to.
//
// `--prospect` and `--product` filter the library rather than listing a separate
// per-prospect or per-product set: the many-to-many tables are what make the
// per-prospect Documents tab a FILTERED VIEW into one library rather than a silo
// with copies in it.
//
// `--tag` filters on the `tags text[]` column the library has stored since
// 0001 and never exposed to a reader. Nothing here adds a tagging system —
// `bk sales doc add --tag` has always written these — it adds the read path
// that was missing.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { addDocument, listDocuments } from '@/lib/db/queries/catalog'
import { publicDocument } from '@/lib/views'
import { DOCUMENT_TITLE_MAX } from '@/lib/limits'
import { numberOr, parseList, requireMaxLength, str } from '@/lib/http-input'
import { DOCUMENT_KIND_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const kind = str(q.get('kind'))
  if (kind && !DOCUMENT_KIND_VALUES.includes(kind)) {
    throw Errors.badRequest(
      'unknown_kind',
      `unknown document kind ${JSON.stringify(kind)}`,
      'run `bk meta` for the current kinds'
    )
  }
  // `?tag=deck,pricing` matches a document carrying EITHER — OR, not AND. The
  // reasoning is on `listDocuments`' `tags` parameter; the short version is that
  // a row of tag chips whose second click can only ever empty the list reads as
  // broken, and free-text tags on a small library intersect almost never.
  //
  // Tags are NOT validated against a vocabulary, unlike `kind` above, because
  // there is no vocabulary: `sales.documents.tags` is free text an agent writes
  // with `--tag`. An unknown tag is not an error — it is a filter that matches
  // nothing, which is a true answer and the one the caller asked for.
  const rows = await listDocuments({
    workspaceId: ctx.workspace.id,
    kind,
    prospectSeq: numberOr(q.get('prospect')),
    productSeq: numberOr(q.get('product')),
    tags: parseList(q.get('tag')),
    q: str(q.get('q')),
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
  })
  return jsonList(rows.map((d) => publicDocument(d, ctx.workspace.slug)), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const title = str(body?.title)
  if (!title) throw Errors.badRequest('missing_title', 'title is required', 'pass --title "…"')
  requireMaxLength(title, DOCUMENT_TITLE_MAX, 'title')

  const kind = str(body?.kind)
  if (!kind || !DOCUMENT_KIND_VALUES.includes(kind)) {
    throw Errors.badRequest(
      'unknown_kind',
      kind ? `unknown document kind ${JSON.stringify(kind)}` : 'kind is required',
      'run `bk meta` for the current kinds'
    )
  }

  const uploadUrl = str(body?.upload_url) ?? null
  const externalUrl = str(body?.external_url) ?? null
  // Refused here rather than left to the CHECK, so the error names the fix
  // instead of surfacing as a constraint violation from three frames down.
  if (!uploadUrl && !externalUrl) {
    throw Errors.badRequest(
      'missing_url',
      'a document needs exactly one of upload_url or external_url',
      'upload the file first (`bk sales upload <file>`) and pass its URL, or pass --url for a link'
    )
  }
  if (uploadUrl && externalUrl) {
    throw Errors.badRequest(
      'two_urls',
      'a document has exactly one location, not two',
      'a stored file and a link are different documents — add them separately'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await addDocument(
    ctx.workspace.id,
    {
      title,
      kind,
      uploadUrl,
      externalUrl,
      sizeBytes: body?.size_bytes == null ? null : Number(body.size_bytes),
      mimeType: str(body?.mime_type) ?? null,
      description: str(body?.description) ?? null,
      tags: Array.isArray(body?.tags)
        ? (body.tags as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
        : null,
    },
    actor
  )
  return NextResponse.json(
    publicDocument({ ...row, prospect_numbers: [], product_numbers: [] }, ctx.workspace.slug),
    { status: 201 }
  )
})
