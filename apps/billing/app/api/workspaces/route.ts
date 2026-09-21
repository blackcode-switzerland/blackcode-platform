// GET /api/workspaces — the workspaces this caller belongs to IN THIS APP.
//
// Membership IS the answer. It used to be narrowed by `platform.app_access`,
// which gated an app inside a shared workspace; both that table and the idea
// went on 2026-08-10, because a workspace now belongs to exactly one app.
//
// POST /api/workspaces — `bk billing workspace create`, and the "create a
// workspace" action on the dashboard.
//
// ── WHY THIS APP SERVES POST AND THE SCAFFOLD DOES NOT ─────────────────────
// The scaffold lists `POST /api/workspaces` in its `UNSERVED_OPERATIONS` with
// the reason "a workspace is the COMPANY (D-3); you are granted access to one,
// you do not open one from a new app". That reasoning does not transfer: in
// b/billing a workspace is a TENANT and the issuing company is a row inside it
// (`billing.company`, phase 1), so "one more company to bill from" is
// `bk billing company create` and a new workspace is a genuinely separate
// tenant.
//
// It is also what closes the §9.1 dead end — a cookie-arriving visitor with no
// workspace — with a deliberate act instead of a silent mint. The whole
// decision is written down in `createWorkspaceForUser`.
//
// **Create is the only workspace admin verb this app serves.** No edit, no
// transfer, and deliberately no DELETE ever: a workspace holds invoices, which
// are numbered legal documents under a ten-year retention duty (art. 958f CO) —
// the same doctrine that keeps `Trash` and `Labels` off in the CLI.
import { NextRequest, NextResponse } from 'next/server'
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { Errors } from '@blackcode/platform-api'
import { appContext, apiHandler } from '@/lib/api'
import { createWorkspaceForUser, WorkspaceRefused } from '@/lib/db/queries/workspaces'

export const GET = workspacesRoute(appContext)

/** `billing.workspaces.name` is varchar(80). */
const NAME_MAX = 80

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    throw Errors.badRequest(
      'invalid_name',
      'name is required',
      'bk billing workspace create --name "Acme SA"'
    )
  }
  if (name.length > NAME_MAX) {
    throw Errors.badRequest(
      'name_too_long',
      `name max ${NAME_MAX} chars`,
      'shorter; the slug is derived from it and appears in every URN this app prints'
    )
  }

  try {
    const ws = await createWorkspaceForUser(user.id, name)
    return NextResponse.json(ws, { status: 201 })
  } catch (e) {
    // 409, not 400: the request is well-formed and the CONFLICT is with state
    // that already exists — which is what the suggestion points at.
    if (e instanceof WorkspaceRefused) {
      throw Errors.conflict(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
