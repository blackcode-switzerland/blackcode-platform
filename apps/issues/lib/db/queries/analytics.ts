// Workspace analytics. One entry point: computeAnalytics(opts) returns a fully
// shaped AnalyticsPayload for the requested view + scope + date range + filters.
//
// All queries are workspace-scoped — there is no cross-workspace leakage.
// We accept the cost of computing live (no materialized views) up to roughly
// 100k events per workspace. Optimization is future work and only if measured.
//
// The payload powers the analytics dashboard (components/analytics-view.tsx)
// and the print/PDF view. It is intentionally rich: headline KPIs with
// previous-period trends, time series (velocity, cumulative flow, activity),
// distributions (status / priority / assignee / label / project), and
// statistical breakdowns (cycle-time histogram, open-issue aging). Everything
// honours the active faceted filters so charts stay consistent with one another.

import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client'
import { comments, events, issueAssignees, issueLabels, issues, labels, projects, tasks, users, workspaceMembers, workspaces } from '../schema'
import { visibleToThisApp } from './labels'

export type AnalyticsView = 'workspace' | 'project' | 'task' | 'member' | 'overview'
export type AnalyticsInterval = 'day' | 'week'

export interface AnalyticsFilters {
  status?: string[]
  priority?: number[]
  label?: number[]
  assignee?: number[]
}

export interface AnalyticsScope {
  type: AnalyticsView
  id: number | null
  label: string
}

export interface TrendStat {
  current: number
  previous: number | null
  // Percent change vs previous window. null when no comparable previous window.
  pct: number | null
}

export interface AnalyticsPayload {
  scope: AnalyticsScope
  period: { from: string | null; to: string | null; interval: AnalyticsInterval }
  filters: AnalyticsFilters
  summary: {
    total_issues: number
    open: number
    backlog: number
    in_progress: number
    done: number
    cancelled: number
    overdue: number
    unassigned: number
    created_in_period: number
    completed_in_period: number
    avg_cycle_time_hours: number | null
    median_cycle_time_hours: number | null
    completion_rate: number // percent of non-cancelled issues that are done
    open_estimate_hours: number | null
    total_members: number
    active_members_in_period: number
  }
  trends: {
    created: TrendStat
    completed: TrendStat
    cycle_time: TrendStat
    active_members: TrendStat
  }
  by_status: Array<{ status: string; count: number }>
  by_priority: Array<{ priority: number; count: number }>
  by_assignee: Array<{
    user_id: number
    name: string | null
    email: string
    avatar_url: string | null
    open: number
    done: number
    avg_cycle_time_hours: number | null
  }>
  by_label: Array<{ label_id: number; name: string; color: string; count: number }>
  by_project: Array<{
    project_id: number
    name: string
    color: string | null
    icon: string | null
    total: number
    done: number
    open: number
  }>
  velocity_series: Array<{ bucket: string; created: number; completed: number }>
  cycle_time_buckets: Array<{ label: string; count: number }>
  aging_buckets: Array<{ label: string; count: number }>
  activity_series: Array<{ bucket: string; count: number }>
  activity_by_action: Array<{ action: string; count: number }>
  burndown_series?: Array<{ date: string; remaining: number; ideal: number }>
  top_active_members: Array<{ user_id: number; name: string | null; avatar_url: string | null; events: number }>
}

export interface ComputeAnalyticsInput {
  workspaceId: number
  view: AnalyticsView
  id?: number | null
  from?: Date | null
  to?: Date | null
  interval?: AnalyticsInterval
  filters?: AnalyticsFilters
  // Whether to also compute the equal-length window before [from, to] for the
  // trend badges. Default: yes when both bounds are given. The overview passes
  // false for "All", where it hands over a synthetic `from` (the first issue)
  // and a "previous period" would be a window before anything existed.
  comparePrevious?: boolean
}

// ---------- where-clause builders ----------

// Faceted filters appended to every issue query. Keeps all charts consistent.
function filterWhere(f?: AnalyticsFilters): SQL {
  const parts: SQL[] = []
  if (f?.status?.length) {
    parts.push(sql`i.status IN (${sql.join(f.status.map((s) => sql`${s}`), sql`, `)})`)
  }
  if (f?.priority?.length) {
    parts.push(sql`i.priority IN (${sql.join(f.priority.map((p) => sql`${p}`), sql`, `)})`)
  }
  if (f?.assignee?.length) {
    parts.push(
      sql`i.id IN (SELECT ia.issue_id FROM ${issueAssignees} ia WHERE ia.user_id IN (${sql.join(f.assignee.map((a) => sql`${a}`), sql`, `)}))`
    )
  }
  if (f?.label?.length) {
    parts.push(
      sql`i.id IN (SELECT il.issue_id FROM ${issueLabels} il WHERE il.label_id IN (${sql.join(
        f.label.map((l) => sql`${l}`),
        sql`, `
      )}))`
    )
  }
  if (!parts.length) return sql``
  return sql` AND ${sql.join(parts, sql` AND `)}`
}

// Build a SQL fragment that restricts the issues query to the requested scope.
function scopeWhere(input: ComputeAnalyticsInput): SQL {
  // Binned issues never count toward analytics. This base predicate flows into
  // every issue-derived query via ${where}. The burndown sub-selects bypass
  // `where`, so they carry the `deleted_at IS NULL` filter explicitly.
  const base = sql`i.workspace_id = ${input.workspaceId} AND i.deleted_at IS NULL`
  let scoped: SQL = base
  if (input.view === 'project' && input.id != null) {
    scoped = sql`${base} AND i.project_id = ${input.id}`
  } else if (input.view === 'task' && input.id != null) {
    scoped = sql`${base} AND i.task_id = ${input.id}`
  } else if (input.view === 'member' && input.id != null) {
    // Issues this member is involved with: assignee OR reporter.
    scoped = sql`${base} AND (EXISTS (SELECT 1 FROM ${issueAssignees} ia WHERE ia.issue_id = i.id AND ia.user_id = ${input.id}) OR i.reporter_id = ${input.id})`
  }
  return sql`${scoped}${filterWhere(input.filters)}`
}

async function resolveScope(input: ComputeAnalyticsInput): Promise<AnalyticsScope> {
  if (input.view === 'workspace') {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM ${workspaces} WHERE id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'workspace', id: null, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'project' && input.id != null) {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM ${projects} WHERE id = ${input.id} AND workspace_id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'project', id: input.id, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'task' && input.id != null) {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM ${tasks} WHERE id = ${input.id} AND workspace_id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'task', id: input.id, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'member' && input.id != null) {
    const rows = await db.execute<{ email: string; name: string | null }>(
      sql`SELECT email, name FROM ${users} WHERE id = ${input.id} LIMIT 1`
    )
    return { type: 'member', id: input.id, label: rows.rows[0]?.name ?? rows.rows[0]?.email ?? '' }
  }
  return { type: input.view, id: input.id ?? null, label: '' }
}

// Window-scoped throughput + cycle-time figures. Run once for the current
// window and once for the previous (equal-length) window to compute trends.
interface WindowStats {
  created: number
  completed: number
  cycle_avg: number | null
  cycle_median: number | null
}

async function windowStats(where: SQL, from: Date, to: Date): Promise<WindowStats> {
  const rows = await db.execute<{
    created: number
    completed: number
    cycle_avg: number | null
    cycle_median: number | null
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE i.created_at BETWEEN ${from} AND ${to})::int AS created,
      COUNT(*) FILTER (WHERE i.status = 'done' AND i.completed_at BETWEEN ${from} AND ${to})::int AS completed,
      AVG(EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600)
        FILTER (WHERE i.completed_at BETWEEN ${from} AND ${to}) AS cycle_avg,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600)
        FILTER (WHERE i.completed_at BETWEEN ${from} AND ${to}) AS cycle_median
    FROM ${issues} i
    WHERE ${where}
  `)
  const r = rows.rows[0]
  return {
    created: Number(r?.created ?? 0),
    completed: Number(r?.completed ?? 0),
    cycle_avg: r?.cycle_avg == null ? null : Number(r.cycle_avg),
    cycle_median: r?.cycle_median == null ? null : Number(r.cycle_median),
  }
}

function pctChange(current: number, previous: number | null): number | null {
  if (previous == null) return null
  if (previous === 0) return current === 0 ? 0 : 100
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10
}

export async function computeAnalytics(input: ComputeAnalyticsInput): Promise<AnalyticsPayload> {
  const interval: AnalyticsInterval = input.interval === 'week' ? 'week' : 'day'
  const scope = await resolveScope(input)
  const where = scopeWhere(input)

  // Effective series window: default to last 30 days when unbounded.
  const from = input.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const to = input.to ?? new Date()

  // ---------- snapshot summary (scope-wide, not windowed) ----------
  const summaryRows = await db.execute<{
    total_issues: number
    backlog: number
    open: number
    in_progress: number
    done: number
    cancelled: number
    overdue: number
    unassigned: number
    open_estimate: number | null
  }>(sql`
    SELECT
      COUNT(*)::int AS total_issues,
      COUNT(*) FILTER (WHERE i.status = 'backlog')::int AS backlog,
      COUNT(*) FILTER (WHERE i.status IN ('backlog','todo'))::int AS open,
      COUNT(*) FILTER (WHERE i.status = 'in_progress')::int AS in_progress,
      COUNT(*) FILTER (WHERE i.status = 'done')::int AS done,
      COUNT(*) FILTER (WHERE i.status = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled') AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE)::int AS overdue,
      COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled') AND NOT EXISTS (SELECT 1 FROM ${issueAssignees} ia WHERE ia.issue_id = i.id))::int AS unassigned,
      (SUM(i.estimated_hours) FILTER (WHERE i.status NOT IN ('done','cancelled')))::float8 AS open_estimate
    FROM ${issues} i
    WHERE ${where}
  `)
  const s = summaryRows.rows[0]

  // ---------- window throughput + trends ----------
  const span = to.getTime() - from.getTime()
  const prevTo = from
  const prevFrom = new Date(from.getTime() - span)
  const hasComparable = input.comparePrevious ?? !!(input.from && input.to)

  const [cur, prev] = await Promise.all([
    windowStats(where, from, to),
    hasComparable
      ? windowStats(where, prevFrom, prevTo)
      : Promise.resolve<WindowStats | null>(null),
  ])

  // ---------- members ----------
  const memberActorFilter =
    input.view === 'member' && input.id != null ? sql`AND e.actor_user_id = ${input.id}` : sql``
  const membersRows = await db.execute<{ total: number; active: number; active_prev: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM ${workspaceMembers} WHERE workspace_id = ${input.workspaceId}) AS total,
      (SELECT COUNT(DISTINCT e.actor_user_id)::int FROM ${events} e
        WHERE e.workspace_id = ${input.workspaceId} AND e.actor_user_id IS NOT NULL ${memberActorFilter}
          AND e.occurred_at BETWEEN ${from} AND ${to}) AS active,
      (SELECT COUNT(DISTINCT e.actor_user_id)::int FROM ${events} e
        WHERE e.workspace_id = ${input.workspaceId} AND e.actor_user_id IS NOT NULL ${memberActorFilter}
          AND e.occurred_at BETWEEN ${prevFrom} AND ${prevTo}) AS active_prev
  `)
  const members = membersRows.rows[0] ?? { total: 0, active: 0, active_prev: 0 }

  // ---------- distributions ----------
  const byStatusRows = await db.execute<{ status: string; count: number }>(sql`
    SELECT i.status, COUNT(*)::int AS count
    FROM ${issues} i WHERE ${where}
    GROUP BY i.status ORDER BY count DESC
  `)

  const byPriorityRows = await db.execute<{ priority: number; count: number }>(sql`
    SELECT i.priority, COUNT(*)::int AS count
    FROM ${issues} i WHERE ${where}
    GROUP BY i.priority ORDER BY i.priority ASC
  `)

  const byAssigneeRows = await db.execute<{
    user_id: number
    name: string | null
    email: string
    avatar_url: string | null
    open: number
    done: number
    cycle_avg: number | null
  }>(sql`
    SELECT u.id AS user_id, u.name, u.email, u.avatar_url,
      COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open,
      COUNT(*) FILTER (WHERE i.status = 'done')::int AS done,
      AVG(EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600)
        FILTER (WHERE i.completed_at IS NOT NULL) AS cycle_avg
    FROM ${issues} i
    INNER JOIN ${issueAssignees} ia ON ia.issue_id = i.id
    INNER JOIN ${users} u ON u.id = ia.user_id
    WHERE ${where}
    GROUP BY u.id, u.name, u.email, u.avatar_url
    ORDER BY (COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled'))) DESC, done DESC
    LIMIT 25
  `)

  const byLabelRows = await db.execute<{
    label_id: number
    name: string
    color: string
    count: number
  }>(sql`
    SELECT l.id AS label_id, l.name, l.color, COUNT(*)::int AS count
    FROM ${issueLabels} il
    INNER JOIN ${issues} i ON i.id = il.issue_id
    INNER JOIN ${labels} l ON l.id = il.label_id AND ${visibleToThisApp('l')}
    WHERE ${where}
    GROUP BY l.id, l.name, l.color
    ORDER BY count DESC
    LIMIT 25
  `)

  // By project — only meaningful when not already scoped to a single project.
  let byProject: AnalyticsPayload['by_project'] = []
  if (input.view === 'workspace' || input.view === 'member') {
    const byProjectRows = await db.execute<{
      project_id: number
      name: string
      color: string | null
      icon: string | null
      total: number
      done: number
      open: number
    }>(sql`
      SELECT p.id AS project_id, p.name, p.color, p.icon,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE i.status = 'done')::int AS done,
        COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open
      FROM ${issues} i
      INNER JOIN ${projects} p ON p.id = i.project_id
      WHERE ${where}
      GROUP BY p.id, p.name, p.color, p.icon
      ORDER BY total DESC
      LIMIT 12
    `)
    byProject = byProjectRows.rows
  }

  // ---------- velocity series (created vs completed per bucket) ----------
  const trunc = interval === 'week' ? sql.raw(`'week'`) : sql.raw(`'day'`)
  const step = interval === 'week' ? sql.raw(`interval '1 week'`) : sql.raw(`interval '1 day'`)
  const velocityRows = await db.execute<{
    bucket: string
    created: number
    completed: number
  }>(sql`
    WITH buckets AS (
      SELECT generate_series(date_trunc(${trunc}, ${from}::timestamptz),
                             date_trunc(${trunc}, ${to}::timestamptz),
                             ${step})::date AS d
    )
    SELECT
      to_char(buckets.d, 'YYYY-MM-DD') AS bucket,
      COALESCE(c.count, 0)::int AS created,
      COALESCE(done.count, 0)::int AS completed
    FROM buckets
    LEFT JOIN (
      SELECT date_trunc(${trunc}, i.created_at)::date AS d, COUNT(*) AS count
      FROM ${issues} i WHERE ${where} AND i.created_at BETWEEN ${from} AND ${to} GROUP BY 1
    ) c ON c.d = buckets.d
    LEFT JOIN (
      SELECT date_trunc(${trunc}, i.completed_at)::date AS d, COUNT(*) AS count
      FROM ${issues} i WHERE ${where} AND i.completed_at BETWEEN ${from} AND ${to} GROUP BY 1
    ) done ON done.d = buckets.d
    ORDER BY buckets.d ASC
  `)

  // ---------- cycle-time histogram (completed issues in window) ----------
  const cycleBucketRows = await db.execute<{ bucket: string; count: number }>(sql`
    WITH ct AS (
      SELECT EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600 AS hours
      FROM ${issues} i
      WHERE ${where} AND i.completed_at BETWEEN ${from} AND ${to}
    )
    SELECT b AS bucket, COALESCE(COUNT(ct.hours), 0)::int AS count
    FROM (VALUES ('< 1d',0),('1–3d',1),('3–7d',2),('1–2w',3),('2–4w',4),('> 4w',5)) AS labels(b, ord)
    LEFT JOIN ct ON (
      CASE
        WHEN ct.hours < 24 THEN '< 1d'
        WHEN ct.hours < 72 THEN '1–3d'
        WHEN ct.hours < 168 THEN '3–7d'
        WHEN ct.hours < 336 THEN '1–2w'
        WHEN ct.hours < 672 THEN '2–4w'
        ELSE '> 4w'
      END
    ) = labels.b
    GROUP BY b, ord
    ORDER BY ord
  `)

  // ---------- aging of currently-open issues ----------
  const agingRows = await db.execute<{ bucket: string; count: number }>(sql`
    WITH op AS (
      SELECT EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 86400 AS days
      FROM ${issues} i
      WHERE ${where} AND i.status NOT IN ('done','cancelled')
    )
    SELECT b AS bucket, COALESCE(COUNT(op.days), 0)::int AS count
    FROM (VALUES ('< 1d',0),('1–3d',1),('3–7d',2),('1–2w',3),('2–4w',4),('> 4w',5)) AS labels(b, ord)
    LEFT JOIN op ON (
      CASE
        WHEN op.days < 1 THEN '< 1d'
        WHEN op.days < 3 THEN '1–3d'
        WHEN op.days < 7 THEN '3–7d'
        WHEN op.days < 14 THEN '1–2w'
        WHEN op.days < 28 THEN '2–4w'
        ELSE '> 4w'
      END
    ) = labels.b
    GROUP BY b, ord
    ORDER BY ord
  `)

  // ---------- activity (events) ----------
  const activitySeriesRows = await db.execute<{ bucket: string; count: number }>(sql`
    WITH buckets AS (
      SELECT generate_series(date_trunc(${trunc}, ${from}::timestamptz),
                             date_trunc(${trunc}, ${to}::timestamptz),
                             ${step})::date AS d
    )
    SELECT to_char(buckets.d, 'YYYY-MM-DD') AS bucket, COALESCE(e.count, 0)::int AS count
    FROM buckets
    LEFT JOIN (
      SELECT date_trunc(${trunc}, e.occurred_at)::date AS d, COUNT(*) AS count
      FROM ${events} e
      WHERE e.workspace_id = ${input.workspaceId} ${memberActorFilter}
        AND e.occurred_at BETWEEN ${from} AND ${to}
      GROUP BY 1
    ) e ON e.d = buckets.d
    ORDER BY buckets.d ASC
  `)

  const activityByActionRows = await db.execute<{ action: string; count: number }>(sql`
    SELECT e.action, COUNT(*)::int AS count
    FROM ${events} e
    WHERE e.workspace_id = ${input.workspaceId} ${memberActorFilter}
      AND e.occurred_at BETWEEN ${from} AND ${to}
    GROUP BY e.action
    ORDER BY count DESC
    LIMIT 12
  `)

  const topMembersRows = await db.execute<{
    user_id: number
    name: string | null
    avatar_url: string | null
    events: number
  }>(sql`
    SELECT e.actor_user_id AS user_id, u.name, u.avatar_url, COUNT(*)::int AS events
    FROM ${events} e
    LEFT JOIN ${users} u ON u.id = e.actor_user_id
    WHERE e.workspace_id = ${input.workspaceId}
      AND e.actor_user_id IS NOT NULL ${memberActorFilter}
      AND e.occurred_at BETWEEN ${from} AND ${to}
    GROUP BY e.actor_user_id, u.name, u.avatar_url
    ORDER BY events DESC
    LIMIT 10
  `)

  // ---------- optional task burndown (with ideal line) ----------
  let burndown: AnalyticsPayload['burndown_series']
  if (input.view === 'task' && input.id != null) {
    const m = await db.execute<{ due_date: string | null }>(
      sql`SELECT due_date FROM ${tasks} WHERE id = ${input.id} LIMIT 1`
    )
    const due = m.rows[0]?.due_date
    if (due) {
      const series = await db.execute<{ date: string; remaining: number }>(sql`
        WITH bounds AS (
          SELECT
            COALESCE((SELECT MIN(i.created_at) FROM ${issues} i WHERE i.task_id = ${input.id} AND i.deleted_at IS NULL), NOW() - interval '14 days') AS start_at,
            (${due}::date + interval '1 day') AS end_at
        ),
        days AS (
          SELECT generate_series(date_trunc('day', (SELECT start_at FROM bounds)),
                                 date_trunc('day', (SELECT end_at FROM bounds)),
                                 interval '1 day')::date AS d
        )
        SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
          (SELECT COUNT(*)::int FROM ${issues} i
           WHERE i.task_id = ${input.id}
             AND i.deleted_at IS NULL
             AND i.created_at <= days.d + interval '1 day'
             AND (i.completed_at IS NULL OR i.completed_at > days.d + interval '1 day')) AS remaining
        FROM days
        ORDER BY days.d
      `)
      // Ideal line: straight descent from the peak remaining to zero across the span.
      const rows = series.rows
      const peak = rows.reduce((m2, r) => Math.max(m2, Number(r.remaining)), 0)
      const lastIdx = rows.length - 1
      burndown = rows.map((r, i) => ({
        date: r.date,
        remaining: Number(r.remaining),
        ideal: lastIdx <= 0 ? 0 : Math.max(0, Math.round((peak * (lastIdx - i)) / lastIdx)),
      }))
    }
  }

  const doneCount = Number(s?.done ?? 0)
  const cancelledCount = Number(s?.cancelled ?? 0)
  const totalIssues = Number(s?.total_issues ?? 0)
  const nonCancelled = totalIssues - cancelledCount
  const completionRate = nonCancelled > 0 ? Math.round((doneCount / nonCancelled) * 1000) / 10 : 0

  return {
    scope,
    period: {
      from: input.from?.toISOString() ?? null,
      to: input.to?.toISOString() ?? null,
      interval,
    },
    filters: input.filters ?? {},
    summary: {
      total_issues: totalIssues,
      open: Number(s?.open ?? 0),
      backlog: Number(s?.backlog ?? 0),
      in_progress: Number(s?.in_progress ?? 0),
      done: doneCount,
      cancelled: cancelledCount,
      overdue: Number(s?.overdue ?? 0),
      unassigned: Number(s?.unassigned ?? 0),
      created_in_period: cur.created,
      completed_in_period: cur.completed,
      avg_cycle_time_hours: round1(cur.cycle_avg),
      median_cycle_time_hours: round1(cur.cycle_median),
      completion_rate: completionRate,
      open_estimate_hours: round1(s?.open_estimate ?? null),
      total_members: Number(members.total),
      active_members_in_period: Number(members.active),
    },
    trends: {
      created: {
        current: cur.created,
        previous: prev ? prev.created : null,
        pct: prev ? pctChange(cur.created, prev.created) : null,
      },
      completed: {
        current: cur.completed,
        previous: prev ? prev.completed : null,
        pct: prev ? pctChange(cur.completed, prev.completed) : null,
      },
      cycle_time: {
        current: round1(cur.cycle_avg) ?? 0,
        previous: prev ? round1(prev.cycle_avg) : null,
        pct: prev && cur.cycle_avg != null && prev.cycle_avg != null
          ? pctChange(cur.cycle_avg, prev.cycle_avg)
          : null,
      },
      active_members: {
        current: Number(members.active),
        previous: hasComparable ? Number(members.active_prev) : null,
        pct: hasComparable ? pctChange(Number(members.active), Number(members.active_prev)) : null,
      },
    },
    by_status: byStatusRows.rows,
    by_priority: byPriorityRows.rows,
    by_assignee: byAssigneeRows.rows.map((a) => ({
      user_id: a.user_id,
      name: a.name,
      email: a.email,
      avatar_url: a.avatar_url,
      open: Number(a.open),
      done: Number(a.done),
      avg_cycle_time_hours: round1(a.cycle_avg == null ? null : Number(a.cycle_avg)),
    })),
    by_label: byLabelRows.rows,
    by_project: byProject,
    velocity_series: velocityRows.rows,
    cycle_time_buckets: cycleBucketRows.rows.map((r) => ({ label: r.bucket, count: Number(r.count) })),
    aging_buckets: agingRows.rows.map((r) => ({ label: r.bucket, count: Number(r.count) })),
    activity_series: activitySeriesRows.rows,
    activity_by_action: activityByActionRows.rows,
    burndown_series: burndown,
    top_active_members: topMembersRows.rows,
  }
}

// Legacy helper retained for any old caller.
export async function getAnalytics() {
  return await computeAnalytics({ workspaceId: 0, view: 'workspace' })
}
