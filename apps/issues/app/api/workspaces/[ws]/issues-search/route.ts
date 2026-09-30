// GET /api/workspaces/{ws}/issues-search?q=&type=&per_type=&limit=&include_deleted=
// — search INSIDE this app's records: issues, tasks, projects, labels, members
// and comments, ranked, with the snippet a match was found in.
//
// A DIFFERENT PATH FROM `/search` ON PURPOSE, the same call `apps/sales` made
// (`/sales-search`, its D-9). `/api/workspaces/{ws}/search` is the platform
// route (`searchRoute`): it reads `platform.entities` — titles of issues, tasks
// and projects, nothing else — and its header forbids it learning about any one
// app. This reads the source tables, so it can see a label, a person, a phrase in
// a description or a comment. Serving both under one path would make the answer
// depend on which one a caller reached; two paths make the difference visible.
// `/search` stays mounted for CLI binaries that predate this route.
//
// Read `lib/db/queries/workspace-search.ts` before changing what a hit contains:
// it is the web popup's whole contract and `bk issues search`'s output.

import { NextRequest } from 'next/server'
import { apiHandler, Errors, jsonList, resolveWorkspace } from '@/lib/api'
import { searchWorkspace } from '@/lib/db/queries/workspace-search'
import { SEARCH_QUERY_MIN, SEARCH_RESULTS_MAX } from '@/lib/limits'
import {
  SEARCH_PER_TYPE_DEFAULT,
  SEARCH_PER_TYPE_MAX,
  SEARCH_PER_TYPE_SINGLE_DEFAULT,
  SEARCH_TYPES,
  type SearchType,
} from '@/lib/search-types'

interface Params {
  params: Promise<{ ws: string }>
}

function intParam(raw: string | null, name: string, max: number): number | undefined {
  if (raw === null) return undefined
  const v = Number(raw)
  if (!Number.isInteger(v) || v < 1 || v > max) {
    throw Errors.badRequest('invalid_' + name, `${name} must be an integer 1..${max}`)
  }
  return v
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  const q = (sp.get('q') ?? '').trim()
  if (q.length < SEARCH_QUERY_MIN) {
    throw Errors.badRequest(
      'query_too_short',
      `q must be at least ${SEARCH_QUERY_MIN} character(s)`,
      'pass a longer query, e.g. `bk issues search auth`'
    )
  }

  const types = (sp.get('type') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const t of types) {
    if (!(SEARCH_TYPES as readonly string[]).includes(t)) {
      throw Errors.badRequest(
        'unknown_type',
        `unknown search type ${JSON.stringify(t)}`,
        'run `bk meta` for the searchable types (search_types)'
      )
    }
  }

  // One type asked for means the caller is drilling in — give it room. Several
  // means an overview, where one chatty type must not crowd out the rest.
  const perType =
    intParam(sp.get('per_type'), 'per_type', SEARCH_PER_TYPE_MAX) ??
    (types.length === 1 ? SEARCH_PER_TYPE_SINGLE_DEFAULT : SEARCH_PER_TYPE_DEFAULT)
  const limit = intParam(sp.get('limit'), 'limit', SEARCH_RESULTS_MAX)

  const hits = await searchWorkspace({
    workspaceId: ctx.workspace.id,
    workspaceSlug: ctx.workspace.slug,
    query: q,
    types: types as SearchType[],
    perType,
    limit,
    includeDeleted: sp.get('include_deleted') === '1',
  })
  return jsonList(hits, null)
})
