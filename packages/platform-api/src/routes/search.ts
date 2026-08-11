// GET /api/workspaces/{ws}/search — federated search across every app's
// entities in one workspace.
//
// This route reads `platform.entities` and NOTHING ELSE. That is the point, not
// an implementation detail: an app's own tables are unreadable to another app's
// Postgres role by design (docs/platform-architecture.md §4.3), so a search that
// queried each app's own tables could not be written at all — not awkwardly,
// literally not, as a database grant. Searching the shared projection is what
// makes `bk search` one query instead of a fan-out an agent has to assemble.
//
// It is deliberately NOT a replacement for `?search=` on an app's own listings.
// Those search descriptions and filter by status, assignee and label — this one
// answers "where is the thing called X, in any app".
//
// Mounted by each app, unchanged, in three lines:
//
//   import { searchRoute } from '@blackcode/platform-api/routes'
//   import { appContext } from '@/lib/api'
//   export const GET = searchRoute(appContext)
//
// The app in `appContext` is what the caller must have access to — a user
// granted sales but not issues reaches this through the sales host, and gets the
// same answer, which is the whole reason the route had to stop living inside one
// app's tree (docs/sales-app-plan.md B-2).

import type { NextRequest } from 'next/server'
import { searchEntities } from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace } from '../handler'
import { SEARCH_QUERY_MIN, SEARCH_RESULTS_MAX } from '../limits'
import { jsonList } from '../responses'

interface Params {
  params: Promise<{ ws: string }>
}

export function searchRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  return apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    const sp = req.nextUrl.searchParams

    const q = (sp.get('q') ?? '').trim()
    if (q.length < SEARCH_QUERY_MIN) {
      throw Errors.badRequest(
        'query_too_short',
        `q must be at least ${SEARCH_QUERY_MIN} character(s)`,
        // Built from `appSlug`, not typed as a literal. The bare `bk search`
        // this used to name was removed on 2026-08-10 — the verb is app-owned
        // now — so a hard-coded spelling here would hand an agent a hint that
        // exits 2, which is worse than no hint. Interpolating means the hint is
        // correct for whichever app mounts the route, including the next one.
        `pass a longer query, e.g. \`bk ${app.appSlug} search auth\``
      )
    }

    const limitRaw = sp.get('limit')
    let limit: number | undefined
    if (limitRaw !== null) {
      limit = parseInt(limitRaw)
      if (Number.isNaN(limit) || limit < 1 || limit > SEARCH_RESULTS_MAX) {
        throw Errors.badRequest('invalid_limit', `limit must be 1..${SEARCH_RESULTS_MAX}`)
      }
    }

    const csv = (name: string) => {
      const raw = sp.get(name)
      if (!raw) return undefined
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
      return parts.length > 0 ? parts : undefined
    }

    const results = await searchEntities(app.db, {
      workspaceId: ctx.workspace.id,
      query: q,
      apps: csv('app'),
      entityTypes: csv('type'),
      includeDeleted: sp.get('include_deleted') === '1',
      limit,
    })

    return jsonList(results)
  })
}
