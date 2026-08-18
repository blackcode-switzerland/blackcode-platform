// POST /api/workspaces/{ws}/pieces/ingest — `bk books piece ingest`
//
// THE ROBOT DOOR. The external Drive worker holds a bk_live_ token and posts
// an ExtractionResult here; membership is the whole gate, same as any caller.
//
// Four rules, enforced in lib (queries/pieces.ts + validate/extraction.ts),
// stated here because this is the file a reader checks:
//   1. always staged   2. idempotent on (file_id, checksum)
//   3. server re-validates; the worker's own verdict is stored, never read
//   4. duplicates flagged, never dropped
//
// The only 4xx is a STRUCTURALLY broken payload. A payload that fails
// validation still lands, staged and flagged for review — a bad sum is
// exactly the document a human must see, and refusing it at the door would
// hide it in the worker's retry queue.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug } from '@/lib/db/queries/statutory'
import { ingestPiece, type IngestSource } from '@/lib/db/queries/pieces'
import { structuralRefusal, type Extraction } from '@/lib/validate/extraction'

interface Params { params: Promise<{ ws: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'POST the ExtractionResult as JSON')

  const source = body.source as IngestSource | undefined
  if (!source || typeof source.file_id !== 'string' || !source.file_id) {
    throw Errors.badRequest('missing_file_id', 'source.file_id is required', 'it is the idempotency key; the worker always has it')
  }

  const refusal = structuralRefusal(body)
  if (refusal) throw Errors.badRequest('bad_extraction', refusal, 'see extraction-schema.json (ExtractionResult v0.1)')

  // The mockup spells it `tx`; the schema says `transaction`. Accept both.
  const extraction = { ...body, transaction: body.transaction ?? body.tx } as unknown as Extraction

  let entityId: number | null = null
  const slug = (body.entity as string | undefined) ?? req.nextUrl.searchParams.get('entity') ?? undefined
  if (slug) {
    const e = await getEntityBySlug(ctx.workspace.id, slug)
    if (!e) throw Errors.badRequest('bad_entity', `no book with slug "${slug}"`, 'omit entity to ingest unattributed')
    entityId = e.id
  }

  const receivedOn = (body.received as string | undefined) ?? new Date().toISOString().slice(0, 10)
  const r = await ingestPiece(ctx.workspace.id, entityId, source, extraction, receivedOn, (body.pipeline as string) ?? null)

  return NextResponse.json(
    {
      number: r.piece.seq,
      created: r.created,
      status: r.piece.status,
      validation: r.validation,
      needs_review: r.needs_review,
      duplicate_of: r.duplicate_of,
    },
    { status: r.created ? 201 : 200 }
  )
})
