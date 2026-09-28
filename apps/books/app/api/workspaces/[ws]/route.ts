// GET    /api/workspaces/{ws} — `bk books workspace show`, and what
//        `bk books workspace use` resolves a slug against before saving it.
// PATCH  /api/workspaces/{ws} — `bk books workspace edit --name` (name only).
// DELETE /api/workspaces/{ws} — `bk books workspace delete <slug> --confirm <slug>`,
//        and ONLY for a workspace that has never held anything.
//
// **`bk workspace use <slug>` RESOLVES THROUGH GET.** That makes it the single
// most load-bearing platform route for a new app: almost every other command
// needs an active workspace. It was the first thing to break in the sales
// north-star run.
//
// ---------------------------------------------------------------------------
// PATCH AND DELETE ARRIVED ON 2026-09-28, WITH THE WEB'S WORKSPACE SETTINGS
// ---------------------------------------------------------------------------
// Until then this file served GET alone, and `app/api/workspaces/route.ts` said
// "deliberately no DELETE, ever": workspaces hold statutory records under a
// ten-year retention duty (art. 958f CO). That still holds for any workspace
// that has held a record. What changed is that an EMPTY workspace — made by
// mistake, or to try something — can go. `deleteWorkspace` in
// `lib/db/queries/workspaces.ts` decides, and says why the decision is made in
// code here rather than by triggers as in apps/billing.
//
// ---------------------------------------------------------------------------
// THE SLUG IS IMMUTABLE. A `slug` FIELD IS REJECTED, NOT IGNORED.
// ---------------------------------------------------------------------------
// The slug is the middle of every URN this app prints (`bc:books:<slug>/entry/12`),
// and those leave the building — in `bk` output an agent stored, in a
// fiduciary's notes. There is no rename cascade for text somebody else holds.
// The shared `bk books workspace edit --slug` flag still exists (one command for
// every app) and this 400 is what stops it: a silently dropped field reads as
// "it worked" to an agent that never re-reads. Same rule as apps/billing and
// apps/sales.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { workspaceShowRoute } from '@blackcode/platform-api/routes'
import { apiHandler, appContext, requireOwner, resolveWorkspace } from '@/lib/api'
import {
  deleteWorkspace,
  describeHoldings,
  updateWorkspace,
  WorkspaceRetained,
} from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

/** `books.workspaces.name` is varchar(80). */
const NAME_MAX = 80

export const GET = workspaceShowRoute(appContext)

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected a JSON object', 'PATCH { "name": "Household" }')
  }
  if ('slug' in body) {
    throw Errors.badRequest(
      'slug_immutable',
      'a books workspace slug cannot be changed',
      'Only the name is editable: bk books workspace edit --name "…". The slug is part of ' +
        'every URN this app has printed, and those live in other systems with no rename cascade.'
    )
  }
  if (typeof body.name !== 'string') {
    throw Errors.badRequest('invalid_name', 'name is required', 'bk books workspace edit --name "Household"')
  }
  const name = body.name.trim()
  if (!name) throw Errors.badRequest('invalid_name', 'name cannot be empty', 'bk books workspace edit --name "Household"')
  if (name.length > NAME_MAX) {
    throw Errors.badRequest('name_too_long', `name max ${NAME_MAX} chars`, 'a shorter name')
  }

  const updated = await updateWorkspace(ctx.workspace.id, { name })
  if (!updated) throw Errors.notFound('workspace')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  try {
    const deleted = await deleteWorkspace(ctx.workspace.id)
    if (!deleted) throw Errors.notFound('workspace')
  } catch (e) {
    if (e instanceof WorkspaceRetained) {
      throw Errors.conflict(
        'workspace_retained',
        `${ctx.workspace.name} cannot be deleted: it holds ${describeHoldings(e.holdings)}. ` +
          'Accounting records are kept for ten years (art. 958f CO), and a workspace that has ' +
          'held any is kept with them.',
        'Only a workspace that never held anything can be deleted. To stop using this one, hand ' +
          'it on (bk books workspace transfer --to <user_id>) or leave it (bk books member remove <your id>).'
      )
    }
    throw e
  }
  return NextResponse.json({ deleted: true })
})
