// GET   /api/workspaces/{ws}/companies/{slug} — `bk billing company show`
// PATCH /api/workspaces/{ws}/companies/{slug} — `bk billing company edit`
//
// ── THE BANK FIELDS ARE OWNER-ONLY, AND THAT IS THE POINT OF THIS FILE ─────
// `iban` and `qr_iban` decide where money lands. A member who could change one
// could redirect every future payment to this company, and the bill would look
// entirely normal. So they are gated on `requireOwner` rather than on
// membership — which is why this route resolves the role and passes it down,
// rather than letting the query layer guess.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { CompanyRefused, editCompany, getCompany } from '@/lib/db/queries/companies'
import { authVia } from '@/lib/api/actor'

interface Params {
  params: Promise<{ ws: string; slug: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, slug } = await params
  const ctx = await resolveWorkspace(req, ws)
  const company = await getCompany(ctx.workspace.id, slug)
  if (!company) {
    throw Errors.notFound('company', 'bk billing company list')
  }
  return NextResponse.json(company)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, slug } = await params
  const ctx = await resolveWorkspace(req, ws)
  const patch = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!patch || Object.keys(patch).length === 0) {
    throw Errors.badRequest(
      'empty_patch',
      'send at least one field to change',
      'bk billing company edit <slug> --name "New name"'
    )
  }
  try {
    const company = await editCompany(
      {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        via: authVia(req),
        isOwner: ctx.role === 'owner',
      },
      slug,
      patch
    )
    return NextResponse.json(company)
  } catch (e) {
    if (e instanceof CompanyRefused) throw refusalToApiError(e)
    throw e
  }
})
