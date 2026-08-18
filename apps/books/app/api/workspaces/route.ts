// GET /api/workspaces — the workspaces this caller belongs to IN THIS APP.
//
// Membership IS the answer. It used to be narrowed by `platform.app_access`,
// which gated an app inside a shared workspace; both that table and the idea
// went on 2026-08-10, because a workspace now belongs to exactly one app.
//
// POST /api/workspaces — `bk books workspace create`.
//
// Web login mints a person's FIRST workspace (`ensureWorkspaceForUser`);
// this is how they get a second: one set of books per venture, so a person
// running a company and their own affairs keeps them in separate workspaces,
// not one workspace with awkward books. Create is the ONLY admin verb this
// app serves — no edit, no transfer, and deliberately no DELETE, ever:
// workspaces hold statutory records under a ten-year retention duty
// (art. 958f CO), the same doctrine that keeps `Trash` off in the CLI.
import { NextRequest, NextResponse } from 'next/server'
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { Errors } from '@blackcode/platform-api'
import { appContext, apiHandler } from '@/lib/api'
import { createWorkspaceForUser } from '@/lib/db/queries/workspaces'

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

  const ws = await createWorkspaceForUser(user.id, name)
  return NextResponse.json(ws, { status: 201 })
})
