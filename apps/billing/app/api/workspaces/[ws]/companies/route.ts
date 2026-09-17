// GET  /api/workspaces/{ws}/companies — `bk billing company list`
// POST /api/workspaces/{ws}/companies — `bk billing company create`
//
// A company is the entity whose name, address and bank account appear on the
// bill. Multi-entity by design: a new one is a row, never a code change.
//
// The GET is PUBLIC (`lib/integration.ts`) and read-only, deliberately: a
// company carries bank details and is configured by a person, so an outside
// system maps its own entities onto these rather than creating them.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { withIdempotency } from '@/lib/api/idempotency'
import { CompanyRefused, createCompany, listCompanies } from '@/lib/db/queries/companies'
import { authVia } from '@/lib/api/actor'
import type { CreateCompanyBody } from '@/types'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const companies = await listCompanies(ctx.workspace.id, {
    // Retired companies are hidden by default and reachable on request. They
    // still render their old invoices; what `retired_at` stops is OFFERING them
    // for new ones, which is a different question from whether they exist.
    includeRetired: q.get('retired') === 'true' || q.get('include_retired') === 'true',
    externalRef: q.get('external_ref') ?? undefined,
  })
  // No cursor: a workspace has a handful of issuing entities, not a page of
  // them. Serving `next_cursor: null` keeps the envelope's shape rather than
  // inventing a second one for short lists.
  return jsonList(companies, null, { total: companies.length })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as CreateCompanyBody | null
  if (!body) throw Errors.badRequest('invalid_body', 'a JSON body is required', 'bk billing company create --slug … --name …')

  return withIdempotency(req, ctx.workspace.id, body, async () => {
    try {
      const company = await createCompany(
        {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          via: authVia(req),
          isOwner: ctx.role === 'owner',
        },
        body
      )
      return NextResponse.json(company, { status: 201 })
    } catch (e) {
      throw asApiError(e)
    }
  })
})

/**
 * A `CompanyRefused` carries its own status, code and suggestion, so it maps
 * straight onto the platform's error shape rather than being flattened into a
 * generic 400.
 *
 * The `instanceof` stays HERE, per route, because each route recognises its OWN
 * refusal type — a shared mapper taking `unknown` would happily swallow a real
 * bug as a 400. The status → envelope mapping is shared (`lib/api/refusal.ts`),
 * since 2026-09-17: four hand-written copies of it had the same transposed 403.
 */
function asApiError(e: unknown): unknown {
  if (e instanceof CompanyRefused) return refusalToApiError(e)
  return e
}
