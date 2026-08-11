// GET  /api/workspaces/{ws}/prospects — list this workspace's prospects
// POST /api/workspaces/{ws}/prospects — create one
//
// The first routes this app serves. They follow the shape every app's routes
// follow (`apps/_scaffold/app/api/workspaces/[ws]/notes/route.ts` explains each
// part), plus the two things a sales route adds:
//
//   - a VOCABULARY check against `lib/pipeline.ts`, never a hardcoded list, with
//     a 400 that points at `bk meta` rather than reciting the values. The
//     vocabulary changes without a CLI release; the error must not pretend
//     otherwise. See `lib/http-input.ts`.
//   - an ACTOR, from `lib/actor.ts`, so agent-written history stays visibly
//     agent-written (docs/backend.md §3.4).
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createProspect, findUserIdByEmail, listProspects } from '@/lib/db/queries/prospects'
import { publicProspect } from '@/lib/views'
import { PROSPECT_NAME_MAX } from '@/lib/limits'
import {
  numberOr,
  parseList,
  requireMaxLength,
  requireMoney,
  requireStage,
  str,
} from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const stages = parseList(q.get('stage'))
  for (const s of stages) requireStage(s)

  const ownerUserId = await resolveOwner(str(q.get('owner')), ctx.user.id)

  const page = await listProspects({
    workspaceId: ctx.workspace.id,
    stages,
    ownerUserId: ownerUserId ?? undefined,
    label: str(q.get('label')),
    q: str(q.get('q')),
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
    cursor: numberOr(q.get('cursor')) ?? null,
  })

  return jsonList(
    page.data.map((p) => publicProspect(p, ctx.workspace.slug)),
    page.next_cursor
  )
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) {
    throw Errors.badRequest('missing_name', 'name is required', 'pass --name "<company>"')
  }
  requireMaxLength(name, PROSPECT_NAME_MAX, 'name')

  const stage = str(body?.stage)
  if (stage) requireStage(stage)

  const value = str(body?.value)
  if (value) requireMoney(value)

  const ownerUserId = await resolveOwner(str(body?.owner), ctx.user.id)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const created = await createProspect({
    workspaceId: ctx.workspace.id,
    actor,
    name,
    city: str(body?.city) ?? null,
    sector: str(body?.sector) ?? null,
    stage,
    value: value ?? null,
    currency: str(body?.currency)?.toUpperCase(),
    ownerUserId: ownerUserId ?? null,
    source: str(body?.source) ?? null,
    summary: str(body?.summary) ?? null,
  })

  return NextResponse.json(publicProspect(created, ctx.workspace.slug), { status: 201 })
})

/**
 * `--owner <email>` or `--owner me` → a `platform.users.id`.
 *
 * `me` is here because it is the query an agent actually wants — "what am I on
 * the hook for" — and the one it cannot spell, since a token knows its own email
 * only after a round trip to `bk meta`.
 *
 * Unknown email is a 400, not a silent empty result: filtering by an address
 * nobody has returns zero prospects, which reads exactly like a clean pipeline.
 */
async function resolveOwner(owner: string | undefined, selfId: number): Promise<number | null> {
  if (!owner) return null
  if (owner === 'me') return selfId
  const found = await findUserIdByEmail(owner)
  if (found == null) {
    throw Errors.badRequest(
      'unknown_owner',
      `no user with email ${owner}`,
      'run `bk sales member list` for the people in this workspace, or use --owner me'
    )
  }
  return found
}
