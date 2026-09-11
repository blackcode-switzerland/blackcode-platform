// GET /api/workspaces — `bk workspace list`, and what `bk workspace use` reads.
// POST /api/workspaces — `bk sales workspace create`.
//
// WITHOUT GET, A SALES-HOMED CLI CANNOT SET AN ACTIVE WORKSPACE, so the first
// two commands of the north-star script fail and nothing after them runs.
//
// ---------------------------------------------------------------------------
// POST WAS DELIBERATELY ABSENT UNTIL 2026-09-11 — D-3 REVERSED
// ---------------------------------------------------------------------------
// This file used to say:
//
//   > **POST is deliberately absent.** D-3: sales has no create-workspace
//   > flow — a workspace is the company, and it is created where people are
//   > onboarded. `bk workspace create` is answered by the issues deployment.
//   > That is a real capability decision, not a gap, which is why it is
//   > written here rather than only in a test's exclusion list.
//
// It was true on that date. The product decision reversing D-3: sales now
// matches issues' capability — create, rename, transfer ownership, delete —
// with the same web + CLI + route parity every other capability in this app
// carries. `createWorkspace` records events through this app's own event
// spine (`recordEvent` → `sales.events`), which is not extracted to shared
// code — the same reasoning `apps/issues`' equivalent route gives for why its
// POST is app-local rather than a shared factory — so this stays a real
// handler here rather than a call into `@blackcode/platform-api/routes`.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { apiHandler, appContext } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createWorkspace } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

export const GET = workspacesRoute(appContext)

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await appContext.resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > WORKSPACE_NAME_MAX)
    throw Errors.badRequest('name_too_long', `name max ${WORKSPACE_NAME_MAX} chars`)

  const actor = await resolveActor(getDb(), request, user)
  const ws = await createWorkspace({ name }, actor)
  return NextResponse.json(ws, { status: 201 })
})
