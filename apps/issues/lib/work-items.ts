// Canonical status + priority definitions for issues and projects. One source
// of truth, imported by both the query layer (validation, analytics) and the
// UI (dropdowns, kanban columns, colors). Plain data — safe on server + client.

export interface Option {
  value: string
  label: string
  color: string
}

// ---------- issues ----------

export const ISSUE_STATUSES: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#71717a' },
  { value: 'todo', label: 'Todo', color: '#a1a1aa' },
  { value: 'in_progress', label: 'In progress', color: '#f2c94c' },
  { value: 'done', label: 'Done', color: '#007bd3' },
  { value: 'cancelled', label: 'Cancelled', color: '#71717a' },
]

export const ISSUE_STATUS_VALUES = ISSUE_STATUSES.map((s) => s.value)

// The two terminal statuses, named separately because they are NOT
// interchangeable: `done` is work that finished, `cancelled` is work that will
// not happen. Task progress (below) has to tell them apart — a task whose
// issues were all cancelled is not a completed task.
export const ISSUE_DONE_STATUS = 'done'
export const ISSUE_CANCELLED_STATUS = 'cancelled'
export const ISSUE_TERMINAL_STATUSES = [ISSUE_DONE_STATUS, ISSUE_CANCELLED_STATUS]

export function issueStatusLabel(value: string): string {
  return ISSUE_STATUSES.find((s) => s.value === value)?.label ?? value
}
export function issueStatusColor(value: string): string {
  return ISSUE_STATUSES.find((s) => s.value === value)?.color ?? '#71717a'
}

// Priority is stored as an int 1..5 on issues. Listed in the order the user
// sees them: No priority, Urgent, High, Medium, Low.
export interface PriorityOption {
  value: number
  label: string
  color: string
}
export const ISSUE_PRIORITIES: PriorityOption[] = [
  { value: 5, label: 'No priority', color: '#71717a' },
  { value: 1, label: 'Urgent', color: '#ef4444' },
  { value: 2, label: 'High', color: '#f97316' },
  { value: 3, label: 'Medium', color: '#8a8f98' },
  { value: 4, label: 'Low', color: '#a1a1aa' },
]
export function issuePriorityLabel(value: number): string {
  return ISSUE_PRIORITIES.find((p) => p.value === value)?.label ?? '—'
}
export function issuePriorityColor(value: number): string {
  return ISSUE_PRIORITIES.find((p) => p.value === value)?.color ?? '#71717a'
}

// ---------- tasks ----------
//
// A TASK'S STATUS IS DERIVED FROM ITS ISSUES. IT IS NEVER STORED.
//
// `issues.tasks.status` is a real column with a default of 'active', and it is
// dead: no write path in this repo has ever set it to anything else — not the
// web UI (task-detail-view.tsx patches five fields, and status is not one of
// them), not a route, not the CLI. Before 2026-08-12 three readers disagreed
// about a value none of them could ever see: the schema defaulted to 'active',
// project-detail-view.tsx counted tasks equal to 'done', and task-detail-view.tsx
// suppressed the overdue badge on 'completed'. Two of those comparisons were
// permanently false.
//
// A task is the grouping layer between a project and its issues, so its state
// is a FACT ABOUT THE GROUP, not an independent field someone has to remember
// to update. Deriving it means the two can never disagree. The derivation lives
// in SQL (lib/db/queries/tasks.ts, `taskProgressSql`) so that a client which
// pages through issues cannot compute a different answer than the server.
//
// The two edge cases, stated rather than left to a default:
//
//   1. A task with NO issues is `empty`, not `done` and not 0% — there is
//      nothing to be done, which is a different thing from nothing being done.
//      Renderers show `—`.
//   2. CANCELLED issues are neither remaining work nor completed work. A task
//      whose issues were all cancelled is `cancelled`, never `done`; a task
//      with one done and one cancelled issue is `done`, because nothing is
//      still open.
export const TASK_PROGRESS_STATUSES: Option[] = [
  { value: 'empty', label: 'No issues', color: '#71717a' },
  { value: 'active', label: 'Active', color: '#f2c94c' },
  { value: 'done', label: 'Done', color: '#007bd3' },
  { value: 'cancelled', label: 'Cancelled', color: '#71717a' },
]
export const TASK_PROGRESS_STATUS_VALUES = TASK_PROGRESS_STATUSES.map((s) => s.value)
export function taskProgressStatusLabel(value: string | null | undefined): string {
  return TASK_PROGRESS_STATUSES.find((s) => s.value === value)?.label ?? 'No issues'
}
export function taskProgressStatusColor(value: string | null | undefined): string {
  return TASK_PROGRESS_STATUSES.find((s) => s.value === value)?.color ?? '#71717a'
}

// ---------- projects ----------

export const PROJECT_STATUSES: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#71717a' },
  { value: 'planned', label: 'Planned', color: '#a1a1aa' },
  { value: 'in_progress', label: 'In progress', color: '#f2c94c' },
  { value: 'completed', label: 'Completed', color: '#007bd3' },
  { value: 'cancelled', label: 'Cancelled', color: '#71717a' },
]
export const PROJECT_STATUS_VALUES = PROJECT_STATUSES.map((s) => s.value)
export function projectStatusLabel(value: string): string {
  return PROJECT_STATUSES.find((s) => s.value === value)?.label ?? value
}
export function projectStatusColor(value: string): string {
  return PROJECT_STATUSES.find((s) => s.value === value)?.color ?? '#71717a'
}

// Project priority stored as P0..P4 (P0 = highest). Same display order.
export const PROJECT_PRIORITIES: { value: string; label: string }[] = [
  { value: 'P4', label: 'No priority' },
  { value: 'P0', label: 'Urgent' },
  { value: 'P1', label: 'High' },
  { value: 'P2', label: 'Medium' },
  { value: 'P3', label: 'Low' },
]
export const PROJECT_PRIORITY_VALUES = PROJECT_PRIORITIES.map((p) => p.value)
export function projectPriorityLabel(value: string | null | undefined): string {
  return PROJECT_PRIORITIES.find((p) => p.value === value)?.label ?? 'No priority'
}

// ---------- project updates (health) ----------
// A project's posted status update — its "health". On track / At risk / Off track.

export const PROJECT_UPDATE_STATUSES: Option[] = [
  { value: 'on_track', label: 'On track', color: '#4cb782' },
  { value: 'at_risk', label: 'At risk', color: '#f2c94c' },
  { value: 'off_track', label: 'Off track', color: '#eb5757' },
]
export const PROJECT_UPDATE_STATUS_VALUES = PROJECT_UPDATE_STATUSES.map((s) => s.value)
export function projectUpdateStatusLabel(value: string | null | undefined): string {
  return PROJECT_UPDATE_STATUSES.find((s) => s.value === value)?.label ?? 'No updates'
}
export function projectUpdateStatusColor(value: string | null | undefined): string {
  return PROJECT_UPDATE_STATUSES.find((s) => s.value === value)?.color ?? '#8a8f98'
}
