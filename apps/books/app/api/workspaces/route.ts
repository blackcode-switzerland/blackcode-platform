// GET /api/workspaces — the workspaces this caller belongs to IN THIS APP.
//
// Membership IS the answer. It used to be narrowed by `platform.app_access`,
// which gated an app inside a shared workspace; both that table and the idea
// went on 2026-08-10, because a workspace now belongs to exactly one app.
//
// POST /api/workspaces — `bk books workspace create`, and the web's "Create
// workspace" (since 2026-09-28).
//
// Web login mints a person's FIRST workspace (`ensureWorkspaceForUser`); this is
// how they get another. Until 2026-09-28 it refused anyone who already owned
// one (`one_workspace_per_person`) — lifted with the invitation-accept flow and
// the web switcher; `createWorkspaceForUser` records why. Rename, transfer and
// delete live on `[ws]/route.ts` and `[ws]/transfer`; delete is refused for any
// workspace that has ever held a record (art. 958f CO).
import { NextRequest, NextResponse } from 'next/server'
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { Errors } from '@blackcode/platform-api'
import { appContext, apiHandler } from '@/lib/api'
import { createWorkspaceForUser, WorkspaceRefused } from '@/lib/db/queries/workspaces'

export const GET = workspacesRoute(appContext)

/** `books.workspaces.name` is varchar(80). */
const NAME_MAX = 80

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required', 'bk books workspace create --name <name>')
  if (name.length > NAME_MAX) {
    throw Errors.badRequest('name_too_long', `name max ${NAME_MAX} chars`, 'shorter; the slug is derived from it')
  }

  try {
    const ws = await createWorkspaceForUser(user.id, name)
    return NextResponse.json(ws, { status: 201 })
  } catch (e) {
    // 409, not 400: the request is well-formed and the CONFLICT is with a
    // workspace that already exists — which is what the suggestion points at.
    if (e instanceof WorkspaceRefused) {
      throw Errors.conflict(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
