// GET  /api/workspaces/{ws}/accounts — `bk books account list`
// POST /api/workspaces/{ws}/accounts — `bk books account create`
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
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug, listAccounts, listEntities, publicAccount } from '@/lib/db/queries/statutory'
import { createAccount, AccountRefused } from '@/lib/db/queries/account'

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

/**
 * Add an account this book keeps and the template does not.
 *
 * The template is 24 accounts and a real company's chart is its own: the
 * seeded books already carry two extra banks that `lib/chart.test.ts` calls
 * "a book customization, not template material". This is how a book gets one.
 *
 * Landed together with the chart check in `queries/chart-guard.ts`, because a
 * door that refuses an unknown account and no door that adds one would be a
 * refusal with no answer.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books account create')

  const slug = typeof body.entity === 'string' ? body.entity : ''
  if (!slug) throw Errors.badRequest('missing_entity', 'entity is required', 'pass --entity <book slug>')
  const entity = await getEntityBySlug(ctx.workspace.id, slug)
  if (!entity) throw Errors.notFound('entity_not_found', `no book with slug "${slug}"`, 'bk books entity list')

  const no = typeof body.no === 'string' ? body.no.trim() : ''
  const cls = Number(body.class)
  const position = typeof body.statement_position === 'string' ? body.statement_position.trim() : ''
  if (!no) throw Errors.badRequest('missing_no', 'the account number is required', 'pass --no 1021')
  if (!position) {
    throw Errors.badRequest(
      'missing_position',
      'the statutory statement line is required',
      'pass --position, e.g. tresorerie — `bk books account list` shows the ones in use'
    )
  }

  // The label keeps the mockup's storage shape: French is the statutory
  // wording, and `enSuffix` is what every existing row carries. `publicAccount`
  // normalizes both to {fr, en} at the door.
  const label = {
    fr: typeof body.label_fr === 'string' ? body.label_fr.trim() : '',
    ...(typeof body.label_en === 'string' && body.label_en.trim()
      ? { enSuffix: body.label_en.trim() }
      : {}),
  }

  try {
    const row = await createAccount(ctx.workspace.id, entity.id, {
      no,
      class: cls,
      label,
      statement_position: position,
    })
    return NextResponse.json(publicAccount(row), { status: 201 })
  } catch (e) {
    if (e instanceof AccountRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
