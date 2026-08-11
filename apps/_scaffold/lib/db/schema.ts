// This app's database schema: the shared platform tables plus its own.
//
// THE BOUNDARY RULE: this app's tables live in ITS OWN Postgres schema, and it
// may not read or write another app's. That is enforced by grants, not by
// review — `scaffold_app` simply has no SELECT on `issues.*`. See
// docs/platform-architecture.md §4.3 and docs/sql/app-role.sql.
//
// Deciding where a new table goes is one question: "would a second app need this
// unchanged?" Yes → `packages/platform-db` (workspaces, members, comments,
// labels, uploads, events). No → here.
import { pgSchema, serial, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { users } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const scaffoldSchema = pgSchema('scaffold')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RE-EXPORT IS WHY EVERY TABLE BELOW IS PREFIXED. DO NOT "TIDY" THE NAMES.
// ═══════════════════════════════════════════════════════════════════════════
// The line above exports `workspaces`, `workspaceMembers` and
// `workspaceInvitations` — the PLATFORM ones. A local `export const workspaces`
// would shadow `platform.workspaces` at every import site in this app,
// SILENTLY: no error, no warning, and the switch-over would have happened by
// name resolution instead of in a diff a reviewer can read.
//
// So the TypeScript names carry the app (`scaffoldWorkspaces`) and the Postgres
// names do not (`scaffold.workspaces` — the schema already says which app).
// Agent 2 found this in `apps/sales` Phase 1; agents 3 and 4 both relied on it,
// and agent 4 credited it as the reason a 35-call-site move stayed readable.
export * from '@blackcode/platform-db/schema'

/**
 * THIS APP'S WORKSPACES (Phase 7, 2026-08-11).
 *
 * Before this the scaffold read `platform.workspaces` through the shared route
 * factories, so a copy of it could not serve a request until somebody granted it
 * a workspace inside ANOTHER app. That is the add-on shape the multi-app
 * refactor exists to remove, and shipping it in the directory people copy would
 * have handed it to app #3.
 *
 * One workspace per person is a UI decision, not a schema one: every table here
 * carries a `workspace_id`, so growing a switcher later is a UI change rather
 * than a migration.
 */
export const scaffoldWorkspaces = scaffoldSchema.table('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 40 }).notNull(),
  owner_id: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Membership — and this table IS the access gate for this app.
 *
 * There is no per-app grant to check beside it: `platform.workspace_apps` and
 * `platform.app_access` were dropped on 2026-08-10 with `requireAppAccess`.
 * A member of this app's workspace is a user of this app, full stop.
 */
export const scaffoldWorkspaceMembers = scaffoldSchema.table('workspace_members', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => scaffoldWorkspaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Pending invitations into one of this app's workspaces. */
export const scaffoldInvitations = scaffoldSchema.table('invitations', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => scaffoldWorkspaces.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  invited_by: integer('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  token: varchar('token', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  accepted_at: timestamp('accepted_at', { withTimezone: true }),
  accepted_by: integer('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ScaffoldWorkspace = typeof scaffoldWorkspaces.$inferSelect
export type ScaffoldInvitation = typeof scaffoldInvitations.$inferSelect

/**
 * The one entity this scaffold defines, so that every layer below has something
 * real to carry: a route, a query, a CLI command, a guide topic.
 *
 * Note `seq` — the workspace-scoped **#number**. Every addressable entity in the
 * platform has one, because that is what agents and URNs use
 * (`bc:scaffold:acme/note/7`); the serial `id` is an internal detail that no
 * surface should ever print. `apps/issues` learned this the hard way: `bk trash`
 * exposed row ids until Phase 8.
 */
export const notes = scaffoldSchema.table('notes', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => scaffoldWorkspaces.id, { onDelete: 'cascade' }),
  /** Workspace-scoped #number. Allocated from `scaffold.note_counters` below. */
  seq: integer('seq').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /**
   * Soft delete — `bk <app> trash`. NULL means live.
   *
   * Every addressable entity on this platform is soft-deleted first and purged
   * separately, and the reason is `platform.blob_references`: a hard DELETE
   * fires this table's trigger and drops the row's references, so a file that
   * was only referenced here becomes deletable the instant somebody presses
   * delete — before anyone can change their mind. Two steps, two decisions.
   */
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

export type Note = typeof notes.$inferSelect

/**
 * This app's #number counter — one row per workspace, per entity type.
 *
 * ── WHY NOT `platform.workspace_counters` ────────────────────────────────────
 * Because it cannot be used. That table has FIXED columns — `last_issue_seq`,
 * `last_project_seq`, `last_task_seq` — so it is shaped for exactly one app's
 * entity types. A second app allocating a #number from it would have to ALTER a
 * platform table every time it added an entity, which is precisely the coupling
 * the platform/app split exists to prevent.
 *
 * So each app keeps its own counter, in its own schema, and that is the pattern
 * to copy. (Generalising the platform table to `(workspace_id, entity_type,
 * last_value)` would be better and is recorded as a follow-up — but it is a
 * migration of a shared table, not something a new app should have to do.)
 */
export const noteCounters = scaffoldSchema.table('note_counters', {
  workspace_id: integer('workspace_id')
    .primaryKey()
    .references(() => scaffoldWorkspaces.id, { onDelete: 'cascade' }),
  last_note_seq: integer('last_note_seq').default(0).notNull(),
})
