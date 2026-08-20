// GET /api/workspaces/{ws}/sources/{number}/manifest — `bk books manifest`
//
// The worker's ledger of one Drive folder: every file it has seen and where
// each sits in the state machine. "Did we miss a file" as a query.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getSourceBySeq, manifestOf, publicManifestRow } from '@/lib/db/queries/sources'
import { getDb } from '@/lib/db/client'
import { booksPieceInbox } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  const src = await getSourceBySeq(ctx.workspace.id, n)
  if (!src) throw Errors.notFound('source_not_found', `no source #${n} in this workspace`, 'bk books source list shows the register')

  const rows = await manifestOf(src.id)
  const pieceIds = rows.map((r) => r.extracted_piece_id).filter((x): x is number => x !== null)
  const seqById = new Map<number, number>()
  if (pieceIds.length > 0) {
    const pieces = await getDb()
      .select({ id: booksPieceInbox.id, seq: booksPieceInbox.seq })
      .from(booksPieceInbox)
      .where(inArray(booksPieceInbox.id, pieceIds))
    for (const p of pieces) seqById.set(p.id, p.seq)
  }
  return NextResponse.json({
    source: src.seq,
    files: rows.map((m) => publicManifestRow(m, m.extracted_piece_id === null ? null : (seqById.get(m.extracted_piece_id) ?? null))),
  })
})
