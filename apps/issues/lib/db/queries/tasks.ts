// Task queries — workspace-scoped. project_id is optional: tasks
// can exist standalone within a workspace.
//
// Listing rules:
//   - listTasksInWorkspace(ws, { project_id: null })   only standalone
//   - listTasksInWorkspace(ws, { project_id: <N> })   only attached to project N
//   - listTasksInWorkspace(ws, {})                     everything in the workspace

import { and, eq, isNull, sql } from 'drizzle-orm'
import { searchClause } from './search'
import { db } from '../client'
import { issues, projects, tasks, type Task, users } from '../schema'
import { ISSUE_CANCELLED_STATUS, ISSUE_DONE_STATUS } from '@/lib/work-items'

// ---------------------------------------------------------------------------
// TASK PROGRESS — DERIVED HERE, IN SQL, AND NOWHERE ELSE
// ---------------------------------------------------------------------------
// Every task query below selects this block. It is one fragment rather than
// five copies because five copies is how `completed_issues` came to mean
// `i.status = 'done'` in five places while lib/work-items.ts was the file that
// claimed to own the vocabulary.
//
// It must stay in SQL. A caller that computed progress by listing a task's
// issues would be wrong the moment paging truncated the list, and wrong
// silently: a count is indistinguishable from a correct count.
//
// `status` is DERIVED, never read from the column. See the long note at
// lib/work-items.ts → "tasks" for why, and for the two edge cases (`empty`,
// and cancelled-is-not-done) that the CASE below encodes.
const doneCount = sql`COUNT(i.id) FILTER (WHERE i.status = ${ISSUE_DONE_STATUS})`
const cancelledCount = sql`COUNT(i.id) FILTER (WHERE i.status = ${ISSUE_CANCELLED_STATUS})`
// IS DISTINCT FROM, not NOT IN: `issues.status` is nullable, and an issue with
// a NULL status is open work, not excluded work. COUNT(i.id) already ignores
// the all-NULL row a LEFT JOIN produces for a task with no issues.
const openCount = sql`COUNT(i.id) FILTER (
    WHERE i.status IS DISTINCT FROM ${ISSUE_DONE_STATUS}
      AND i.status IS DISTINCT FROM ${ISSUE_CANCELLED_STATUS}
  )`

// The CASE alone — reusable in HAVING, where the alias does not exist yet.
const taskProgressStatusSql = sql`
  CASE
    WHEN COUNT(i.id) = 0 THEN 'empty'
    WHEN ${openCount} > 0 THEN 'active'
    WHEN ${doneCount} > 0 THEN 'done'
    ELSE 'cancelled'
  END`

const taskProgressSql = sql`
  COUNT(i.id)::int AS issue_count,
  ${doneCount}::int AS completed_issues,
  ${cancelledCount}::int AS cancelled_issues,
  ${openCount}::int AS open_issues,
  ${taskProgressStatusSql} AS progress_status`
import { recordEvent, UPDATE_COALESCE_WINDOW_MS } from './events'
import { projectEntity } from './entities'
import { softDeleteTask, type DeleteMode } from './deletion'
import { allocateNextTaskSeq } from './workspaces'
import { toRichTextHtml } from '@/lib/rich-text'

export interface TaskListItem extends Task {
  project_name: string | null
  project_icon: string | null
  project_icon_url: string | null
  project_color: string | null
  project_seq: number | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  issue_count: number
  completed_issues: number
  cancelled_issues: number
  open_issues: number
  // Derived — see taskProgressSql. Overrides the dead `status` column on the
  // wire (lib/api/serialize.ts → publicTask).
  progress_status: string
}

export interface ListTasksOptions {
  projectId?: number | null
  /** Filters on the DERIVED status (empty|active|done|cancelled), not the column. */
  status?: string
  search?: string
}

export async function listTasksInWorkspace(
  workspaceId: number,
  opts: ListTasksOptions = {}
): Promise<TaskListItem[]> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.icon_url AS project_icon_url,
      p.color AS project_color,
      p.seq AS project_seq,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      ${taskProgressSql}
    FROM ${tasks} m
    LEFT JOIN ${projects} p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN ${users} lead ON lead.id = m.lead_id
    LEFT JOIN ${issues} i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.workspace_id = ${workspaceId}
      AND m.deleted_at IS NULL
      ${
        opts.projectId === null
          ? sql`AND m.project_id IS NULL`
          : opts.projectId !== undefined
            ? sql`AND m.project_id = ${opts.projectId}`
            : sql``
      }
      ${searchClause(opts.search, { text: [sql`m.name`, sql`m.description`], seq: sql`m.seq` })}
    GROUP BY m.id, p.name, p.icon, p.icon_url, p.color, p.seq, lead.name, lead.email, lead.avatar_url
    ${
      // HAVING, not WHERE: the derived status is an aggregate over the joined
      // issues, so it does not exist yet at WHERE time.
      opts.status ? sql`HAVING ${taskProgressStatusSql} = ${opts.status}` : sql``
    }
    ORDER BY m.due_date ASC NULLS LAST, m.id DESC
  `)
  return result.rows as unknown as TaskListItem[]
}

export async function getTaskInWorkspace(
  workspaceId: number,
  id: number
): Promise<TaskListItem | null> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.icon_url AS project_icon_url,
      p.color AS project_color,
      p.seq AS project_seq,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      ${taskProgressSql}
    FROM ${tasks} m
    LEFT JOIN ${projects} p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN ${users} lead ON lead.id = m.lead_id
    LEFT JOIN ${issues} i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.workspace_id = ${workspaceId} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name, p.icon, p.icon_url, p.color, p.seq, lead.name, lead.email, lead.avatar_url
  `)
  return (result.rows[0] as unknown as TaskListItem) ?? null
}

export interface CreateTaskInput {
  workspaceId: number
  name: string
  description?: string | null
  due_date?: string | null
  projectId?: number | null
  lead_user_id?: number | null
  actorUserId: number
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return await db.transaction(async (tx) => {
    const seq = await allocateNextTaskSeq(tx, input.workspaceId)
    const [row] = await tx
      .insert(tasks)
      .values({
        workspace_id: input.workspaceId,
        seq,
        project_id: input.projectId ?? null,
        name: input.name,
        description: toRichTextHtml(input.description) ?? null,
        due_date: input.due_date ?? null,
        // The column is vestigial — status is derived from the task's issues.
        // Written once so the NOT NULL-ish default is explicit rather than
        // implied, and never read. See lib/work-items.ts → "tasks".
        status: 'active',
        // Mirror projects: default the lead to the creator.
        // ?? would fold an explicit null back into the creator. Omitted and
        // "explicitly nobody" are different requests — see the route.
        lead_id: input.lead_user_id === undefined ? input.actorUserId : input.lead_user_id,
      })
      .returning()
    if (!row) throw new Error('task insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'task',
      entityId: row.id,
      action: 'created',
      diff: {
        after: { name: row.name, project_id: row.project_id, due_date: row.due_date },
      },
    })

    // Same transaction as the insert above — see lib/db/queries/entities.ts.
    await projectEntity(tx, {
      workspaceId: input.workspaceId,
      entityType: 'task',
      number: row.seq,
      title: row.name,
    })

    return row
  })
}

export interface UpdateTaskInput {
  name?: string
  description?: string | null
  due_date?: string | null
  project_id?: number | null
  lead_user_id?: number | null
  // `status` is deliberately absent. A task's status is derived from its
  // issues (see taskProgressSql); accepting a write here would put a value in
  // a column nothing reads, and the caller would see it come back derived and
  // different. updateTask throws `task_status_derived` if one is passed.
}

const TASK_DIFF_KEYS = ['name', 'description', 'due_date', 'project_id'] as const

export async function updateTask(
  workspaceId: number,
  id: number,
  patch: UpdateTaskInput,
  actorUserId: number
): Promise<Task | null> {
  // Loud, not ignored: a caller that thinks it can set a task's status has a
  // wrong model of what a task is, and silently dropping the field would leave
  // it believing the write landed.
  if ('status' in patch) throw new Error('task_status_derived')

  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = toRichTextHtml(patch.description)
    if (patch.due_date !== undefined) updates.due_date = patch.due_date
    if (patch.project_id !== undefined) updates.project_id = patch.project_id
    if (patch.lead_user_id !== undefined) updates.lead_id = patch.lead_user_id

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: 'due_date_changed',
        meta: {
          from: before.due_date ? String(before.due_date).slice(0, 10) : null,
          to: after.due_date ? String(after.due_date).slice(0, 10) : null,
          title: after.name,
        },
      })
    }
    if (patch.lead_user_id !== undefined && before.lead_id !== after.lead_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: after.lead_id ? 'assigned' : 'unassigned',
        meta: {
          assignee_id: after.lead_id,
          previous_assignee_id: before.lead_id,
          title: after.name,
        },
      })
    }

    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of TASK_DIFF_KEYS) {
      if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
        beforeSnap[k] = (before as Record<string, unknown>)[k]
        afterSnap[k] = (after as Record<string, unknown>)[k]
      }
    }
    const remainingKeys = Object.keys(beforeSnap).filter((k) => k !== 'due_date')
    if (remainingKeys.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: 'updated',
        diff: { before: beforeSnap, after: afterSnap },
        coalesceWindowMs: UPDATE_COALESCE_WINDOW_MS,
      })
    }

    // Unconditional and idempotent — see the note in issues.ts updateIssue.
    await projectEntity(tx, {
      workspaceId,
      entityType: 'task',
      number: after.seq,
      title: after.name,
      deletedAt: after.deleted_at,
    })

    return after
  })
}

// Delete now means soft-delete (move to the recycle bin). `mode` controls the
// attached issues: 'detach' (default) keeps them active but unlinks them;
// 'cascade' bins them together. See lib/db/queries/deletion.ts.
export async function deleteTask(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return softDeleteTask(workspaceId, id, actorUserId, mode)
}

// --- Legacy compatibility ---

export async function getTasks(projectId: number) {
  const result = await db.execute(sql`
    SELECT m.*,
      ${taskProgressSql}
    FROM ${tasks} m
    LEFT JOIN ${issues} i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL
    GROUP BY m.id
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getAllTasks() {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      ${taskProgressSql}
    FROM ${tasks} m
    LEFT JOIN ${projects} p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN ${issues} i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
    GROUP BY m.id, p.name
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getTaskWithDetails(id: number) {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      ${taskProgressSql}
    FROM ${tasks} m
    LEFT JOIN ${projects} p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN ${issues} i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name
  `)
  return result.rows[0] ?? null
}
