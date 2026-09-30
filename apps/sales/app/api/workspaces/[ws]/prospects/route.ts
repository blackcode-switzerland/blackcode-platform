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
import {
  CONTACT_URL_MAX,
  GAME_PLAN_MAX,
  PROSPECT_ADDRESS_MAX,
  PROSPECT_EMAIL_MAX,
  PROSPECT_NAME_MAX,
  PROSPECT_PHONE_MAX,
} from '@/lib/limits'
import { resolveStrategy } from '@/lib/api/strategy-ref'
import {
  numberOr,
  parseList,
  bodyNumber,
  repeated,
  requireEmail,
  requireHttpUrl,
  requireMaxLength,
  requireMoney,
  requirePhone,
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

  // The combinable filters (#98): AND across dimensions, OR within one, so each
  // of these is a REPEATED parameter. Owners are resolved to ids the way the
  // single `--owner` always was — an unknown email is a 400, never an empty list
  // that reads as a clean pipeline.
  const ownerUserIds: number[] = []
  for (const o of repeated(q, 'owner')) {
    ownerUserIds.push((await resolveOwner(o, ctx.user.id))!)
  }
  const strategyId = await resolveStrategy(ctx.workspace.id, numberOr(q.get('strategy')))

  const page = await listProspects({
    workspaceId: ctx.workspace.id,
    stages,
    ownerUserIds,
    strategyId,
    cities: repeated(q, 'city'),
    sectors: repeated(q, 'sector'),
    sources: repeated(q, 'source'),
    labels: repeated(q, 'label'),
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

  // The identity card (#34). Both are optional and both are checked when given:
  // `website` is rendered as an anchor by the web app, so it gets the same
  // scheme edge `meeting_url` has — see `requireHttpUrl`.
  const website = str(body?.website)
  if (website) {
    requireMaxLength(website, CONTACT_URL_MAX, 'website')
    requireHttpUrl(website, 'website', 'a company website', 'pass the full url including https://')
  }
  const address = str(body?.address)
  if (address) requireMaxLength(address, PROSPECT_ADDRESS_MAX, 'address')
  // The company's own line and address (#60) — NOT a contact's. Shape-checked
  // rather than length-checked alone: no blob trigger guards these columns, so
  // the validator is what keeps a file URL out (migration 0014).
  const phone = str(body?.phone)
  if (phone) {
    requireMaxLength(phone, PROSPECT_PHONE_MAX, 'phone')
    requirePhone(phone)
  }
  const email = str(body?.email)
  if (email) {
    requireMaxLength(email, PROSPECT_EMAIL_MAX, 'email')
    requireEmail(email)
  }

  // The segment this belongs to (#37), by its #number. Resolved to a row id
  // here, because `strategy_id` is a serial and must never cross the wire.
  const strategyId = await resolveStrategy(ctx.workspace.id, bodyNumber(body?.strategy))
  const gamePlan = str(body?.game_plan)
  if (gamePlan) requireMaxLength(gamePlan, GAME_PLAN_MAX, 'game_plan')

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
    website: website ?? null,
    address: address ?? null,
    phone: phone ?? null,
    email: email ?? null,
    strategyId: strategyId ?? null,
    gamePlan: gamePlan ?? null,
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
