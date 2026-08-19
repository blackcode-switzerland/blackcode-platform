// GET /api/workspaces/{ws}/entries/{number} — `bk books entry show`
//
// `{number}` is the workspace #number (`seq`), never the serial `id`. The payload
// also carries `entry_no`, the statutory journal number, because a reader
// comparing against a filing needs that one instead.
//
// Since phase 4A the number may name an RI row. Bare, the grand livre is
// asked first, then the RI journals — safe, because BOTH tables keep seq
// unique per workspace, so a number names at most one row per journal kind.
// `?entity=` naming a simplified book asks its journal directly.
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntryByNumber, getEntityBySlug, publicEntry, publicRiEntry } from '@/lib/db/queries/statutory'
import { getDb } from '@/lib/db/client'
import { booksRiEntry } from '@/lib/db/schema'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', 'number must be a positive integer', 'try `bk books entry list` for the numbers')
  }

  const slug = req.nextUrl.searchParams.get('entity')
  if (slug) {
    const e = await getEntityBySlug(ctx.workspace.id, slug)
    if (!e) throw Errors.badRequest('bad_entity', `no book with slug "${slug}"`, 'bk books entity list')
    if (e.bookkeeping_regime === 'simplified') {
      const [row] = await getDb()
        .select()
        .from(booksRiEntry)
        .where(and(eq(booksRiEntry.workspace_id, ctx.workspace.id), eq(booksRiEntry.entity_id, e.id), eq(booksRiEntry.seq, n), isNull(booksRiEntry.deleted_at)))
        .limit(1)
      if (!row) throw Errors.notFound('entry_not_found', `no entry #${n} in ${slug}'s recettes-dépenses journal`)
      return NextResponse.json(publicRiEntry(row))
    }
  }

  const found = await getEntryByNumber(ctx.workspace.id, n)
  if (found) return NextResponse.json(publicEntry(found))

  // Not in the grand livre: the RI journals may carry it (at most one row —
  // seq is workspace-unique in both tables).
  const [riRow] = await getDb()
    .select()
    .from(booksRiEntry)
    .where(and(eq(booksRiEntry.workspace_id, ctx.workspace.id), eq(booksRiEntry.seq, n), isNull(booksRiEntry.deleted_at)))
    .limit(1)
  if (riRow) return NextResponse.json(publicRiEntry(riRow))

  throw Errors.notFound('entry_not_found', `no entry #${n} in this workspace`)
})
