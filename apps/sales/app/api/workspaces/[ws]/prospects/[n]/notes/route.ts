// GET  /api/workspaces/{ws}/prospects/{n}/notes — the research log, newest first
// POST /api/workspaces/{ws}/prospects/{n}/notes — append one
//
//   ┌────────────────────────────────────────────────────────────────────────┐
//   │ THIS LOG IS APPEND-ONLY. THERE IS NO PATCH, AND ADDING ONE UNDOES IT.  │
//   └────────────────────────────────────────────────────────────────────────┘
//
// `prospects.summary` is the field you OVERWRITE — "where this deal stands" has
// one answer at a time, and PATCH replacing it is correct. This is the other
// shape: a sequence of observations, each true when it was written. The issue
// that produced it (#39) was filed after somebody researching a prospect had to
// destroy a prior finding to record a new one, because `summary` was the only
// free-text field there was.
//
// An editable note answers "what do we think now", which `summary` already
// answers, and stops answering "what did we know, and when" — the only question
// this route exists for. `lib/db/queries/prospect-children.ts` has no
// `updateProspectNote` and the omission is deliberate.
//
// A note is reached THROUGH its prospect and has no #number; the reasoning is in
// the queries file, once, for all five child types. The `noteId` in the
// sub-route is a row id, which is the correct address for a row with no
// independent identity.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  addProspectNote,
  listProspectNotes,
  prospectIdBySeq,
} from '@/lib/db/queries/prospect-children'
import { publicProspectNote } from '@/lib/views'
import { PROSPECT_NOTE_BODY_MAX, PROSPECT_NOTE_KIND_MAX } from '@/lib/limits'
import { requireMaxLength, requireNumberParam, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

async function requireProspect(workspaceId: number, raw: string): Promise<number> {
  const seq = requireNumberParam(raw, 'prospect')
  const id = await prospectIdBySeq(workspaceId, seq)
  if (id == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return id
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  // No cursor: a research log is short by nature and read from the top, and a
  // paged one would make "everything we know" two calls instead of one. The
  // envelope is still `{ data, next_cursor }` because every list route in this
  // app serves that shape and a caller must not have to special-case one.
  return jsonList((await listProspectNotes(prospectId)).map(publicProspectNote), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const text = str(body?.body)
  if (!text) {
    throw Errors.badRequest(
      'missing_body',
      'body is required — a note with nothing in it is not an observation',
      'pass --text "<what you found>"'
    )
  }
  requireMaxLength(text, PROSPECT_NOTE_BODY_MAX, 'body')

  const kind = str(body?.kind)
  if (kind) requireMaxLength(kind, PROSPECT_NOTE_KIND_MAX, 'kind')

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await addProspectNote(ctx.workspace.id, prospectId, { body: text, kind }, actor)
  return NextResponse.json(publicProspectNote(row), { status: 201 })
})
