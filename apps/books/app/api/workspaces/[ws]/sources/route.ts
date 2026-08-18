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
