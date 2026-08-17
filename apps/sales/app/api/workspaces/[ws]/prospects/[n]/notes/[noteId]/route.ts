// DELETE /api/workspaces/{ws}/prospects/{n}/notes/{noteId} — destroy one
//
// **There is no PATCH here, and its absence is the contract.** The log is
// append-only; the collection route's header says why at length.
//
// The DELETE is HARD. `sales.prospect_notes` carries no `deleted_at`, matching
// `sales.objections`: the recycle bin lists records by #number and a note has
// none, so there would be nothing for `bk sales trash restore` to take. Delete
// exists at all because a note pasted onto the wrong prospect is otherwise
// permanent clutter on a customer record.
//
// ── THE CONFIRMATION IS CHECKED BEFORE ANYTHING IS DESTROYED ────────────────
// Not after. `…/objections/{oid}` was written the other way round once — it
// deleted the row, compared `--confirm` against what came back, and returned a
// 409 saying the caller had named the wrong one, having already destroyed it.
// `lib/api/objection-delete-guard.test.ts` is that whole story, and this route
// is written in the shape that test now pins.
//
// What the confirmation buys, and what it does not, is set out at
// `deleteProspectNote` — it is the note's own id, which is the weaker of the two
// shapes in this repo, and the receipt below is what covers the difference.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  deleteProspectNote,
  getProspectNote,
  prospectIdBySeq,
} from '@/lib/db/queries/prospect-children'
import { requireNumberParam, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string; noteId: string }>
}

async function resolveIds(workspaceId: number, n: string, noteId: string) {
  const seq = requireNumberParam(n, 'prospect')
  const prospectId = await prospectIdBySeq(workspaceId, seq)
  if (prospectId == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  const id = Number(noteId)
  if (!Number.isInteger(id) || id <= 0) {
    throw Errors.notFound(
      'note_not_found',
      `${JSON.stringify(noteId)} is not a note id`,
      `run \`bk sales prospect note list ${seq}\` for the ids`
    )
  }
  return { seq, prospectId, noteId: id }
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, noteId } = await params
  const ctx = await resolveWorkspace(req, ws)
  const ids = await resolveIds(ctx.workspace.id, n, noteId)

  const existing = await getProspectNote(ids.prospectId, ids.noteId)
  if (!existing) {
    throw Errors.notFound(
      'note_not_found',
      `no note ${ids.noteId} on prospect #${ids.seq}`,
      `run \`bk sales prospect note list ${ids.seq}\` for the ids`
    )
  }

  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'removing a note is permanent — the log has no recycle bin',
      `pass --confirm ${ids.noteId}`
    )
  }
  if (confirm !== String(ids.noteId)) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name note ${ids.noteId}`,
      `pass --confirm ${ids.noteId} — nothing was removed`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const result = await deleteProspectNote(ctx.workspace.id, ids.prospectId, ids.noteId, actor)
  if (result.status === 'not_found') {
    throw Errors.notFound(
      'note_not_found',
      `no note ${ids.noteId} on prospect #${ids.seq}`,
      `run \`bk sales prospect note list ${ids.seq}\` for the ids`
    )
  }

  // THE RECEIPT. The row is gone and this response is the last chance anybody
  // has to see what it said — CLAUDE.md: an irreversible command reports WHAT it
  // did, not just how many. It is also what makes the weaker id-confirmation
  // acceptable: a wrong `rm` is visible in the next line of output.
  return NextResponse.json({
    deleted: true,
    type: 'prospect_note',
    id: result.row.id,
    kind: result.row.kind,
    body: result.row.body,
  })
})
