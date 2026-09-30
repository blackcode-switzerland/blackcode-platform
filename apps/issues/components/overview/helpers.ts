// Pure helpers for the Overview page: sorting the leaderboard, formatting, and
// turning an activity row into words. No React, no runtime imports from queries.

import type {
  LeaderboardMember,
  LeaderMetric,
  Leader,
  RecentActivityRow,
} from '@/lib/db/queries/overview'
import type { OverviewPeriodKey } from '@/lib/overview-periods'
import { issuePriorityLabel, issueStatusLabel } from '@/lib/work-items'

export function formatHours(h: number | null | undefined): string {
  if (h == null) return '—'
  if (h < 1) return '<1h'
  if (h < 48) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

export type SortKey =
  | 'rank'
  | 'name'
  | 'created'
  | 'completed'
  | 'open_assigned'
  | 'cycle'
  | 'comments'
  | 'activity'
  | 'trend'
export type SortDir = 'asc' | 'desc'

/** The direction a column starts in the first time it is clicked. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'rank' || key === 'name' || key === 'cycle' ? 'asc' : 'desc'
}

export function memberLabel(m: { name: string | null; email: string }): string {
  return m.name?.trim() || m.email
}

function sortValue(m: LeaderboardMember, period: OverviewPeriodKey, key: SortKey): number | string | null {
  const p = m.periods[period]
  switch (key) {
    case 'rank':
      return p.rank
    case 'name':
      return memberLabel(m).toLowerCase()
    case 'created':
      return p.created
    case 'completed':
      return p.completed
    case 'open_assigned':
      return m.open_assigned
    case 'cycle':
      return p.avg_cycle_time_hours
    case 'comments':
      return p.comments
    case 'activity':
      return p.activity
    case 'trend':
      return m.spark.reduce((a, b) => a + b, 0)
  }
}

/** New sorted array. Missing values (no cycle time) always sink; ties fall back to true rank. */
export function sortMembers(
  members: LeaderboardMember[],
  period: OverviewPeriodKey,
  key: SortKey,
  dir: SortDir
): LeaderboardMember[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...members].sort((a, b) => {
    const va = sortValue(a, period, key)
    const vb = sortValue(b, period, key)
    if (va == null && vb != null) return 1
    if (vb == null && va != null) return -1
    if (va != null && vb != null && va !== vb) {
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      if (c !== 0) return c * sign
    }
    return a.periods[period].rank - b.periods[period].rank
  })
}

/** Up to three members who completed something, in rank order. */
export function podiumMembers(members: LeaderboardMember[], period: OverviewPeriodKey): LeaderboardMember[] {
  return members
    .filter((m) => m.periods[period].completed > 0)
    .sort((a, b) => a.periods[period].rank - b.periods[period].rank)
    .slice(0, 3)
}

export function isLeader(
  leaders: Partial<Record<LeaderMetric, Leader>> | undefined,
  metric: LeaderMetric,
  userId: number
): boolean {
  return !!leaders?.[metric]?.user_ids.includes(userId)
}

const VERBS: Record<string, [string, string?]> = {
  created: ['created'],
  updated: ['updated'],
  deleted: ['deleted'],
  restored: ['restored'],
  purged: ['permanently deleted'],
  commented: ['commented on'],
  assigned: ['assigned'],
  unassigned: ['unassigned'],
  status_changed: ['changed the status of'],
  priority_changed: ['changed the priority of'],
  task_changed: ['moved'],
  project_changed: ['moved'],
  labeled: ['labeled'],
  unlabeled: ['removed a label from'],
  attached: ['attached a file to'],
  due_date_changed: ['changed the due date of'],
  member_added: ['added a member to'],
}

/** "<before> <subject> <after>" pieces for one activity row. */
export function describeActivity(row: Pick<RecentActivityRow, 'action' | 'to'>): { before: string; after: string } {
  const known = VERBS[row.action]
  const before = known ? known[0] : row.action.replace(/_/g, ' ')
  let after = ''
  if (row.action === 'status_changed' && typeof row.to === 'string') after = `to ${issueStatusLabel(row.to)}`
  else if (row.action === 'priority_changed' && row.to != null && row.to !== '')
    after = `to ${issuePriorityLabel(Number(row.to))}`
  return { before, after }
}

/** Route for an activity subject, or null when it must not be a link. */
export function activityHref(slug: string, row: RecentActivityRow): string | null {
  if (!row.linkable || row.entity_seq == null) return null
  const seg = { issue: 'issues', task: 'tasks', project: 'projects' }[row.entity_type]
  return seg ? `/dashboard/${slug}/${seg}/${row.entity_seq}` : null
}
