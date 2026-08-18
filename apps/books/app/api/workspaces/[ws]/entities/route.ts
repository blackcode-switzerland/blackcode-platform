// GET  /api/workspaces/{ws}/entities  — `bk books entity list`
// POST /api/workspaces/{ws}/entities  — `bk books entity create`
//
// A book. The user creates these and may have ANY NUMBER: three are seeded and
// nothing here or anywhere else may assume three.
//
// There is no validation that an SA must keep double-entry books. Migration 0004
// carries a CHECK so the illegal state cannot be represented, and a check here
// would be a second, weaker copy that drifts from it.
//
// POST returns the book WITHOUT its accounts, and it has 26 of them: `createEntity`
// installs the PME chart in the same transaction, because a book with no accounts
// accepts no posting. Read them from `GET .../accounts?entity=<slug>` — the create
// response stays the entity shape every other endpoint returns.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { createEntity, listEntities, publicEntity } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const rows = await listEntities(ctx.workspace.id)
  return jsonList(rows.map(publicEntity), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string).trim() : '')
  const slug = str('slug')
  const name = str('name')
  const legal_form = str('legal_form')

  if (!slug) throw Errors.badRequest('missing_slug', 'slug is required', 'pass --slug blackcode')
  if (!name) throw Errors.badRequest('missing_name', 'name is required', 'pass --name "blackcode SA"')
  if (!legal_form) {
    throw Errors.badRequest('missing_legal_form', 'legal_form is required', 'pass --legal-form SA or RI')
  }

  // The regime follows from the legal form unless stated. An SA has no choice
  // (art. 957 al. 1 ch. 2); an RI defaults to simplified and may elect otherwise.
  const capital = ['SA', 'SARL', 'SÀRL', 'AG', 'GMBH'].includes(legal_form.toUpperCase())
  const regime = str('bookkeeping_regime') || (capital ? 'double_entry' : 'simplified')

  const row = await createEntity(ctx.workspace.id, {
    slug,
    name,
    legal_form,
    bookkeeping_regime: regime,
    seat: str('seat') || null,
  })
  return NextResponse.json(publicEntity(row), { status: 201 })
})
