// GET    /api/workspaces/{ws} — `bk billing workspace show`, and what
//        `bk billing workspace use` resolves a slug against before saving it.
// PATCH  /api/workspaces/{ws} — `bk billing workspace edit --name` (name only).
// DELETE /api/workspaces/{ws} — `bk billing workspace delete <slug> --confirm <slug>`,
//        and ONLY for a workspace that holds no retained record.
//
// **`bk workspace use <slug>` RESOLVES THROUGH GET.** That makes it the single
// most load-bearing platform route for a new app: almost every other command
// needs an active workspace. It was the first thing to break in the sales
// north-star run.
//
// ---------------------------------------------------------------------------
// PATCH AND DELETE ARRIVED IN PHASE 2 (2026-09-21) — THE OLD REFUSAL, REVISED
// ---------------------------------------------------------------------------
// Until then this file served GET alone and `lib/cli-parity.test.ts` listed
// PATCH and DELETE as unserved, with "deliberately no DELETE ever: a workspace
// holds invoices". Half of that survives. A workspace holding invoices (or a
// company, a series, an imported bill, an audit row) still cannot be deleted —
// and not because this route says so: every one of those tables has a BEFORE
// DELETE trigger that also fires on the cascade. What changed is that an EMPTY
// workspace — the one somebody created by mistake — can go, and that the
// refusal for the other kind is a 409 with the reason rather than a 500
// carrying a trigger message. The whole decision: `deleteWorkspace` in
// `lib/db/queries/workspaces.ts`.
//
// ---------------------------------------------------------------------------
// THE SLUG IS IMMUTABLE. A `slug` FIELD IS REJECTED, NOT IGNORED.
// ---------------------------------------------------------------------------
// The slug is the middle of every URN this app prints
// (`bc:billing:<slug>/invoice/12`), and those URNs leave the building: they
// are in integrators' databases (`external_ref` round-trips), in `bk` output an
// agent stored, in audit prose. There is no rename cascade for text somebody
// else holds. The shared `bk billing workspace edit --slug` flag still exists
// (one command for every app, `cli/internal/appverbs/workspace.go`) and this
// 400 is what stops it — the same shape `apps/sales` chose, for the same reason:
// a silently dropped field reads as "it worked" to an agent that never re-reads.
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
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = workspaceShowRoute(appContext)

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected a JSON object', 'PATCH { "name": "Acme SA" }')
  }
  if ('slug' in body) {
    throw Errors.badRequest(
      'slug_immutable',
      'a billing workspace slug cannot be changed',
      'Only the name is editable: bk billing workspace edit --name "…". The slug is part of ' +
        'every URN this app has printed, and those live in other systems with no rename cascade.'
    )
  }
  if (typeof body.name !== 'string') {
    throw Errors.badRequest('invalid_name', 'name is required', 'bk billing workspace edit --name "Acme SA"')
  }
  const name = body.name.trim()
  if (!name) throw Errors.badRequest('invalid_name', 'name cannot be empty', 'bk billing workspace edit --name "Acme SA"')
  if (name.length > WORKSPACE_NAME_MAX) {
    throw Errors.badRequest('name_too_long', `name max ${WORKSPACE_NAME_MAX} chars`, 'a shorter name')
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
          'Invoices and their records are kept for ten years (art. 958f CO), and nothing in ' +
          'this app is ever hard-deleted.',
        'Only a workspace nobody ever issued from can be deleted. To stop using this one, retire its ' +
          'companies (bk billing company retire <slug>) or hand it on ' +
          '(bk billing workspace transfer --to <user_id>).'
      )
    }
    throw e
  }
  return NextResponse.json({ deleted: true })
})
