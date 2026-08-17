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
import { describeFile } from '@blackcode/platform-file-providers'
import { previewStatusNote, probePreview } from '@/lib/api/preview-probe'
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
  if (kind && !DOCUMENT_KIND_VALUES.includes(kind)) {
    throw Errors.badRequest(
      'unknown_kind',
      `unknown document kind ${JSON.stringify(kind)}`,
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

  // ── WHERE DOES THIS LIVE? (migration 0012, sales #40) ───────────────────
  // Derived from the url, never taken from the caller. A client that could
  // declare its own link `blob` would be declaring itself under the delete
  // gate's protection, which is a claim only we get to make.
  const mimeType = str(body?.mime_type) ?? null
  // No `filename` hint: the TITLE is a label, not a filename, and passing it
  // makes it beat the url's own path. See `publicDocument`.
  const file = describeFile(uploadUrl ?? externalUrl ?? '', { mime: mimeType })

  // `kind` became OPTIONAL in this change. It is the author's own label and
  // still wins when given; when it is absent we default it from what the file
  // actually is, because `--kind` being required was a question an agent had to
  // answer about a Drive url it could not inspect.
  const resolvedKind = kind ?? defaultKindFor(file.media_kind)

  // Best-effort, and it MUST NOT be able to fail this write — see
  // `lib/api/preview-probe.ts`.
  //
  // `null` in two cases, and the second one is a bug found in the browser:
  //   - OUR files: always viewable by anyone who can see the record.
  //   - anything with NO EMBED — a folder, an unrecognised host. There is
  //     nothing to preview, so a status is meaningless, and recording
  //     `restricted` made the UI tell somebody to share a folder "anyone with
  //     the link" so it could be previewed. It never would be.
  const previewStatus = shouldProbe(file) ? await probePreview(file.provider, file.external_id, file.embed.url) : null

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await addDocument(
    ctx.workspace.id,
    {
      title,
      kind: resolvedKind,
      uploadUrl,
      externalUrl,
      storageProvider: file.provider,
      externalId: file.external_id,
      previewStatus,
      previewCheckedAt: previewStatus ? new Date() : null,
      sizeBytes: body?.size_bytes == null ? null : Number(body.size_bytes),
      mimeType,
      description: str(body?.description) ?? null,
      tags: Array.isArray(body?.tags)
        ? (body.tags as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
        : null,
    },
    actor
  )
  return NextResponse.json(
    {
      ...publicDocument(
        { ...row, prospect_numbers: [], product_numbers: [], strategy_numbers: [] },
        ctx.workspace.slug
      ),
      // THE SENTENCE THE AGENT READS. A `restricted` verdict is the whole
      // reason the probe runs, and an agent that only got a 201 would never
      // learn its link is unopenable. `bk` prints this on stderr.
      preview_note: previewStatusNote(previewStatus, file.provider),
    },
    { status: 201 }
  )
})

/** Is there anything a preview verdict could change? See the call site. */
function shouldProbe(file: { internal: boolean; embed: { mode: string } }): boolean {
  return !file.internal && file.embed.mode !== 'none'
}

/**
 * A `kind` for a file whose author did not name one.
 *
 * `document_kinds` is the AUTHOR's vocabulary and is shaped differently from the
 * derived media kind: `deck` is a judgement about purpose and `link` is one
 * about location, and no recogniser can infer either. So this maps only the four
 * that are genuinely the same question and falls back to `link` for everything
 * else — recording "we could not tell" as the neutral value rather than as a
 * guess the author would then have to notice and correct.
 *
 * An explicit `--kind` always wins. This only fills a blank.
 */
function defaultKindFor(mediaKind: string): string {
  switch (mediaKind) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'pdf':
      return 'pdf'
    case 'slides':
      return 'deck'
    default:
      return 'link'
  }
}
