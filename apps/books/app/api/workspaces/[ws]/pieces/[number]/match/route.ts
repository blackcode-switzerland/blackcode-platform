// POST /api/workspaces/{ws}/pieces/{number}/match — `bk books piece match`
//
// A human (or their agent) says what this document proves. Writes the ENTRY's
// piece_* interpretation columns — open on posted entries by 0004's design —
// and deliberately does NOT touch the evidence tier: whether a receipt turns
// `partial` into `full` is a sufficiency judgment, and judgments are human.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { matchPiece, MatchRefused } from '@/lib/db/queries/pieces'

interface Params { params: Promise<{ ws: string; number: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw Errors.badRequest('bad_number', `"${number}" is not a piece number`, 'from `bk books piece list`')

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const entry = body?.entry
  if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1) {
    throw Errors.badRequest('missing_entry', 'pass the entry #number this piece documents', 'the worklist suggests candidates')
  }

  try {
    const r = await matchPiece(ctx.workspace.id, n, entry)
    return NextResponse.json({ number: r.piece.seq, status: r.piece.status, matched_entry: r.entryNumber })
  } catch (e) {
    if (e instanceof MatchRefused) {
      if (e.code.endsWith('not_found')) throw Errors.notFound(e.code.replace('_not_found', ''), String(e.code === 'piece_not_found' ? n : entry))
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
