// This app's database schema: the shared platform tables plus its own.
//
// THE BOUNDARY RULE: this app's tables live in ITS OWN Postgres schema, and it
// may not read or write another app's. That is enforced by grants, not by
// review — `billing_app` simply has no SELECT on `issues.*`. See
// docs/platform-architecture.md §4.3 and docs/sql/billing-app-role.sql.
//
// Deciding where a new table goes is one question: "would a second app need this
// unchanged?" Yes → `packages/platform-db` (users, api_tokens, the blob index).
// No → here. For b/billing the answer has been "here" every time so far.
import { pgSchema, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core'
import { users } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const billingSchema = pgSchema('billing')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RE-EXPORT IS WHY EVERY TABLE BELOW IS PREFIXED. DO NOT "TIDY" THE NAMES.
// ═══════════════════════════════════════════════════════════════════════════
// The line below exports `workspaces`, `workspaceMembers` and
// `workspaceInvitations` — the PLATFORM ones. A local `export const workspaces`
// would shadow `platform.workspaces` at every import site in this app,
// SILENTLY: no error, no warning, and the switch-over would have happened by
// name resolution instead of in a diff a reviewer can read.
//
// So the TypeScript names carry the app (`billingWorkspaces`) and the Postgres
// names do not (`billing.workspaces` — the schema already says which app).
export * from '@blackcode/platform-db/schema'

/**
 * THIS APP'S WORKSPACES.
 *
 * An app owns its workspaces, members and invitations. `platform.*` is identity
 * plus an address book; `platform.workspaces` is `apps/issues`' data despite the
 * name. FK into `platform.users` freely, and into nothing else outside this
 * schema.
 *
 * ── TWO COLUMNS THE SCAFFOLD HAS THAT THIS DOES NOT ─────────────────────────
 * No `app` column: the schema name is the answer. And no `deleted_at`, which has
 * never had a writer in any app and would acquire a second meaning by being
 * carried forward. Dropping the columns that only existed because a platform
 * table was shared is part of copying it.
 */
export const billingWorkspaces = billingSchema.table('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 40 }).notNull(),
  /**
   * `ON DELETE RESTRICT` stays, and it is INERT — know what it does not do.
   *
   * It cannot fire against the `UPDATE` that soft-deletes a user, which is how
   * an account is actually closed. What protects this app's data from being
   * stranded under an unreachable account is `AppContext.footprint`
   * (lib/db/queries/footprint.ts), not this constraint.
   */
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
export const billingWorkspaceMembers = billingSchema.table('workspace_members', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Pending invitations into one of this app's workspaces. */
export const billingInvitations = billingSchema.table('invitations', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
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

/**
 * The #number allocator: one row per workspace, PER ENTITY TYPE.
 *
 * ── WHY NOT `platform.workspace_counters` ────────────────────────────────────
 * Because it cannot be used. That table has FIXED columns — `last_issue_seq`,
 * `last_project_seq`, `last_task_seq` — so it is shaped for exactly one app's
 * entity types. A second app allocating a #number from it would have to ALTER a
 * platform table every time it added an entity, which is precisely the coupling
 * the platform/app split exists to prevent.
 *
 * ── AND WHY NOT THE SCAFFOLD'S SHAPE EITHER ──────────────────────────────────
 * The scaffold's `note_counters` is `(workspace_id, last_note_seq)`: one column
 * per entity type, which is the same mistake one level down. Phase 1 of this app
 * adds `company`, `invoice` and `audit`; phases 4 and 5 add `recurrence` and
 * `history`. With a column per type each of those is a migration of this table.
 * With `(workspace_id, entity_type, last_value)` they are rows, and the
 * allocator is one upsert that never changes.
 *
 * The counter is bumped with `RETURNING` inside the writing transaction, never
 * read-then-write: two concurrent creates would otherwise read the same value
 * and collide. See `lib/db/queries/seq.ts` from phase 1.
 */
export const billingCounters = billingSchema.table('counters', {
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  entity_type: varchar('entity_type', { length: 20 }).notNull(),
  last_value: integer('last_value').default(0).notNull(),
})

export type BillingWorkspace = typeof billingWorkspaces.$inferSelect
export type BillingInvitation = typeof billingInvitations.$inferSelect
