// Workspace overview. `GET /api/workspaces/{ws}/analytics?view=overview` — the
// payload behind /dashboard/{ws}/overview and `bk issues analytics --view overview`.
//
// It is the ANALYTICS payload for the whole workspace (computeAnalytics does the
// summary, trends, distributions and the created-vs-completed series, unchanged)
// plus one `overview` block for what only this page shows: the member
// leaderboard, project health, the attention lists, per-member workload and the
// recent-activity feed. It is a `view` of the analytics route rather than a route
// of its own so the CLI and the parity test keep one path to answer for.
//
// ---------------------------------------------------------------------------
// COUNTING RULES (the ones a reader would otherwise have to guess)
// ---------------------------------------------------------------------------
//   completed       issue is `done` and `completed_at` is inside the period, and
//                   the member is an ASSIGNEE. An issue with three assignees is
//                   one completion for each of them — never three for one person:
//                   `issue_assignees` is keyed (issue_id, user_id) and every count
//                   is COUNT(DISTINCT issue) besides. The sum over members can
//                   therefore exceed the workspace total; that is not a bug.
//   created         `created_at` is inside the period and the member is the
//                   `reporter_id`. Unlike completion, an issue has one reporter.
//   open assigned   assigned to the member and not done/cancelled, right now.
//                   A snapshot: it does not depend on the period.
//   cycle time      mean of completed_at - created_at over the issues counted as
//                   `completed` for that member and period.
//   comments        `platform.events` rows with action `commented` by the member.
//                   (Posting a comment records TWO events — `created` on the
//                   comment and `commented` on its parent — so counting either
//                   `created`/`comment` or all events would double count.)
//   activity        every `platform.events` row the member is the actor of.
//   calendar periods are UTC; a week starts on Monday.
//
// KPI "change vs previous period" for the snapshot figures (total, open, overdue,
// unassigned, completion rate) is RECONSTRUCTED from timestamps — see
// `snapshotAt`. It cannot see an assignment that was later removed or a due date
// that was later moved, and says so in the docs rather than pretending.

import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client'
import { events, issueAssignees, issues, projects, projectUpdates, tasks, users, workspaceMembers } from '../schema'
import { ISSUE_TERMINAL_STATUSES, ISSUE_STATUS_VALUES } from '@/lib/work-items'
import {
  computeAnalytics,
  type AnalyticsInterval,
  type AnalyticsPayload,
  type TrendStat,
} from './analytics'
import {
  DAY_MS,
  OVERVIEW_PERIOD_KEYS,
  PERIOD_LABELS,
  periodBounds,
  rangeLabel,
  startOfUtcWeek,
  type Bounds,
  type OverviewPeriodKey,
} from '@/lib/overview-periods'

export { OVERVIEW_PERIOD_KEYS, periodBounds, startOfUtcWeek, type OverviewPeriodKey }

// ---------- vocabulary ----------


export const LEADER_METRICS = ['completed', 'created', 'fastest_cycle', 'comments', 'activity'] as const
export type LeaderMetric = (typeof LEADER_METRICS)[number]

/** An open issue older than this many days is "old" on the attention list. */
export const OVERVIEW_OLD_OPEN_DAYS = 30
/** Rows per attention list; the list also reports its full `total`. */
export const OVERVIEW_ATTENTION_LIMIT = 5
export const OVERVIEW_ACTIVITY_LIMIT = 15
export const OVERVIEW_PROJECT_LIMIT = 24
export const OVERVIEW_WORKLOAD_LIMIT = 15
/** Weeks in the leaderboard sparkline. */
export const OVERVIEW_SPARK_WEEKS = 12
/** A range longer than this many days is bucketed by week instead of by day. */
export const OVERVIEW_WEEKLY_AFTER_DAYS = 60


// ---------- payload ----------

export interface PersonRef {
  user_id: number
  name: string | null
  email: string
  avatar_url: string | null
}

export interface LeaderboardPeriodMeta {
  key: OverviewPeriodKey
  label: string
  from: string | null
  to: string | null
}

export interface LeaderboardPeriodStats {
  created: number
  completed: number
  comments: number
  activity: number
  avg_cycle_time_hours: number | null
  // 1-based position by completed desc, then created desc, then name. Always
  // assigned (a member with nothing completed still has a position); the UI
  // only shows it — and only gives a podium place — when `completed` > 0.
  rank: number
}

export interface LeaderboardMember extends PersonRef {
  role: string
  open_assigned: number
  periods: Record<OverviewPeriodKey, LeaderboardPeriodStats>
  // Completed issues per week, oldest first, OVERVIEW_SPARK_WEEKS long. Fixed
  // window, independent of the period and the range, so it never misleads.
  spark: number[]
}

export interface Leader {
  user_ids: number[] // every member tied on the value
  value: number // hours for fastest_cycle, a count otherwise
}

export interface ProjectHealthRow {
  project_id: number
  seq: number | null
  name: string
  color: string | null
  icon: string | null
  status: string | null
  total: number
  done: number
  cancelled: number
  open: number
  progress_pct: number // done / (total - cancelled); 0 when there is nothing to do
  due_date: string | null
  health: 'on_track' | 'at_risk' | 'off_track' | null
  health_at: string | null
  health_author: string | null
}

export interface AttentionIssue {
  seq: number | null
  id: number
  title: string
  status: string
  priority: number
  due_date: string | null
  created_at: string
  age_days: number
  project_name: string | null
  assignees: Array<Omit<PersonRef, 'user_id'> & { user_id: number }>
}

export interface AttentionList {
  total: number
  items: AttentionIssue[]
}

export interface WorkloadRow extends PersonRef {
  // counts keyed by open status value, e.g. { backlog, todo, in_progress }
  by_status: Record<string, number>
  total: number
}

export interface RecentActivityRow {
  id: number
  occurred_at: string
  action: string
  entity_type: string
  // Workspace #number and title of the subject where it has one. `linkable` is
  // false when the subject is gone (deleted, purged) so the UI does not link to
  // a 404.
  entity_seq: number | null
  entity_title: string | null
  linkable: boolean
  // The new value for status_changed / priority_changed. Free text (comment
  // bodies) is deliberately NOT here — it is unsanitised HTML.
  to: string | number | null
  actor: PersonRef | null
}

export interface OverviewBlock {
  generated_at: string
  range: { from: string | null; to: string; interval: AnalyticsInterval; days: number | null }
  // Snapshot KPIs' change against the same figure at the start of the range.
  // `current` is the figure as reconstructed now, so current vs previous is
  // like-for-like; the headline number comes from `summary`.
  kpi_trends: {
    total: TrendStat
    open: TrendStat
    overdue: TrendStat
    unassigned: TrendStat
    completion_rate: TrendStat
  }
  leaderboard: {
    periods: LeaderboardPeriodMeta[]
    members: LeaderboardMember[] // sorted by the `range` period's rank
    leaders: Record<OverviewPeriodKey, Partial<Record<LeaderMetric, Leader>>>
  }
  projects: ProjectHealthRow[]
  attention: {
    old_open_days: number
    overdue: AttentionList
    urgent: AttentionList
    old_open: AttentionList
    unassigned: AttentionList
  }
  workload: { statuses: string[]; members: WorkloadRow[]; unassigned: number }
  recent_activity: RecentActivityRow[]
}

export interface OverviewPayload extends AnalyticsPayload {
  overview: OverviewBlock
}

export interface ComputeOverviewInput {
  workspaceId: number
  from?: Date | null // null/undefined = All
  to?: Date | null // defaults to now
  now?: Date // injectable for tests
}

// ---------- periods ----------

/** `col` is set and inside the (possibly open-ended) period. */
function inPeriod(col: SQL, b: Bounds): SQL {
  const parts: SQL[] = [sql`${col} IS NOT NULL`]
  if (b.from) parts.push(sql`${col} >= ${b.from}`)
  if (b.to) parts.push(sql`${col} <= ${b.to}`)
  return sql.join(parts, sql` AND `)
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10
}

function pctChange(current: number, previous: number | null): number | null {
  if (previous == null) return null
  if (previous === 0) return current === 0 ? 0 : 100
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function trend(current: number, previous: number | null): TrendStat {
  return { current, previous, pct: pctChange(current, previous) }
}

const iso = (v: unknown): string => new Date(v as string).toISOString()

// ---------- pieces ----------

const OPEN_STATUSES = ISSUE_STATUS_VALUES.filter((s) => !ISSUE_TERMINAL_STATUSES.includes(s))
const notTerminal = sql`i.status NOT IN ('done','cancelled')`
const liveIssue = (ws: number) => sql`i.workspace_id = ${ws} AND i.deleted_at IS NULL`

interface Snapshot {
  total: number
  open: number
  overdue: number
  unassigned: number
  completion_rate: number
}

// The workspace as it stood at instant `t`, from timestamps alone: an issue
// existed if created_at <= t, was open unless completed/cancelled by t, was
// overdue if open with a due date before t's date, and was unassigned if it had
// no assignment made by t. Approximate in two ways, on purpose: deleted issues
// are excluded (they cannot be reconstructed), and an assignment or due date
// changed AFTER `t` is invisible.
async function snapshotAt(workspaceId: number, t: Date): Promise<Snapshot> {
  const rows = await db.execute<{
    total: number
    open: number
    overdue: number
    unassigned: number
    done: number
    cancelled: number
  }>(sql`
    WITH s AS (
      SELECT i.id, i.due_date,
        (i.completed_at IS NOT NULL AND i.completed_at <= ${t}) AS was_done,
        (i.cancelled_at IS NOT NULL AND i.cancelled_at <= ${t}) AS was_cancelled
      FROM ${issues} i
      WHERE ${liveIssue(workspaceId)} AND i.created_at <= ${t}
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT was_done AND NOT was_cancelled)::int AS open,
      COUNT(*) FILTER (WHERE NOT was_done AND NOT was_cancelled
        AND due_date IS NOT NULL AND due_date < (${t}::timestamptz)::date)::int AS overdue,
      COUNT(*) FILTER (WHERE NOT was_done AND NOT was_cancelled
        AND NOT EXISTS (SELECT 1 FROM ${issueAssignees} ia
                        WHERE ia.issue_id = s.id AND ia.assigned_at <= ${t}))::int AS unassigned,
      COUNT(*) FILTER (WHERE was_done)::int AS done,
      COUNT(*) FILTER (WHERE was_cancelled)::int AS cancelled
    FROM s
  `)
  const r = rows.rows[0]
  const total = Number(r?.total ?? 0)
  const cancelled = Number(r?.cancelled ?? 0)
  const denom = total - cancelled
  return {
    total,
    open: Number(r?.open ?? 0),
    overdue: Number(r?.overdue ?? 0),
    unassigned: Number(r?.unassigned ?? 0),
    completion_rate: denom > 0 ? Math.round((Number(r?.done ?? 0) / denom) * 1000) / 10 : 0,
  }
}

function assertKey(k: string): string {
  if (!/^[a-z_]+$/.test(k)) throw new Error(`bad period key ${k}`)
  return k
}

async function computeLeaderboard(
  workspaceId: number,
  bounds: Record<OverviewPeriodKey, Bounds>,
  now: Date
): Promise<OverviewBlock['leaderboard']> {
  const keys = OVERVIEW_PERIOD_KEYS

  // Completed + cycle time + open assigned, per assignee. One row per
  // (issue, assignee), so an issue with several assignees is counted once for
  // each person and never twice for one.
  const doneSelects = keys.flatMap((k) => {
    const cond = sql`i.status = 'done' AND ${inPeriod(sql`i.completed_at`, bounds[k])}`
    return [
      sql`COUNT(DISTINCT i.id) FILTER (WHERE ${cond})::int AS ${sql.raw('completed_' + assertKey(k))}`,
      sql`AVG(EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600) FILTER (WHERE ${cond})::float8 AS ${sql.raw('cycle_' + k)}`,
    ]
  })
  const assigneeRows = await db.execute<Record<string, number | null>>(sql`
    SELECT ia.user_id,
      COUNT(DISTINCT i.id) FILTER (WHERE ${notTerminal})::int AS open_assigned,
      ${sql.join(doneSelects, sql`, `)}
    FROM ${issueAssignees} ia
    INNER JOIN ${issues} i ON i.id = ia.issue_id
    WHERE ${liveIssue(workspaceId)}
    GROUP BY ia.user_id
  `)

  // Created, per reporter.
  const createdSelects = keys.map(
    (k) =>
      sql`COUNT(*) FILTER (WHERE ${inPeriod(sql`i.created_at`, bounds[k])})::int AS ${sql.raw('created_' + k)}`
  )
  const reporterRows = await db.execute<Record<string, number | null>>(sql`
    SELECT i.reporter_id AS user_id, ${sql.join(createdSelects, sql`, `)}
    FROM ${issues} i
    WHERE ${liveIssue(workspaceId)} AND i.reporter_id IS NOT NULL
    GROUP BY i.reporter_id
  `)

  // Comments and activity, per actor.
  const eventSelects = keys.flatMap((k) => [
    sql`COUNT(*) FILTER (WHERE e.action = 'commented' AND ${inPeriod(sql`e.occurred_at`, bounds[k])})::int AS ${sql.raw('comments_' + k)}`,
    sql`COUNT(*) FILTER (WHERE ${inPeriod(sql`e.occurred_at`, bounds[k])})::int AS ${sql.raw('activity_' + k)}`,
  ])
  const actorRows = await db.execute<Record<string, number | null>>(sql`
    SELECT e.actor_user_id AS user_id, ${sql.join(eventSelects, sql`, `)}
    FROM ${events} e
    WHERE e.workspace_id = ${workspaceId} AND e.actor_user_id IS NOT NULL
    GROUP BY e.actor_user_id
  `)

  // Sparkline: completed per week, the last OVERVIEW_SPARK_WEEKS weeks.
  const sparkStart = new Date(startOfUtcWeek(now).getTime() - (OVERVIEW_SPARK_WEEKS - 1) * 7 * DAY_MS)
  const sparkRows = await db.execute<{ user_id: number; wk: number; n: number }>(sql`
    SELECT ia.user_id,
      FLOOR(EXTRACT(EPOCH FROM (i.completed_at - ${sparkStart}::timestamptz)) / 604800)::int AS wk,
      COUNT(DISTINCT i.id)::int AS n
    FROM ${issueAssignees} ia
    INNER JOIN ${issues} i ON i.id = ia.issue_id
    WHERE ${liveIssue(workspaceId)} AND i.status = 'done' AND i.completed_at >= ${sparkStart}
    GROUP BY 1, 2
  `)

  const memberRows = await db.execute<{ user_id: number; name: string | null; email: string; avatar_url: string | null; role: string }>(sql`
    SELECT u.id AS user_id, u.name, u.email, u.avatar_url, wm.role
    FROM ${workspaceMembers} wm
    INNER JOIN ${users} u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${workspaceId}
  `)

  const byUser = <T extends { user_id: number }>(rows: T[]) => new Map(rows.map((r) => [Number(r.user_id), r]))
  const assignee = byUser(assigneeRows.rows as unknown as Array<{ user_id: number } & Record<string, number | null>>)
  const reporter = byUser(reporterRows.rows as unknown as Array<{ user_id: number } & Record<string, number | null>>)
  const actor = byUser(actorRows.rows as unknown as Array<{ user_id: number } & Record<string, number | null>>)
  const sparks = new Map<number, number[]>()
  for (const r of sparkRows.rows) {
    const uid = Number(r.user_id)
    const arr = sparks.get(uid) ?? new Array<number>(OVERVIEW_SPARK_WEEKS).fill(0)
    const wk = Number(r.wk)
    if (wk >= 0 && wk < OVERVIEW_SPARK_WEEKS) arr[wk] = Number(r.n)
    sparks.set(uid, arr)
  }

  const num = (row: Record<string, number | null> | undefined, col: string) => Number(row?.[col] ?? 0)

  const members: LeaderboardMember[] = memberRows.rows.map((m) => {
    const uid = Number(m.user_id)
    const a = assignee.get(uid)
    const c = reporter.get(uid)
    const ev = actor.get(uid)
    const periods = {} as Record<OverviewPeriodKey, LeaderboardPeriodStats>
    for (const k of keys) {
      const cycle = a?.['cycle_' + k]
      periods[k] = {
        created: num(c, 'created_' + k),
        completed: num(a, 'completed_' + k),
        comments: num(ev, 'comments_' + k),
        activity: num(ev, 'activity_' + k),
        avg_cycle_time_hours: cycle == null ? null : round1(Number(cycle)),
        rank: 0,
      }
    }
    return {
      user_id: uid,
      name: m.name,
      email: m.email,
      avatar_url: m.avatar_url,
      role: m.role,
      open_assigned: num(a, 'open_assigned'),
      periods,
      spark: sparks.get(uid) ?? new Array<number>(OVERVIEW_SPARK_WEEKS).fill(0),
    }
  })

  // Rank per period: completed desc, created desc, then name so it is stable.
  const label = (m: LeaderboardMember) => (m.name ?? m.email).toLowerCase()
  for (const k of keys) {
    const ordered = [...members].sort(
      (x, y) =>
        y.periods[k].completed - x.periods[k].completed ||
        y.periods[k].created - x.periods[k].created ||
        label(x).localeCompare(label(y))
    )
    ordered.forEach((m, i) => (m.periods[k].rank = i + 1))
  }

  // Leaders: the top value per metric, every member tied on it, nothing when
  // the best value is zero (no one "leads" at 0 comments). Fastest cycle needs
  // at least one completion, so a member with none is not "fastest".
  const leaders = {} as OverviewBlock['leaderboard']['leaders']
  for (const k of keys) {
    const out: Partial<Record<LeaderMetric, Leader>> = {}
    const pick = (metric: LeaderMetric, value: (m: LeaderboardMember) => number | null, lowest: boolean) => {
      let best: number | null = null
      let ids: number[] = []
      for (const m of members) {
        const v = value(m)
        if (v == null) continue
        if (best == null || (lowest ? v < best : v > best)) {
          best = v
          ids = [m.user_id]
        } else if (v === best) ids.push(m.user_id)
      }
      if (best != null && (lowest || best > 0)) out[metric] = { user_ids: ids, value: best }
    }
    pick('completed', (m) => m.periods[k].completed, false)
    pick('created', (m) => m.periods[k].created, false)
    pick('comments', (m) => m.periods[k].comments, false)
    pick('activity', (m) => m.periods[k].activity, false)
    pick('fastest_cycle', (m) => (m.periods[k].completed > 0 ? m.periods[k].avg_cycle_time_hours : null), true)
    leaders[k] = out
  }

  members.sort((x, y) => x.periods.range.rank - y.periods.range.rank)

  const rangeLbl = rangeLabel(bounds.range.from, bounds.range.to ?? now)
  const periods: LeaderboardPeriodMeta[] = keys.map((k) => ({
    key: k,
    label: k === 'range' ? rangeLbl : PERIOD_LABELS[k],
    from: bounds[k].from?.toISOString() ?? null,
    to: bounds[k].to?.toISOString() ?? null,
  }))

  return { periods, members, leaders }
}

async function computeProjectHealth(workspaceId: number): Promise<ProjectHealthRow[]> {
  const rows = await db.execute<{
    project_id: number
    seq: number | null
    name: string
    color: string | null
    icon: string | null
    status: string | null
    due_date: string | null
    total: number
    done: number
    cancelled: number
    health: ProjectHealthRow['health']
    health_at: string | null
    health_author: string | null
  }>(sql`
    SELECT p.id AS project_id, p.seq, p.name, p.color, p.icon, p.status,
      to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
      COUNT(i.id)::int AS total,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS done,
      COUNT(i.id) FILTER (WHERE i.status = 'cancelled')::int AS cancelled,
      lu.status AS health, lu.created_at AS health_at, lu.author AS health_author
    FROM ${projects} p
    LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT pu.status, pu.created_at, COALESCE(u.name, u.email) AS author
      FROM ${projectUpdates} pu
      LEFT JOIN ${users} u ON u.id = pu.author_id
      WHERE pu.project_id = p.id
      ORDER BY pu.created_at DESC, pu.id DESC
      LIMIT 1
    ) lu ON true
    WHERE p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL
      AND COALESCE(p.status, '') NOT IN ('completed', 'cancelled')
    GROUP BY p.id, lu.status, lu.created_at, lu.author
  `)
  const healthOrder = { off_track: 0, at_risk: 1, on_track: 2 } as const
  return rows.rows
    .map((r): ProjectHealthRow => {
      const total = Number(r.total)
      const done = Number(r.done)
      const cancelled = Number(r.cancelled)
      const scope = total - cancelled
      return {
        project_id: Number(r.project_id),
        seq: r.seq == null ? null : Number(r.seq),
        name: r.name,
        color: r.color,
        icon: r.icon,
        status: r.status,
        total,
        done,
        cancelled,
        open: total - done - cancelled,
        progress_pct: scope > 0 ? Math.round((done / scope) * 100) : 0,
        due_date: r.due_date,
        health: r.health,
        health_at: r.health_at ? iso(r.health_at) : null,
        health_author: r.health_author,
      }
    })
    .sort(
      (a, b) =>
        (a.health ? healthOrder[a.health] : 3) - (b.health ? healthOrder[b.health] : 3) ||
        b.open - a.open ||
        a.name.localeCompare(b.name)
    )
    .slice(0, OVERVIEW_PROJECT_LIMIT)
}

async function attentionList(workspaceId: number, extra: SQL, order: SQL, now: Date): Promise<AttentionList> {
  const rows = await db.execute<{
    id: number
    seq: number | null
    title: string
    status: string
    priority: number
    due_date: string | null
    created_at: string
    project_name: string | null
    assignees: AttentionIssue['assignees'] | null
    total: number
  }>(sql`
    SELECT i.id, i.seq, i.title, i.status, i.priority,
      to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.created_at,
      p.name AS project_name,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'user_id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url)
               ORDER BY ia.assigned_at)
        FROM ${issueAssignees} ia INNER JOIN ${users} u ON u.id = ia.user_id
        WHERE ia.issue_id = i.id
      ), '[]'::json) AS assignees,
      COUNT(*) OVER ()::int AS total
    FROM ${issues} i
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE ${liveIssue(workspaceId)} AND ${notTerminal} AND ${extra}
    ORDER BY ${order}
    LIMIT ${OVERVIEW_ATTENTION_LIMIT}
  `)
  return {
    total: Number(rows.rows[0]?.total ?? 0),
    items: rows.rows.map((r) => ({
      id: Number(r.id),
      seq: r.seq == null ? null : Number(r.seq),
      title: r.title,
      status: r.status,
      priority: Number(r.priority),
      due_date: r.due_date,
      created_at: iso(r.created_at),
      age_days: Math.max(0, Math.floor((now.getTime() - new Date(r.created_at).getTime()) / DAY_MS)),
      project_name: r.project_name,
      assignees: (r.assignees ?? []).map((a) => ({ ...a, user_id: Number(a.user_id) })),
    })),
  }
}

async function computeWorkload(workspaceId: number): Promise<OverviewBlock['workload']> {
  const inList = sql.join(OPEN_STATUSES.map((s) => sql`${s}`), sql`, `)
  const rows = await db.execute<{ user_id: number; name: string | null; email: string; avatar_url: string | null; status: string; n: number }>(sql`
    SELECT u.id AS user_id, u.name, u.email, u.avatar_url, i.status, COUNT(DISTINCT i.id)::int AS n
    FROM ${workspaceMembers} wm
    INNER JOIN ${users} u ON u.id = wm.user_id
    INNER JOIN ${issueAssignees} ia ON ia.user_id = u.id
    INNER JOIN ${issues} i ON i.id = ia.issue_id AND ${liveIssue(workspaceId)} AND i.status IN (${inList})
    WHERE wm.workspace_id = ${workspaceId}
    GROUP BY u.id, u.name, u.email, u.avatar_url, i.status
  `)
  const byUser = new Map<number, WorkloadRow>()
  for (const r of rows.rows) {
    const uid = Number(r.user_id)
    const row =
      byUser.get(uid) ??
      ({
        user_id: uid,
        name: r.name,
        email: r.email,
        avatar_url: r.avatar_url,
        by_status: Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])),
        total: 0,
      } satisfies WorkloadRow)
    row.by_status[r.status] = Number(r.n)
    row.total += Number(r.n)
    byUser.set(uid, row)
  }
  const members = [...byUser.values()]
    .sort((a, b) => b.total - a.total || (a.name ?? a.email).localeCompare(b.name ?? b.email))
    .slice(0, OVERVIEW_WORKLOAD_LIMIT)
  return { statuses: OPEN_STATUSES, members, unassigned: 0 } // `unassigned` filled by the caller from summary
}

async function computeRecentActivity(workspaceId: number): Promise<RecentActivityRow[]> {
  // `comment` rows are skipped: posting a comment also records `commented` on the
  // parent, which is the one worth showing (it names the issue).
  const rows = await db.execute<{
    id: number
    occurred_at: string
    action: string
    entity_type: string
    actor_user_id: number | null
    actor_name: string | null
    actor_email: string | null
    actor_avatar: string | null
    seq: number | null
    title: string | null
    live: boolean
    meta_to: string | null
  }>(sql`
    SELECT e.id, e.occurred_at, e.action, e.entity_type, e.actor_user_id,
      u.name AS actor_name, u.email AS actor_email, u.avatar_url AS actor_avatar,
      COALESCE(ii.seq, pp.seq, tt.seq, NULLIF(e.meta->>'seq', '')::int) AS seq,
      COALESCE(ii.title, pp.name, tt.name, e.meta->>'title') AS title,
      (ii.id IS NOT NULL AND ii.deleted_at IS NULL)
        OR (pp.id IS NOT NULL AND pp.deleted_at IS NULL)
        OR (tt.id IS NOT NULL AND tt.deleted_at IS NULL) AS live,
      e.meta->>'to' AS meta_to
    FROM ${events} e
    LEFT JOIN ${users} u ON u.id = e.actor_user_id
    LEFT JOIN ${issues} ii ON e.entity_type = 'issue' AND ii.id = e.entity_id AND ii.workspace_id = e.workspace_id
    LEFT JOIN ${projects} pp ON e.entity_type = 'project' AND pp.id = e.entity_id AND pp.workspace_id = e.workspace_id
    LEFT JOIN ${tasks} tt ON e.entity_type = 'task' AND tt.id = e.entity_id AND tt.workspace_id = e.workspace_id
    WHERE e.workspace_id = ${workspaceId} AND e.entity_type <> 'comment'
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ${OVERVIEW_ACTIVITY_LIMIT}
  `)
  return rows.rows.map((r) => ({
    id: Number(r.id),
    occurred_at: iso(r.occurred_at),
    action: r.action,
    entity_type: r.entity_type,
    entity_seq: r.seq == null ? null : Number(r.seq),
    entity_title: r.title,
    linkable: !!r.live && r.seq != null,
    to:
      r.action === 'priority_changed' && r.meta_to != null
        ? Number(r.meta_to)
        : r.action === 'status_changed'
          ? r.meta_to
          : null,
    actor:
      r.actor_user_id == null
        ? null
        : {
            user_id: Number(r.actor_user_id),
            name: r.actor_name,
            email: r.actor_email ?? '',
            avatar_url: r.actor_avatar,
          },
  }))
}

// ---------- entry point ----------

export async function computeOverview(input: ComputeOverviewInput): Promise<OverviewPayload> {
  const { workspaceId } = input
  const now = input.now ?? new Date()
  const to = input.to ?? now
  const requestedFrom = input.from ?? null

  // "All": the analytics series needs a real start, so use the first issue.
  let from = requestedFrom
  if (!from) {
    const first = await db.execute<{ first: string | null }>(
      sql`SELECT MIN(i.created_at) AS first FROM ${issues} i WHERE ${liveIssue(workspaceId)}`
    )
    from = first.rows[0]?.first ? new Date(first.rows[0].first) : new Date(now.getTime() - 30 * DAY_MS)
  }
  const days = requestedFrom ? Math.round((to.getTime() - requestedFrom.getTime()) / DAY_MS) : null
  const spanDays = (to.getTime() - from.getTime()) / DAY_MS
  const interval: AnalyticsInterval = spanDays > OVERVIEW_WEEKLY_AFTER_DAYS ? 'week' : 'day'

  const bounds = periodBounds(now, { from: requestedFrom, to: requestedFrom ? to : null })

  const [analytics, leaderboard, projectsHealth, overdue, urgent, oldOpen, unassigned, workload, recent, snapNow, snapPrev] =
    await Promise.all([
      computeAnalytics({
        workspaceId,
        view: 'workspace',
        from,
        to,
        interval,
        comparePrevious: !!requestedFrom,
      }),
      computeLeaderboard(workspaceId, bounds, now),
      computeProjectHealth(workspaceId),
      attentionList(workspaceId, sql`i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`, sql`i.due_date ASC, i.priority ASC, i.id ASC`, now),
      attentionList(workspaceId, sql`i.priority = 1`, sql`i.created_at ASC, i.id ASC`, now),
      attentionList(
        workspaceId,
        sql`i.created_at < ${new Date(now.getTime() - OVERVIEW_OLD_OPEN_DAYS * DAY_MS)}`,
        sql`i.created_at ASC, i.id ASC`,
        now
      ),
      attentionList(
        workspaceId,
        sql`NOT EXISTS (SELECT 1 FROM ${issueAssignees} ia WHERE ia.issue_id = i.id)`,
        sql`i.priority ASC, i.created_at DESC, i.id DESC`,
        now
      ),
      computeWorkload(workspaceId),
      computeRecentActivity(workspaceId),
      snapshotAt(workspaceId, now),
      requestedFrom ? snapshotAt(workspaceId, requestedFrom) : Promise.resolve<Snapshot | null>(null),
    ])

  workload.unassigned = analytics.summary.unassigned

  // The analytics payload describes the window it was asked for; report the one
  // the caller asked for (null = All), not the synthetic start used to draw it.
  analytics.period = { from: requestedFrom?.toISOString() ?? null, to: to.toISOString(), interval }

  return {
    ...analytics,
    overview: {
      generated_at: now.toISOString(),
      range: { from: requestedFrom?.toISOString() ?? null, to: to.toISOString(), interval, days },
      kpi_trends: {
        total: trend(snapNow.total, snapPrev?.total ?? null),
        open: trend(snapNow.open, snapPrev?.open ?? null),
        overdue: trend(snapNow.overdue, snapPrev?.overdue ?? null),
        unassigned: trend(snapNow.unassigned, snapPrev?.unassigned ?? null),
        completion_rate: trend(snapNow.completion_rate, snapPrev?.completion_rate ?? null),
      },
      leaderboard,
      projects: projectsHealth,
      attention: {
        old_open_days: OVERVIEW_OLD_OPEN_DAYS,
        overdue,
        urgent,
        old_open: oldOpen,
        unassigned,
      },
      workload,
      recent_activity: recent,
    },
  }
}
