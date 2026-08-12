// Issue queries — workspace-scoped, with sequence allocation, automatic
// watcher management, and granular event recording.
//
// Field-level events: a PATCH that changes multiple fields produces one
// 'updated' diff event PLUS dedicated events for each high-signal change:
//   - assignee_ids  → 'assigned' / 'unassigned' (one event per user added/removed)
//   - status        → 'status_changed' (and sets completed_at / cancelled_at)
//   - priority      → 'priority_changed'
//   - task_id  → 'task_changed'
//   - project_id    → 'project_changed'
// This lets the activity feed and inbox surface meaningful events without
// dredging through diff jsonb.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { searchClause } from './search'
import { db } from '../client'
import { attachments, comments, issueAssignees, issueLabels, issues, labels, projects, tasks, type Issue, users } from '../schema'
import { recordEvent, UPDATE_COALESCE_WINDOW_MS } from './events'
import { projectEntity } from './entities'
import { softDeleteIssue } from './deletion'
import { allocateNextIssueSeq } from './workspaces'
import { addWatcher, removeAutoWatcher } from './watchers'
import { resolveOrCreateLabels, VISIBLE_TO_THIS_APP, visibleToThisApp } from './labels'
import { ownTypeIn } from './qualified-type'
import { toRichTextHtml } from '@/lib/rich-text'
import { ISSUE_STATUS_VALUES, ISSUE_TERMINAL_STATUSES } from '@/lib/work-items'

const TERMINAL_STATUSES = new Set(ISSUE_TERMINAL_STATUSES)
const VALID_STATUSES = new Set(ISSUE_STATUS_VALUES)

/**
 * Thrown when a project move would leave the issue inside a task that belongs to
 * a different project. See the block in `updateIssue` for why this is a refusal
 * rather than a silent detach.
 *
 * It is a CLASS rather than `new Error('task_project_mismatch')` — the other
 * refusals in this file are bare messages — because the route's message has to
 * name the task that is in the way. A caller told "that would orphan the task
 * link" with no #number cannot act on it, and the whole point of refusing rather
 * than detaching is that the caller can act on it.
 */
export class IssueTaskProjectMismatch extends Error {
  constructor(
    readonly taskSeq: number | null,
    readonly taskName: string
  ) {
    super('task_project_mismatch')
    this.name = 'IssueTaskProjectMismatch'
  }
}

export interface AssigneeInfo {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
}

export interface IssueListRow extends Issue {
  assignees: AssigneeInfo[]
  task_name?: string | null
  task_seq?: number | null
  project_name?: string | null
  project_seq?: number | null
  project_icon?: string | null
  project_color?: string | null
  comment_count?: number
  attachment_count?: number
  labels?: Array<{ id: number; name: string; color: string }>
}

const issueListSelect = sql`
  i.*,
  COALESCE((
    SELECT json_agg(json_build_object('id', u2.id, 'name', u2.name, 'email', u2.email, 'avatar_url', u2.avatar_url) ORDER BY u2.name)
    FROM ${issueAssignees} ia
    JOIN ${users} u2 ON u2.id = ia.user_id
    WHERE ia.issue_id = i.id
  ), '[]'::json) AS assignees,
  m.name AS task_name,
  m.seq AS task_seq,
  p.name AS project_name,
  p.icon AS project_icon,
  p.color AS project_color,
  p.seq AS project_seq,
  (SELECT COUNT(*)::int FROM ${comments} c WHERE c.parent_type IN ${ownTypeIn('issue')} AND c.parent_id = i.id) AS comment_count,
  (SELECT COUNT(*)::int FROM ${attachments} a WHERE a.issue_id = i.id) AS attachment_count,
  COALESCE((SELECT json_agg(json_build_object('id', lb.id, 'name', lb.name, 'color', lb.color) ORDER BY lb.name) FROM ${issueLabels} il JOIN ${labels} lb ON lb.id = il.label_id WHERE il.issue_id = i.id AND ${visibleToThisApp('lb')}), '[]'::json) AS labels
`

export interface ListIssuesOptions {
  projectId?: number | null
  taskId?: number | null
  /** Filter by assignee(s). null = unassigned, array = any of these users. */
  assigneeIds?: number[] | null
  status?: string
  priority?: number
  /**
   * Label NAMES, matched case-insensitively. Several names are an OR — an issue
   * carrying any of them matches. AND would need a second flag to ask for, and
   * "show me the bugs and the regressions" is the question people actually have.
   *
   * Only labels this app can see are considered (`visibleToThisApp`): a name
   * another app owns must not select rows here, or the filter would leak that
   * app's label set through its results.
   */
  labels?: string[]
  /**
   * INCLUSIVE upper bound on `due_date`, as YYYY-MM-DD. An issue due exactly on
   * this date MATCHES.
   *
   * `due_date` is a DATE column, so the boundary day is a whole day of work and
   * the two readings of "before Friday" differ by all of it. Inclusive is chosen
   * because the other reading fails silently: a caller asking for "due this
   * week" and losing Friday sees a shorter list with nothing to tell them it is
   * short. Issues with no due date are never returned by this filter.
   */
  dueBefore?: string
  search?: string
  /** Look up the single issue with this workspace-facing seq (the #number in the UI). */
  seq?: number
  cursor?: number | null
  limit?: number
}

export interface IssuesPage {
  data: IssueListRow[]
  next_cursor: number | null
  total: number
}

export async function listIssuesInWorkspace(
  workspaceId: number,
  opts: ListIssuesOptions = {}
): Promise<IssuesPage> {
  const projectFilter =
    opts.projectId === null
      ? sql`AND i.project_id IS NULL`
      : opts.projectId !== undefined
        ? sql`AND i.project_id = ${opts.projectId}`
        : sql``
  const taskFilter =
    opts.taskId === null
      ? sql`AND i.task_id IS NULL`
      : opts.taskId !== undefined
        ? sql`AND i.task_id = ${opts.taskId}`
        : sql``
  const assigneeFilter =
    opts.assigneeIds === null
      ? sql`AND NOT EXISTS (SELECT 1 FROM ${issueAssignees} ia WHERE ia.issue_id = i.id)`
      : opts.assigneeIds !== undefined && opts.assigneeIds.length > 0
        ? sql`AND EXISTS (SELECT 1 FROM ${issueAssignees} ia WHERE ia.issue_id = i.id AND ia.user_id IN (${sql.join(opts.assigneeIds.map((id) => sql`${id}`), sql`, `)}))`
        : sql``

  const labelNames = (opts.labels ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean)
  const labelFilter =
    labelNames.length > 0
      ? sql`AND EXISTS (
          SELECT 1 FROM ${issueLabels} il
          JOIN ${labels} lb ON lb.id = il.label_id
          WHERE il.issue_id = i.id
            AND ${visibleToThisApp('lb')}
            AND lower(lb.name) IN (${sql.join(labelNames.map((n) => sql`${n}`), sql`, `)}))`
      : sql``

  const whereClause = sql`
    WHERE i.workspace_id = ${workspaceId}
      AND i.deleted_at IS NULL
      ${projectFilter}
      ${taskFilter}
      ${assigneeFilter}
      ${labelFilter}
      ${opts.status ? sql`AND i.status = ${opts.status}` : sql``}
      ${opts.priority ? sql`AND i.priority = ${opts.priority}` : sql``}
      ${opts.dueBefore ? sql`AND i.due_date IS NOT NULL AND i.due_date <= ${opts.dueBefore}::date` : sql``}
      ${opts.seq !== undefined ? sql`AND i.seq = ${opts.seq}` : sql``}
      ${searchClause(opts.search, { text: [sql`i.title`, sql`i.description`], seq: sql`i.seq` })}
  `

  // The listing returns every matching issue in one shot (consistent with
  // projects/tasks). No cursor pagination — see docs/changelog/.
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    ${whereClause}
    ORDER BY COALESCE(i.position, 0) ASC, i.id DESC
  `)

  const data = result.rows as unknown as IssueListRow[]
  return { data, next_cursor: null, total: data.length }
}

export async function getIssueInWorkspace(
  workspaceId: number,
  id: number
): Promise<IssueListRow | null> {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE i.id = ${id} AND i.workspace_id = ${workspaceId} AND i.deleted_at IS NULL
  `)
  return (result.rows[0] as unknown as IssueListRow | undefined) ?? null
}

// Bare by-id lookup (no workspace gating) — used by tests and internal helpers.
// Route handlers should prefer getIssueInWorkspace, which enforces tenancy.
export async function getIssue(id: number): Promise<Issue | null> {
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), isNull(issues.deleted_at)))
    .limit(1)
  return rows[0] ?? null
}

export interface CreateIssueInput {
  workspaceId: number
  title: string
  description?: string | null
  status?: string
  priority?: number
  assigneeIds?: number[]
  taskId?: number | null
  projectId?: number | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  labelIds?: number[]
  labelNames?: string[]
  reporterId: number
  actorUserId: number
}

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  if (input.status && !VALID_STATUSES.has(input.status)) {
    throw new Error('invalid_status')
  }
  if (input.priority !== undefined && (input.priority < 1 || input.priority > 5)) {
    throw new Error('invalid_priority')
  }

  return await db.transaction(async (tx) => {
    const seq = await allocateNextIssueSeq(tx, input.workspaceId)

    const status = input.status ?? 'backlog'
    const now = new Date()
    const completed_at = status === 'done' ? now : null
    const cancelled_at = status === 'cancelled' ? now : null

    const [row] = await tx
      .insert(issues)
      .values({
        workspace_id: input.workspaceId,
        seq,
        title: input.title,
        description: toRichTextHtml(input.description) ?? null,
        status,
        priority: input.priority ?? 3,
        task_id: input.taskId ?? null,
        project_id: input.projectId ?? null,
        reporter_id: input.reporterId,
        start_date: input.startDate ?? null,
        due_date: input.dueDate ?? null,
        estimated_hours: input.estimatedHours != null ? String(input.estimatedHours) : null,
        completed_at,
        cancelled_at,
      })
      .returning()
    if (!row) throw new Error('issue insert returned nothing')

    // Insert assignees into junction table.
    const uniqueAssigneeIds = [...new Set(input.assigneeIds ?? [])]
    if (uniqueAssigneeIds.length > 0) {
      await tx
        .insert(issueAssignees)
        .values(uniqueAssigneeIds.map((uid) => ({ issue_id: row.id, user_id: uid })))
        .onConflictDoNothing()
    }

    // Auto-watchers: reporter + all assignees.
    await addWatcher(tx, row.id, input.reporterId, 'reporter')
    for (const uid of uniqueAssigneeIds) {
      if (uid !== input.reporterId) {
        await addWatcher(tx, row.id, uid, 'assigned')
      }
    }

    // Attach labels chosen at creation: existing ids (validated against the
    // workspace) plus any names (matched case-insensitively, created on the fly).
    const labelIdSet = new Set<number>()
    if (input.labelIds && input.labelIds.length > 0) {
      const valid = await tx
        .select({ id: labels.id })
        .from(labels)
        .where(
          and(
            eq(labels.workspace_id, input.workspaceId),
            VISIBLE_TO_THIS_APP,
            inArray(labels.id, input.labelIds)
          )
        )
      valid.forEach((l) => labelIdSet.add(l.id))
    }
    if (input.labelNames && input.labelNames.length > 0) {
      const resolved = await resolveOrCreateLabels(tx, input.workspaceId, input.labelNames, input.actorUserId)
      resolved.forEach((id) => labelIdSet.add(id))
    }
    if (labelIdSet.size > 0) {
      await tx
        .insert(issueLabels)
        .values([...labelIdSet].map((label_id) => ({ issue_id: row.id, label_id })))
        .onConflictDoNothing()
    }

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'issue',
      entityId: row.id,
      action: 'created',
      diff: {
        after: {
          title: row.title,
          status: row.status,
          priority: row.priority,
          project_id: row.project_id,
          task_id: row.task_id,
          assignee_ids: uniqueAssigneeIds,
        },
      },
      meta: { seq: row.seq },
    })

    for (const uid of uniqueAssigneeIds) {
      if (uid !== input.actorUserId) {
        await recordEvent(tx, {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          entityType: 'issue',
          entityId: row.id,
          action: 'assigned',
          meta: { assignee_id: uid, seq: row.seq, title: row.title },
        })
      }
    }

    // Same transaction as the insert above — see lib/db/queries/entities.ts.
    await projectEntity(tx, {
      workspaceId: input.workspaceId,
      entityType: 'issue',
      number: row.seq,
      title: row.title,
    })

    return row
  })
}

export interface UpdateIssueInput {
  title?: string
  description?: string | null
  status?: string
  priority?: number
  /** Provide to replace the full assignee list. Empty array = unassign all. */
  assignee_ids?: number[] | null
  task_id?: number | null
  project_id?: number | null
  start_date?: string | null
  due_date?: string | null
  estimated_hours?: number | null
}

export async function updateIssue(
  workspaceId: number,
  id: number,
  patch: UpdateIssueInput,
  actorUserId: number
): Promise<Issue | null> {
  if (patch.status && !VALID_STATUSES.has(patch.status)) {
    throw new Error('invalid_status')
  }
  if (patch.priority !== undefined && (patch.priority < 1 || patch.priority > 5)) {
    throw new Error('invalid_priority')
  }

  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    // ---------- MOVING AN ISSUE BETWEEN PROJECTS: THE TASK LINK ----------
    //
    // THE DECISION (2026-08-12, phase 4 §2): a project move that would leave the
    // issue in a task belonging to a DIFFERENT project is REFUSED. It is not
    // silently detached and the task link is not silently carried across.
    //
    // The three candidate answers and why this one:
    //
    //   * carry the link across — the issue is then in project B while its task
    //     says project A. `bk issues project issues B` and
    //     `bk issues task view <t>` disagree about the same issue, and every
    //     progress ratio on that task counts an issue that is no longer under it.
    //   * detach silently — the issue leaves the task and NOTHING says so. The
    //     task's numbers change from a command that never mentioned it. This is
    //     the "silently orphaned reference" the plan names, and it is the one
    //     nobody notices for a month.
    //   * refuse — the caller is told, in one line, which task is in the way and
    //     the exact recovery. Nothing is lost and nothing moved.
    //
    // Refusing also matches what `task attach` already does when an issue is
    // already in another task (phase 3): the write that would quietly change a
    // SECOND record's numbers is the one this app stops and names.
    //
    // SCOPE IS DELIBERATELY THE PROJECT MOVE, not (project, task) consistency in
    // general. Rows predating this rule are not blocked from unrelated edits, and
    // `task attach`'s own semantics — shipped and verified one commit ago — are
    // untouched unless the same PATCH is also moving the project.
    if (patch.project_id !== undefined) {
      const resultingTaskId = patch.task_id !== undefined ? patch.task_id : before.task_id
      if (resultingTaskId != null) {
        const [linked] = await tx
          .select({ seq: tasks.seq, name: tasks.name, project_id: tasks.project_id })
          .from(tasks)
          .where(and(eq(tasks.id, resultingTaskId), eq(tasks.workspace_id, workspaceId)))
          .limit(1)
        if (linked && linked.project_id != null && linked.project_id !== patch.project_id) {
          throw new IssueTaskProjectMismatch(linked.seq, linked.name)
        }
      }
    }

    const updates: Record<string, unknown> = {}
    if (patch.title !== undefined) updates.title = patch.title
    if (patch.description !== undefined) updates.description = toRichTextHtml(patch.description)
    if (patch.priority !== undefined) updates.priority = patch.priority
    if (patch.task_id !== undefined) updates.task_id = patch.task_id
    if (patch.project_id !== undefined) updates.project_id = patch.project_id
    if (patch.start_date !== undefined) updates.start_date = patch.start_date
    if (patch.due_date !== undefined) updates.due_date = patch.due_date
    if (patch.estimated_hours !== undefined)
      updates.estimated_hours = patch.estimated_hours != null ? String(patch.estimated_hours) : null
    if (patch.status !== undefined) {
      updates.status = patch.status
      const now = new Date()
      if (patch.status === 'done' && before.status !== 'done') {
        updates.completed_at = now
        updates.cancelled_at = null
      } else if (patch.status === 'cancelled' && before.status !== 'cancelled') {
        updates.cancelled_at = now
        updates.completed_at = null
      } else if (TERMINAL_STATUSES.has(before.status ?? '') && !TERMINAL_STATUSES.has(patch.status)) {
        updates.completed_at = null
        updates.cancelled_at = null
      }
    }

    let after: Issue
    if (Object.keys(updates).length === 0 && patch.assignee_ids === undefined) return before
    updates.updated_at = new Date()

    if (Object.keys(updates).length > 0) {
      const [updated] = await tx
        .update(issues)
        .set(updates)
        .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
        .returning()
      if (!updated) return null
      after = updated
    } else {
      after = before
    }

    // ---------- Assignee sync ----------
    if (patch.assignee_ids !== undefined) {
      const newIds = new Set([...new Set(patch.assignee_ids ?? [])])
      const currentRows = await tx
        .select({ user_id: issueAssignees.user_id })
        .from(issueAssignees)
        .where(eq(issueAssignees.issue_id, id))
      const currentIds = new Set(currentRows.map((r) => r.user_id))

      const added = [...newIds].filter((uid) => !currentIds.has(uid))
      const removed = [...currentIds].filter((uid) => !newIds.has(uid))

      if (removed.length > 0) {
        await tx
          .delete(issueAssignees)
          .where(and(eq(issueAssignees.issue_id, id), inArray(issueAssignees.user_id, removed)))
      }
      if (added.length > 0) {
        await tx
          .insert(issueAssignees)
          .values(added.map((uid) => ({ issue_id: id, user_id: uid })))
          .onConflictDoNothing()
      }

      for (const uid of removed) {
        await removeAutoWatcher(tx, id, uid, 'assigned')
        await recordEvent(tx, {
          workspaceId,
          actorUserId,
          entityType: 'issue',
          entityId: id,
          action: 'unassigned',
          meta: { assignee_id: uid, seq: after.seq, title: after.title },
        })
      }
      for (const uid of added) {
        await addWatcher(tx, id, uid, 'assigned')
        if (uid !== actorUserId) {
          await recordEvent(tx, {
            workspaceId,
            actorUserId,
            entityType: 'issue',
            entityId: id,
            action: 'assigned',
            meta: { assignee_id: uid, seq: after.seq, title: after.title },
          })
        }
      }
    }

    // ---------- Field-level events ----------
    if (patch.status !== undefined && before.status !== after.status) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'status_changed',
        meta: { from: before.status, to: after.status, seq: after.seq, title: after.title },
      })
    }
    if (patch.priority !== undefined && before.priority !== after.priority) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'priority_changed',
        meta: { from: before.priority, to: after.priority, seq: after.seq, title: after.title },
      })
    }
    if (patch.task_id !== undefined && before.task_id !== after.task_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'task_changed',
        meta: { from: before.task_id, to: after.task_id, seq: after.seq, title: after.title },
      })
    }
    if (patch.project_id !== undefined && before.project_id !== after.project_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'project_changed',
        meta: { from: before.project_id, to: after.project_id, seq: after.seq, title: after.title },
      })
    }
    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'due_date_changed',
        meta: {
          from: before.due_date ? String(before.due_date).slice(0, 10) : null,
          to: after.due_date ? String(after.due_date).slice(0, 10) : null,
          seq: after.seq,
          title: after.title,
        },
      })
    }

    const generic: Record<string, [unknown, unknown]> = {}
    if (patch.title !== undefined && before.title !== after.title) generic.title = [before.title, after.title]
    if (patch.description !== undefined && before.description !== after.description) generic.description = [before.description, after.description]
    if (patch.start_date !== undefined && String(before.start_date) !== String(after.start_date)) generic.start_date = [before.start_date, after.start_date]
    if (Object.keys(generic).length > 0) {
      const beforeSnap: Record<string, unknown> = {}
      const afterSnap: Record<string, unknown> = {}
      for (const [k, [b, a]] of Object.entries(generic)) {
        beforeSnap[k] = b
        afterSnap[k] = a
      }
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'updated',
        diff: { before: beforeSnap, after: afterSnap },
        meta: { seq: after.seq, title: after.title },
        coalesceWindowMs: UPDATE_COALESCE_WINDOW_MS,
      })
    }

    // Re-project unconditionally rather than only when the title changed. The
    // upsert is idempotent, and "only when X changed" is a condition somebody
    // eventually gets wrong — silently, because a stale projection still
    // resolves. It also keeps entities.updated_at meaning "last touched", which
    // is what `bk search` orders by.
    await projectEntity(tx, {
      workspaceId,
      entityType: 'issue',
      number: after.seq,
      title: after.title,
      deletedAt: after.deleted_at,
    })

    return after
  })
}

// Delete now means soft-delete (move to the recycle bin). The row is kept and
// hidden from active views; restore/purge live in lib/db/queries/deletion.ts.
export async function deleteIssue(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return softDeleteIssue(workspaceId, id, actorUserId)
}

// --- Legacy compatibility ---

export async function getIssuesByProject(projectId: number) {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL
    ORDER BY COALESCE(i.position, 0) ASC, i.id DESC
  `)
  return result.rows
}

export async function getAllIssuesWithProjects() {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE i.deleted_at IS NULL
    ORDER BY COALESCE(i.position, 0) ASC, i.id DESC
  `)
  return result.rows
}

export interface IssuePageLegacy {
  data: unknown[]
  next_cursor: number | null
}

export async function getIssuesPage(opts: {
  project_id?: number
  limit: number
  cursor?: number | null
}): Promise<IssuePageLegacy> {
  const { project_id, limit, cursor } = opts
  const filterProject = project_id !== undefined
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE 1=1
      AND i.deleted_at IS NULL
      ${filterProject ? sql`AND i.project_id = ${project_id}` : sql``}
      ${filterCursor ? sql`AND i.id < ${cursor}` : sql``}
    ORDER BY COALESCE(i.position, 0) ASC, i.id DESC
    LIMIT ${limit + 1}
  `)
  const rows = result.rows as Array<{ id: number }>
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getIssuesByTask(taskId: number) {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM ${issues} i
    LEFT JOIN ${tasks} m ON m.id = i.task_id
    LEFT JOIN ${projects} p ON p.id = i.project_id
    WHERE i.task_id = ${taskId} AND i.deleted_at IS NULL
    ORDER BY COALESCE(i.position, 0) ASC, i.id DESC
  `)
  return result.rows
}

export async function getKanbanView(projectId: number) {
  const rows = await getIssuesByProject(projectId)
  const kanban: Record<string, unknown[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    done: [],
    cancelled: [],
  }
  for (const r of rows as Array<{ status: string }>) {
    if (kanban[r.status]) kanban[r.status].push(r)
    else kanban.backlog.push(r)
  }
  return kanban
}

// Persist manual ordering for a status group. Assigns positions 1..N in the
// given order. `orderedSeqs` are workspace #numbers (the public id). Only
// updates issues in this workspace + status, so cross-status positions don't collide.
export async function reorderIssues(
  workspaceId: number,
  status: string,
  orderedSeqs: number[]
): Promise<void> {
  if (orderedSeqs.length === 0) return
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedSeqs.length; i++) {
      await tx
        .update(issues)
        .set({ position: i + 1 })
        .where(
          and(
            eq(issues.workspace_id, workspaceId),
            eq(issues.seq, orderedSeqs[i]),
            eq(issues.status, status),
            isNull(issues.deleted_at)
          )
        )
    }
  })
}
