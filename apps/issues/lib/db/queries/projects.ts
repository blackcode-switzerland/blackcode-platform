// Project queries — workspace-scoped.
//
// Permission model: anyone who is a workspace_member sees every project in
// that workspace. project_members is now used as the project's *member list*
// (people working on it), not for access control — see project-relations.ts.
//
// Every mutation records an event in the same transaction.

import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { searchClause } from './search'
import { db } from '../client'
import { issues, projectUpdates, projects, type Project, users, workspaceMembers } from '../schema'
import { recordEvent, UPDATE_COALESCE_WINDOW_MS } from './events'
import { projectEntity } from './entities'
import { softDeleteProject, type DeleteMode } from './deletion'
import { setProjectMembers } from './project-relations'
import { allocateNextProjectSeq } from './workspaces'
import { toRichTextHtml } from '@/lib/rich-text'
import { assertProjectVocabulary } from './project-vocabulary'

export interface ProjectListItem extends Project {
  issue_count: number
  open_issues: number
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  health: string | null
  health_at: string | null
}

export async function listProjectsInWorkspace(
  workspaceId: number,
  options: { status?: string; search?: string } = {}
): Promise<ProjectListItem[]> {
  const result = await db.execute(sql`
    SELECT
      p.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int AS open_issues,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      upd.status AS health,
      upd.created_at AS health_at
    FROM ${projects} p
    LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
    LEFT JOIN ${users} lead ON lead.id = p.owner_id
    LEFT JOIN LATERAL (
      SELECT status, created_at
      FROM ${projectUpdates} pu
      WHERE pu.project_id = p.id
      ORDER BY pu.created_at DESC, pu.id DESC
      LIMIT 1
    ) upd ON true
    WHERE p.workspace_id = ${workspaceId}
      AND p.deleted_at IS NULL
      ${options.status ? sql`AND p.status = ${options.status}` : sql``}
      ${searchClause(options.search, { text: [sql`p.name`, sql`p.description`], seq: sql`p.seq` })}
    GROUP BY p.id, lead.name, lead.email, lead.avatar_url, upd.status, upd.created_at
    ORDER BY COALESCE(p.position, 0) ASC, p.id DESC
  `)
  return result.rows as unknown as ProjectListItem[]
}

export interface ProjectsPage {
  data: ProjectListItem[]
  next_cursor: number | null
}

export async function pageProjectsInWorkspace(opts: {
  workspaceId: number
  limit: number
  cursor?: number | null
}): Promise<ProjectsPage> {
  const { workspaceId, limit, cursor } = opts
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT
      p.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int AS open_issues
    FROM ${projects} p
    LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
    WHERE p.workspace_id = ${workspaceId}
      AND p.deleted_at IS NULL
      ${filterCursor ? sql`AND p.id < ${cursor}` : sql``}
    GROUP BY p.id
    ORDER BY COALESCE(p.position, 0) ASC, p.id DESC
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as unknown as (ProjectListItem & { id: number })[]
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}

// Persist manual ordering for projects in a workspace. Positions are global
// (not per-status) so list view and kanban share the same ordering.
export async function reorderProjects(
  workspaceId: number,
  orderedSeqs: number[]
): Promise<void> {
  if (orderedSeqs.length === 0) return
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedSeqs.length; i++) {
      await tx
        .update(projects)
        .set({ position: i + 1 })
        .where(
          and(
            eq(projects.workspace_id, workspaceId),
            eq(projects.seq, orderedSeqs[i]),
            isNull(projects.deleted_at)
          )
        )
    }
  })
}

export async function getProjectInWorkspace(
  workspaceId: number,
  id: number
): Promise<Project | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, id), eq(projects.workspace_id, workspaceId), isNull(projects.deleted_at))
    )
    .limit(1)
  return rows[0] ?? null
}

export interface CreateProjectInput {
  workspaceId: number
  name: string
  summary?: string | null
  description?: string | null
  color?: string
  icon?: string | null
  priority?: string
  lead_user_id?: number | null
  start_date?: string | null
  due_date?: string | null
  status?: string
  member_ids?: number[]
  actorUserId: number
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  assertProjectVocabulary(input)
  return await db.transaction(async (tx) => {
    const seq = await allocateNextProjectSeq(tx, input.workspaceId)
    const [row] = await tx
      .insert(projects)
      .values({
        workspace_id: input.workspaceId,
        seq,
        name: input.name,
        summary: input.summary ?? null,
        description: toRichTextHtml(input.description) ?? null,
        color: input.color ?? '#3B82F6',
        icon: input.icon ?? null,
        priority: input.priority ?? 'P2',
        owner_id: input.lead_user_id ?? input.actorUserId,
        status: input.status ?? 'backlog',
        start_date: input.start_date ?? null,
        due_date: input.due_date ?? null,
      })
      .returning()
    if (!row) throw new Error('project insert returned nothing')

    if (input.member_ids && input.member_ids.length > 0) {
      await setProjectMembers(tx, row.id, input.member_ids)
    }

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'project',
      entityId: row.id,
      action: 'created',
      diff: {
        after: { name: row.name, description: row.description, status: row.status },
      },
    })

    // Same transaction as the insert above — see lib/db/queries/entities.ts.
    await projectEntity(tx, {
      workspaceId: input.workspaceId,
      entityType: 'project',
      number: row.seq,
      title: row.name,
    })

    return row
  })
}

export interface UpdateProjectInput {
  name?: string
  summary?: string | null
  description?: string | null
  status?: string
  color?: string
  icon?: string | null
  priority?: string
  lead_user_id?: number | null
  start_date?: string | null
  due_date?: string | null
}

const PROJECT_DIFF_KEYS = [
  'name',
  'description',
  'status',
  'color',
  'icon',
  'priority',
  'start_date',
  'due_date',
] as const

export async function updateProject(
  workspaceId: number,
  id: number,
  patch: UpdateProjectInput,
  actorUserId: number
): Promise<Project | null> {
  assertProjectVocabulary(patch)
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.summary !== undefined) updates.summary = patch.summary
    if (patch.description !== undefined) updates.description = toRichTextHtml(patch.description)
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.color !== undefined) updates.color = patch.color
    if (patch.icon !== undefined) updates.icon = patch.icon
    if (patch.priority !== undefined) updates.priority = patch.priority
    if (patch.lead_user_id !== undefined) updates.owner_id = patch.lead_user_id
    if (patch.start_date !== undefined) updates.start_date = patch.start_date
    if (patch.due_date !== undefined) updates.due_date = patch.due_date

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    if (patch.status !== undefined && before.status !== after.status) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'project',
        entityId: id,
        action: 'status_changed',
        meta: { from: before.status, to: after.status, title: after.name },
      })
    }
    if (patch.priority !== undefined && before.priority !== after.priority) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'project',
        entityId: id,
        action: 'priority_changed',
        meta: { from: before.priority, to: after.priority, title: after.name },
      })
    }
    if (patch.lead_user_id !== undefined && before.owner_id !== after.owner_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'project',
        entityId: id,
        action: after.owner_id ? 'assigned' : 'unassigned',
        meta: {
          assignee_id: after.owner_id,
          previous_assignee_id: before.owner_id,
          title: after.name,
        },
      })
    }
    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'project',
        entityId: id,
        action: 'due_date_changed',
        meta: {
          from: before.due_date ? String(before.due_date).slice(0, 10) : null,
          to: after.due_date ? String(after.due_date).slice(0, 10) : null,
          title: after.name,
        },
      })
    }

    // Generic updated for name/description/color/icon
    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of PROJECT_DIFF_KEYS) {
      if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
        beforeSnap[k] = (before as Record<string, unknown>)[k]
        afterSnap[k] = (after as Record<string, unknown>)[k]
      }
    }
    const remainingKeys = Object.keys(beforeSnap).filter(
      (k) => !['status', 'priority', 'due_date'].includes(k)
    )
    if (remainingKeys.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'project',
        entityId: id,
        action: 'updated',
        diff: { before: beforeSnap, after: afterSnap },
        coalesceWindowMs: UPDATE_COALESCE_WINDOW_MS,
      })
    }

    // Unconditional and idempotent — see the note in issues.ts updateIssue.
    await projectEntity(tx, {
      workspaceId,
      entityType: 'project',
      number: after.seq,
      title: after.name,
      deletedAt: after.deleted_at,
    })

    return after
  })
}

// Delete now means soft-delete (move to the recycle bin). `mode` controls the
// attached issues/tasks: 'detach' (default) keeps them active but unlinks
// them — matching the old hard-delete + FK SET NULL behavior; 'cascade' bins
// them together so they restore as a group. See lib/db/queries/deletion.ts.
export async function deleteProject(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return softDeleteProject(workspaceId, id, actorUserId, mode)
}

// --- Legacy compatibility shims ---
// Kept to avoid touching every old call site. They forward to the new
// workspace-aware functions. The Phase 13 cleanup will remove these.

export async function getProjects(userId?: number) {
  if (userId === undefined) {
    const result = await db.execute(sql`
      SELECT p.*, COUNT(i.id)::int AS issue_count,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
      FROM ${projects} p LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.updated_at DESC
    `)
    return result.rows
  }
  // Limit to projects in workspaces the user is a member of.
  const result = await db.execute(sql`
    SELECT p.*,
      wm.role AS member_role,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
    FROM ${projects} p
    INNER JOIN ${workspaceMembers} wm
      ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
    LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
    GROUP BY p.id, wm.role
    ORDER BY p.updated_at DESC
  `)
  return result.rows
}

export async function getProjectsPage(opts: {
  user_id: number
  limit: number
  cursor?: number | null
}): Promise<ProjectsPage> {
  const { user_id, limit, cursor } = opts
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT p.*,
      wm.role AS member_role,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
    FROM ${projects} p
    INNER JOIN ${workspaceMembers} wm
      ON wm.workspace_id = p.workspace_id AND wm.user_id = ${user_id}
    LEFT JOIN ${issues} i ON i.project_id = p.id AND i.deleted_at IS NULL
    WHERE 1=1
      AND p.deleted_at IS NULL
      ${filterCursor ? sql`AND p.id < ${cursor}` : sql``}
    GROUP BY p.id, wm.role
    ORDER BY p.id DESC
    LIMIT ${limit + 1}
  `)
  const rows = result.rows as unknown as (ProjectListItem & { id: number })[]
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}
