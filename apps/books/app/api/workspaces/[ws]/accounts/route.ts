// GET /api/workspaces/{ws}/accounts — `bk books account list`
//
// The Swiss PME chart for one book. `statement_position` is the only mapping
// anybody may touch, and it is a NOT NULL foreign key into the legal line list, so
// an unmapped account is impossible rather than merely discouraged.
//
// ── SCOPED TO THE BOOK, DELIBERATELY NOT TO AN EXERCICE ─────────────────────
// The chart is a property of the ENTITY: `createEntity` installs it before any
// fiscal year exists, and accounts do not change per year. This route used
// `resolveScope` like the statement routes and therefore refused a freshly
// created book with "no exercice" — one command after `entity create`'s own
// output said the chart was installed and to look at it. Found 2026-08-18, in
// the first real CLI session. Statements need a year; a chart needs a book.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug, listAccounts, listEntities, publicAccount } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const slug = req.nextUrl.searchParams.get('entity')

  let entity
  if (slug) {
    entity = await getEntityBySlug(ctx.workspace.id, slug)
    if (!entity) {
      const known = await listEntities(ctx.workspace.id)
      throw Errors.badRequest(
        'bad_scope',
        `no book with slug "${slug}"`,
        known.length ? `known books: ${known.map((e) => e.slug).join(', ')}` : 'create one with `bk books entity create`'
      )
    }
  } else {
    const entities = await listEntities(ctx.workspace.id)
    if (entities.length === 0) {
      throw Errors.badRequest('bad_scope', 'no books exist in this workspace', 'create one with `bk books entity create`')
    }
    entity = entities[0]
  }

  const rows = await listAccounts(entity.id)
  return jsonList(rows.map(publicAccount), null)
})
