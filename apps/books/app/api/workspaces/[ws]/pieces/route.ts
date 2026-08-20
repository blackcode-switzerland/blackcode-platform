// GET /api/workspaces/{ws}/pieces — `bk books piece list`
//
// The receipts inbox. Nothing here changes a balance; the screen this serves
// is where a human decides what each document proves, via the worklist's
// candidates and `POST /pieces/{n}/match`.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug } from '@/lib/db/queries/statutory'
import { listPieces, publicPiece } from '@/lib/db/queries/pieces'
import { entitySlugsById } from '@/lib/db/queries/sources'
import { getDb } from '@/lib/db/client'
import { booksEntry, booksRiEntry, booksPieceInbox } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  let entityId: number | undefined
  const slug = q.get('entity')
  if (slug) {
    const e = await getEntityBySlug(ctx.workspace.id, slug)
    if (!e) throw Errors.badRequest('bad_scope', `no book with slug "${slug}"`, 'omit --entity for the whole inbox')
    entityId = e.id
  }
  const status = q.get('status') ?? undefined
  const rows = await listPieces(ctx.workspace.id, { status, entityId })
  const slugs = await entitySlugsById(ctx.workspace.id)

  // Resolve matched entries (either journal) and duplicate pointers to
  // workspace #numbers.
  const entryIds = rows.map((r) => r.matched_entry_id).filter((x): x is number => x !== null)
  const entrySeq = new Map<number, number>()
  if (entryIds.length > 0) {
    const es = await getDb().select({ id: booksEntry.id, seq: booksEntry.seq }).from(booksEntry).where(inArray(booksEntry.id, entryIds))
    for (const e of es) entrySeq.set(e.id, e.seq)
  }
  const riIds = rows.map((r) => r.matched_ri_entry_id).filter((x): x is number => x !== null)
  const riSeq = new Map<number, number>()
  if (riIds.length > 0) {
    const rs = await getDb().select({ id: booksRiEntry.id, seq: booksRiEntry.seq }).from(booksRiEntry).where(inArray(booksRiEntry.id, riIds))
    for (const r of rs) riSeq.set(r.id, r.seq)
  }
  const dupIds = rows.map((r) => r.duplicate_of_id).filter((x): x is number => x !== null)
  const dupSeq = new Map<number, number>()
  if (dupIds.length > 0) {
    const ds = await getDb().select({ id: booksPieceInbox.id, seq: booksPieceInbox.seq }).from(booksPieceInbox).where(inArray(booksPieceInbox.id, dupIds))
    for (const d of ds) dupSeq.set(d.id, d.seq)
  }

  const matchedOf = (p: (typeof rows)[number]) => {
    if (p.matched_entry_id !== null) {
      const seq = entrySeq.get(p.matched_entry_id)
      return seq === undefined ? null : { seq, journal: 'grand_livre' as const }
    }
    if (p.matched_ri_entry_id !== null) {
      const seq = riSeq.get(p.matched_ri_entry_id)
      return seq === undefined ? null : { seq, journal: 'recettes_depenses' as const }
    }
    return null
  }

  return jsonList(
    rows.map((p) => ({
      ...publicPiece(p, p.entity_id === null ? null : (slugs.get(p.entity_id) ?? null), matchedOf(p)),
      duplicate_of: p.duplicate_of_id === null ? null : (dupSeq.get(p.duplicate_of_id) ?? null),
    })),
    null
  )
})
