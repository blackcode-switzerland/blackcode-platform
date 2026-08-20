// GET /api/workspaces/{ws}/sources — `bk books source list`
//
// The register that answers "do I have everything". Status is computed at read
// time from cadence against last_import (lib/derive/sources.ts says why there
// is no status column and never will be); the only hand-set lifecycle fact is
// `retired`.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getEntityBySlug } from '@/lib/db/queries/statutory'
import { listSources, publicSource, entitySlugsById } from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const slug = req.nextUrl.searchParams.get('entity')
  let entityId: number | undefined
  if (slug) {
    const e = await getEntityBySlug(ctx.workspace.id, slug)
    if (!e) throw Errors.badRequest('bad_scope', `no book with slug "${slug}"`, 'omit --entity to list every source')
    entityId = e.id
  }
  const today = new Date().toISOString().slice(0, 10)
  const [rows, slugs] = await Promise.all([listSources(ctx.workspace.id, entityId), entitySlugsById(ctx.workspace.id)])
  return jsonList(rows.map((s) => publicSource(s, today, s.entity_id === null ? null : (slugs.get(s.entity_id) ?? null))), null)
})

// POST /api/workspaces/{ws}/sources — `bk books source create`
//
// Register upkeep (phase 4A): a new feed exists in the world, so a row for it
// exists here. Operational state, not a record — 0008's grants doctrine.
export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books source create')

  const entity = typeof body.entity === 'string' ? body.entity.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  if (!entity || !name || !type) {
    throw Errors.badRequest('missing_field', 'entity, name and type are required', 'bk books source create --entity <book> --name <name> --type <bank|stripe|drive_folder|card|...>')
  }

  const { createSource, SourceRefused } = await import('@/lib/db/queries/sources')
  try {
    const s = await createSource(ctx.workspace.id, {
      entitySlug: entity,
      name,
      type,
      expected: typeof body.expected === 'string' ? body.expected : null,
      ledgerAccounts: Array.isArray(body.ledger_accounts) ? (body.ledger_accounts as string[]) : undefined,
      method: typeof body.method === 'string' ? body.method : null,
      notes: (body.notes as Record<string, unknown> | undefined) ?? null,
    })
    const { NextResponse } = await import('next/server')
    return NextResponse.json({ number: s.seq, name: s.name, type: s.type }, { status: 201 })
  } catch (e) {
    if (e instanceof SourceRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})
