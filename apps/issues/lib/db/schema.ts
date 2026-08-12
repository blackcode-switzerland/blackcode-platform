// Issues-app database schema.
//
// This file is the app's COMPLETE schema: it re-exports the shared platform
// tables from @blackcode/platform-db and adds the ten tables that are genuinely
// an issue tracker, in the `issues` Postgres schema. Every existing `@/lib/db/schema` import keeps working
// unchanged, and Drizzle's query client still sees one combined schema.
//
// Adding a table here means it belongs to THIS app. If a future app would need
// it too, it belongs in @blackcode/platform-db instead — see the boundary rule
// in that file and docs/platform-architecture.md §4.3.
//
// `comments` moved to @blackcode/platform-db in Phase 3, once migration 0032
// dropped its legacy issue_id FK to issues.

import {
  pgSchema,
  serial,
  varchar,
  text,
  integer,
  decimal,
  date,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * The `issues` Postgres schema — this app's own tables.
 *
 * Phase 3 moved them out of `public`. The app role may read and write
 * `platform.*` freely, but no other app may touch this schema: that boundary is
 * a Postgres grant, not a convention. See docs/platform-architecture.md §4.3.
 */
export const issuesSchema = pgSchema('issues')
import { users, workspaces, labels } from '@blackcode/platform-db'

// Re-export the platform tables so `@/lib/db/schema` remains the single import
// site for the whole schema.
export * from '@blackcode/platform-db/schema'

/**
 * This app's #number counters — one row per workspace.
 *
 * ── WHY IT LIVES HERE AND NOT IN `platform` ─────────────────────────────────
 * It was `platform.workspace_counters` until migration 0040, and it was wrong
 * there: its columns name THIS app's entity types (`last_issue_seq`,
 * `last_project_seq`, `last_task_seq`), so a second app could not allocate a
 * #number without ALTERing a platform table — exactly the app→platform coupling
 * Phase 3 spent its whole budget removing.
 *
 * docs/platform-architecture.md §4.6 originally prescribed reshaping it to
 * `(workspace_id, app, entity_type, last_seq)` so every app could share one
 * table. Building `apps/_scaffold` in Phase 8 showed a better answer: apps
 * should not share a counter at all. Sharing it buys nothing — no query ever
 * spans two apps' counters — and costs a shared write point and a shared
 * migration. Each app keeps its own, in its own schema. `_scaffold` does the
 * same, in three lines.
 *
 * Allocation is `UPDATE … RETURNING`, never read-then-write: two concurrent
 * creates would otherwise read the same value and collide on the unique index.
 * See `allocateNextIssueSeq` and friends in `lib/db/queries/workspaces.ts`.
 */
export const workspaceCounters = issuesSchema.table('workspace_counters', {
  workspace_id: integer('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  last_issue_seq: integer('last_issue_seq').default(0).notNull(),
  // Per-workspace, per-type sequences for the human-facing #number shown in the
  // UI and URL. Allocated alongside the row insert.
  last_project_seq: integer('last_project_seq').default(0).notNull(),
  last_task_seq: integer('last_task_seq').default(0).notNull(),
})

export type WorkspaceCounter = typeof workspaceCounters.$inferSelect

export const projects = issuesSchema.table(
  'projects',
  {
  id: serial('id').primaryKey(),
  // Phase 1: nullable during backfill window. Phase 13 cleanup tightens to NOT NULL.
  workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  summary: text('summary'),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('active'),
  // Workspace-scoped human number (the #N shown in UI + URL). Allocated via
  // workspace_counters.last_project_seq. Nullable only during the backfill
  // window; the application always sets it going forward.
  seq: integer('seq'),
  owner_id: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  priority: varchar('priority', { length: 10 }).default('P2'),
  visibility: varchar('visibility', { length: 20 }).default('team'),
  color: varchar('color', { length: 10 }).default('#3B82F6'),
  // Named icon key (lucide icon name, e.g. "Rocket"). Rendered with `color`.
  icon: varchar('icon', { length: 40 }),
  icon_url: text('icon_url'),
  banner_url: text('banner_url'),
  start_date: date('start_date'),
  due_date: date('due_date'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  position: integer('position'),
  // Recycle bin (0022): deleted_at IS NULL => active. Soft-delete keeps the row
  // so child FKs survive for batch-aware restore. See lib/db/queries/deletion.ts.
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    deletedIdx: index('idx_projects_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_projects_batch').on(t.delete_batch_id),
    workspaceSeqUniq: uniqueIndex('uq_projects_workspace_seq').on(t.workspace_id, t.seq),
  })
)

// Project status updates ("health" posts). Each project accumulates a feed of
// updates; the latest one is the project's current health. status is one of
// on_track / at_risk / off_track; body is rich-text HTML.

export const projectUpdates = issuesSchema.table(
  'project_updates',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(),
    body: text('body'),
    author_id: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index('idx_project_updates_project').on(t.project_id, t.created_at),
    statusCheck: check(
      'project_updates_status_check',
      sql`${t.status} IN ('on_track', 'at_risk', 'off_track')`
    ),
  })
)

export const tasks = issuesSchema.table(
  'tasks',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Phase 7: project_id is now optional — tasks can be standalone within
    // a workspace. ON DELETE SET NULL so deleting the project doesn't take the
    // task with it.
    project_id: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    due_date: date('due_date'),
    // VESTIGIAL — DO NOT READ. A task's status is DERIVED from its issues
    // (lib/db/queries/tasks.ts → taskProgressSql), and the wire field named
    // `status` on a task is that derived value, never this column. Every row
    // here is 'active'; no write path in this repo has ever set another value.
    // Kept only because dropping a live column buys nothing. The full reasoning
    // and the two edge cases are in lib/work-items.ts → "tasks".
    status: varchar('status', { length: 50 }).default('active'),
    // Workspace-scoped human number (the #N shown in UI + URL). Allocated via
    // workspace_counters.last_task_seq. Nullable only during the backfill window.
    seq: integer('seq'),
    // Task lead — the person accountable for the task (mirrors projects.owner_id).
    // ON DELETE SET NULL so removing the user just clears the lead.
    lead_id: integer('lead_id').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    // Recycle bin (0022). See lib/db/queries/deletion.ts.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    projectIdx: index('idx_tasks_project').on(t.project_id),
    deletedIdx: index('idx_tasks_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_tasks_batch').on(t.delete_batch_id),
    workspaceSeqUniq: uniqueIndex('uq_tasks_workspace_seq').on(t.workspace_id, t.seq),
  })
)

export const issues = issuesSchema.table(
  'issues',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Workspace-scoped sequence; allocated via workspace_counters. Nullable
    // during backfill — 0004 populates and the application sets it going
    // forward. Phase 13 tightens to NOT NULL.
    seq: integer('seq'),
    // Phase 8: project_id is optional — issues can be standalone within a
    // workspace. ON DELETE SET NULL so deleting the project doesn't take its
    // issues with it.
    project_id: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    task_id: integer('task_id').references(() => tasks.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 50 }).default('backlog'),
    priority: integer('priority').default(3),
    reporter_id: integer('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    start_date: date('start_date'),
    due_date: date('due_date'),
    estimated_hours: decimal('estimated_hours', { precision: 5, scale: 1 }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    position: integer('position'),
    // Recycle bin (0022). See lib/db/queries/deletion.ts.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    projectIdx: index('idx_issues_project').on(t.project_id),
    statusIdx: index('idx_issues_status').on(t.status),
    taskIdx: index('idx_issues_task').on(t.task_id),
    priorityIdx: index('idx_issues_priority').on(t.priority),
    workspaceIdx: index('idx_issues_workspace').on(t.workspace_id),
    workspaceSeqUniq: uniqueIndex('uq_issues_workspace_seq').on(t.workspace_id, t.seq),
    deletedIdx: index('idx_issues_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_issues_batch').on(t.delete_batch_id),
    priorityCheck: check('issues_priority_check', sql`${t.priority} >= 1 AND ${t.priority} <= 5`),
  })
)

export const attachments = issuesSchema.table(
  'attachments',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    file_url: text('file_url').notNull(),
    file_size: integer('file_size'),
    mime_type: varchar('mime_type', { length: 100 }),
    uploaded_by: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    issueIdx: index('idx_attachments_issue').on(t.issue_id),
  })
)

// Upload ledger — one row per file stored through our upload pipeline (Vercel
// Blob in prod, public/uploads in dev), written at upload time. This is the
// authoritative record of "a file exists in storage and which workspace it
// belongs to"; it is the source for the owner-facing Storage page.
//
// IMPORTANT: this ledger is metadata only. It is NEVER the authority for whether
// a file may be deleted — deletion is gated by a live reference scan over the
// content tables (see lib/storage), so a stale/missing ledger row can never
// cause data loss. `url` is unique so re-recording the same upload is a no-op.

export const issueLabels = issuesSchema.table(
  'issue_labels',
  {
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.label_id] }),
  })
)

// Issue ↔ assignee association (many-to-many). Replaces the former single
// assignee_id column on issues. ON DELETE CASCADE on both sides so removing
// either the issue or the user cleans up the row automatically.

export const issueAssignees = issuesSchema.table(
  'issue_assignees',
  {
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assigned_at: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.user_id] }),
    issueIdx: index('idx_issue_assignees_issue').on(t.issue_id),
    userIdx: index('idx_issue_assignees_user').on(t.user_id),
  })
)

// Project ↔ label association. Reuses the workspace-scoped labels table.

export const projectLabels = issuesSchema.table(
  'project_labels',
  {
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.project_id, t.label_id] }),
    labelIdx: index('idx_project_labels_label').on(t.label_id),
  })
)

export const projectMembers = issuesSchema.table(
  'project_members',
  {
    id: serial('id').primaryKey(),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).default('member'),
    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectIdx: index('idx_project_members_project').on(t.project_id),
    userIdx: index('idx_project_members_user').on(t.user_id),
    uniq: uniqueIndex('uq_project_members_project_user').on(t.project_id, t.user_id),
  })
)

export const issueWatchers = issuesSchema.table(
  'issue_watchers',
  {
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 20 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.user_id] }),
    userIdx: index('idx_issue_watchers_user').on(t.user_id),
    reasonCheck: check(
      'issue_watchers_reason_check',
      sql`${t.reason} IN ('manual', 'assigned', 'reporter')`
    ),
  })
)

// events — the spine. Every domain mutation records a row in the same
// transaction. Activity feed, inbox, analytics, and undo all read from here.
// See §1.4 of docs/architecture-rebuild.md.

// ---- inferred row types (app tables) ----

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
export type ProjectUpdate = typeof projectUpdates.$inferSelect
export type NewProjectUpdate = typeof projectUpdates.$inferInsert
export type Attachment = typeof attachments.$inferSelect
export type IssueAssignee = typeof issueAssignees.$inferSelect
export type ProjectMember = typeof projectMembers.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type IssueWatcher = typeof issueWatchers.$inferSelect
export type NewIssueWatcher = typeof issueWatchers.$inferInsert
