// Shared parser for analytics query params, used by the canonical
// workspace-scoped route (/api/workspaces/[ws]/analytics) — which both the web
// dashboard and the `bk analytics` CLI command now call — so every surface
// exposes the exact same views, date window, granularity and faceted filters.

import { Errors } from '@blackcode/platform-api'
import type {
  AnalyticsFilters,
  AnalyticsInterval,
  AnalyticsView,
} from '@/lib/db/queries/analytics'

const ALLOWED_VIEWS = new Set<AnalyticsView>(['workspace', 'project', 'task', 'member', 'overview'])

export interface ParsedAnalyticsParams {
  view: AnalyticsView
  id: number | null
  from: Date | null
  to: Date | null
  interval: AnalyticsInterval
  filters: AnalyticsFilters
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// Parse a repeatable and/or CSV query param into a deduped string list.
// Accepts both ?status=a&status=b and ?status=a,b.
function parseList(sp: URLSearchParams, key: string): string[] {
  const values = sp.getAll(key).flatMap((v) => v.split(','))
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function parseFilters(sp: URLSearchParams): AnalyticsFilters {
  const status = parseList(sp, 'status')
  const priority = parseList(sp, 'priority')
    .map((p) => parseInt(p, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
  const label = parseList(sp, 'label')
    .map((l) => parseInt(l, 10))
    .filter((n) => Number.isInteger(n))
  const assignee = parseList(sp, 'assignee')
    .map((a) => parseInt(a, 10))
    .filter((n) => Number.isInteger(n))
  const filters: AnalyticsFilters = {}
  if (status.length) filters.status = status
  if (priority.length) filters.priority = priority
  if (label.length) filters.label = label
  if (assignee.length) filters.assignee = assignee
  return filters
}

/**
 * Validate + normalise analytics query params. Throws `Errors.badRequest` on
 * an invalid view, a missing/invalid `id` for non-workspace views, or an
 * inverted date range.
 */
export function parseAnalyticsParams(sp: URLSearchParams): ParsedAnalyticsParams {
  const view = (sp.get('view') ?? 'workspace') as AnalyticsView
  if (!ALLOWED_VIEWS.has(view)) {
    throw Errors.badRequest(
      'invalid_view',
      'view must be one of: workspace, project, task, member, overview',
      'Use view=overview for the workspace overview (leaderboard, project health, attention lists)'
    )
  }

  let id: number | null = null
  if (view !== 'workspace' && view !== 'overview') {
    const raw = sp.get('id')
    if (!raw) {
      throw Errors.badRequest('missing_id', `view=${view} requires id`)
    }
    const parsed = parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      throw Errors.badRequest('invalid_id', 'id must be an integer')
    }
    id = parsed
  }

  const from = parseDate(sp.get('from'))
  const to = parseDate(sp.get('to'))
  if (from && to && from > to) {
    throw Errors.badRequest('invalid_range', 'from must be before to')
  }

  const interval: AnalyticsInterval = sp.get('interval') === 'week' ? 'week' : 'day'

  return {
    view,
    id,
    from: from ?? null,
    to: to ?? null,
    interval,
    filters: parseFilters(sp),
  }
}
