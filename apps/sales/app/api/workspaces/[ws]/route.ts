// GET /api/workspaces/{ws} — `bk workspace show`, and what `bk workspace use`
// resolves a slug against before saving it.
// PATCH /api/workspaces/{ws} — `bk sales workspace edit` (name only — see below).
// DELETE /api/workspaces/{ws} — `bk sales workspace delete`.
//
// ---------------------------------------------------------------------------
// PATCH AND DELETE WERE DELIBERATELY ABSENT UNTIL 2026-09-11 — D-3 REVERSED
// ---------------------------------------------------------------------------
// This file used to say:
//
//   > **PATCH and DELETE are deliberately absent.** Renaming a workspace or
//   > deleting one is company-level administration: `updateWorkspace` and
//   > `deleteWorkspace` are still app-local to issues, and a workspace delete
//   > carries a cascade that has exactly one implementation on purpose. Sales
//   > reads the workspace it is working in; it does not administer it.
//   > `bk workspace edit | delete | transfer` are answered by the issues
//   > deployment, and reaching them from here now says so with the app named
//   > and the flag to use.
//
// It was true on that date. The product decision reversing D-3 gives sales the
// same admin capability issues has: create, rename, transfer ownership,
// delete. `updateWorkspace` and `deleteWorkspace` below are this app's own —
// same reasoning `apps/issues`' equivalent route gives (events go through this
// app's own spine, not a shared factory) — so PATCH and DELETE stay real
// handlers here rather than calls into `@blackcode/platform-api/routes`.
//
// ---------------------------------------------------------------------------
// PATCH IS NAME-ONLY. A `slug` FIELD IS REJECTED, NOT SILENTLY IGNORED.
// ---------------------------------------------------------------------------
// `apps/issues`' PATCH accepts `slug` because renaming a slug there cascades
// into `platform.entities` (`renameWorkspaceEntities`) — the denormalized URN
// index that app maintains. Sales has no such projection (Phase 3 ended it
// entirely) and no reconciliation mechanism for `sales.events.subject_urn`,
// the text column it denormalizes instead — see `updateWorkspace`'s header in
// `lib/db/queries/workspaces.ts` for the full reasoning. So the slug stays
// immutable here, and a caller that sends one gets told why rather than a
// silently-dropped field, which would read as "it worked" to an agent that
// never re-fetched to check.
//
// The CLI's shared `bk <app> workspace edit --slug` flag (one command shared
// by every app, `cli/internal/appverbs/workspace.go`) still compiles and sends
// for sales — this 400 is what stops it, not a fork of that command. See
// `cli/internal/commands/sales/appverbs.go`'s header for why forking it is the
// wrong fix.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { workspaceShowRoute } from '@blackcode/platform-api/routes'
import { apiHandler, resolveWorkspace, requireOwner, appContext } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { deleteWorkspace, updateWorkspace } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

// GET is the shared factory — it touches only platform-shaped reads
// (resolveWorkspace + listWorkspaceMembers), while PATCH and DELETE below call
// app-local writes with a cascade. `bk workspace use` resolves a slug through
// this route before saving it, so an app that could not serve it had a CLI
// able to list workspaces and not select one.
export const GET = workspaceShowRoute(appContext)

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  if ('slug' in body) {
    throw Errors.badRequest(
      'slug_immutable',
      'a sales workspace slug cannot be changed',
      'Only name is editable here — PATCH { "name": "…" }. The slug is embedded ' +
        'in sales.events.subject_urn with no rename cascade, unlike apps/issues.'
    )
  }
  if (!('name' in body) || typeof body.name !== 'string') {
    throw Errors.badRequest('invalid_name', 'name is required')
  }
  const name = body.name.trim()
  if (!name) throw Errors.badRequest('invalid_name', 'name cannot be empty')
  if (name.length > WORKSPACE_NAME_MAX) {
    throw Errors.badRequest('name_too_long', `name max ${WORKSPACE_NAME_MAX} chars`)
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const updated = await updateWorkspace(ctx.workspace.id, { name }, actor)
  if (!updated) throw Errors.notFound('workspace')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  await deleteWorkspace(ctx.workspace.id)
  return NextResponse.json({ deleted: true })
})
