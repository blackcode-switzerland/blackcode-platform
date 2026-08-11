// Platform database schema — the tables every Blackcode app shares.
//
// The split is decided by one question: "would a sales app need this?" Workspaces,
// members, comments, files, labels, activity and the inbox are org concepts, not
// issue-tracker concepts. Only tables that literally name an issue/task/project
// belong to an app. See docs/platform-architecture.md §4.3.
//
// THE BOUNDARY RULE: nothing in this file may reference an app table. An app may
// FK into platform.* freely; platform may never FK into an app. If you find
// yourself importing from apps/*, the table does not belong here.
//
// `comments` landed here in Phase 3, once migration 0032 dropped its legacy
// `issue_id` column — that one live FK to issues.issues was the only
// platform->app dependency left, and it would have broken
// `pg_dump --schema=issues`, the extraction path Phase 8 rehearses.

import {
  pgSchema,
  serial,
  bigserial,
  bigint,
  varchar,
  text,
  integer,
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
 * The `platform` Postgres schema.
 *
 * Phase 3 moved these tables out of `public`. Every table is schema-qualified in
 * Drizzle rather than relying on search_path — search_path is a safety net, not
 * the mechanism. See docs/platform-architecture.md §4.3.
 */
export const platformSchema = pgSchema('platform')

export const users = platformSchema.table('users', {
  id: serial('id').primaryKey(),
  google_id: varchar('google_id', { length: 255 }).unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  tagline: varchar('tagline', { length: 140 }),
  avatar_url: text('avatar_url'),
  password_hash: varchar('password_hash', { length: 255 }),
  // active_workspace_id is a soft FK — we don't enforce it via Drizzle's
  // .references() to avoid a circular declaration with workspaces. The
  // application layer keeps it in sync (set on workspace switch / create,
  // cleared on workspace delete).
  active_workspace_id: integer('active_workspace_id'),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  // Bumped whenever the password is set/reset. Existing browser sessions carry
  // a snapshot of this value; if it no longer matches, the session is treated
  // as invalid — i.e. a password reset signs you out everywhere.
  password_changed_at: timestamp('password_changed_at', { withTimezone: true }),
  last_login: timestamp('last_login', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const workspaces = platformSchema.table(
  'workspaces',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 40 }).notNull(),
    logo_url: text('logo_url'),
    owner_id: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    // Future-proofing for storage quotas: a hard cap (in bytes) on the total
    // size of files uploaded into this workspace. NULL = unlimited (the only
    // behaviour today — nothing enforces this yet). Current usage is the SUM of
    // `uploads.size`; enforcement, when added, compares the two at upload time.
    storage_limit_bytes: bigint('storage_limit_bytes', { mode: 'number' }),
  },
  (t) => ({
    slugUniq: uniqueIndex('uq_workspaces_slug').on(t.slug),
    ownerIdx: index('idx_workspaces_owner').on(t.owner_id),
  })
)

export const workspaceMembers = platformSchema.table(
  'workspace_members',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).default('member').notNull(),
    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('uq_workspace_members_ws_user').on(t.workspace_id, t.user_id),
    userIdx: index('idx_workspace_members_user').on(t.user_id),
    roleCheck: check(
      'workspace_members_role_check',
      sql`${t.role} IN ('owner', 'member')`
    ),
  })
)

// ---- the app registry (Phase 4) ----
//
// Two levels of identity, and only one of them is shared:
//
//   users              your account          global — one login, every app
//   workspace_members  you are in this org   per workspace, and PER APP since
//                                            2026-08-10: this is issues' table,
//                                            sales has `sales.workspace_members`
//
// `apps` is the ADDRESS BOOK: one row per app in the suite, carrying where it is
// deployed. That is what lets `bk meta` tell the CLI how to reach each app
// without any app hardcoding a URL.
//
// ── `workspace_apps` AND `app_access` ARE GONE (2026-08-10, refactor Phase 5) ──
// They gated an app INSIDE a shared workspace, and apps do not share workspaces
// any more. By the end they were not merely redundant, they were WRONG: a grant
// row named a `platform.workspaces` id for an app whose workspaces had moved to
// its own schema, so `/api/meta` reported a sales workspace that sales itself
// 404s. Reachability is no longer derivable centrally — it lives in each app's
// own membership table, and no deployment holds a grant on another's schema
// (§4.3). An app answers for itself; the CLI is what spans them.

export const apps = platformSchema.table('apps', {
  // The slug is the primary key on purpose: it is the identifier that appears in
  // URNs (`bc:issues:…`), in guide topic folders and in the CLI namespace. A
  // surrogate id would mean every one of those carried a number nobody could read.
  slug: varchar('slug', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  description: text('description'),
  // Where this app is deployed (e.g. https://issues.blackcode.ch). Nullable so a
  // registry row can exist before the deployment does.
  base_url: text('base_url'),
  // Global kill switch. Since Phase 5 this is the ONLY switch: a disabled app
  // disappears from every registry answer and is unroutable by the CLI.
  enabled: boolean('enabled').default(true).notNull(),
  // Does this app's schema carry the `platform.blob_references` triggers?
  //
  // This is the flag that lets a DIFFERENT deployment answer "does <app>
  // reference this file?" without reading <app>'s tables — which its Postgres
  // role forbids (§4.3). It is set by the app's own migration, in the same file
  // that installs the triggers, and it is the ONLY thing that makes an app
  // without a locally-registered scanner safe to skip in the delete gate. See
  // packages/platform-storage/src/references.ts.
  //
  // Default false, deliberately: an app that has not proved it maintains the
  // index blocks blob deletion rather than being assumed absent.
  maintains_blob_index: boolean('maintains_blob_index').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---- cross-app primitives (Phase 6) ----
//
// Two tables and one generalisation are what make a second app worth having.
// Everything before this phase was rearrangement; this is the first thing that
// could not be done at all with one app per database.
//
// A URN is the one string that addresses any entity in any app:
//
//   bc:<app>:<workspace-slug>/<entity-type>/<number>
//   bc:issues:kali-sa/issue/482
//
// `<number>` is the workspace #number, never the global row id — the same rule
// every route and every `bk` command already follows. See urn.ts for the parser.

/**
 * `platform.entities` — the cross-app index of what exists.
 *
 * This is a PROJECTION. `issues.issues` is the truth; a row here is a copy kept
 * for the questions no single app can answer — federated search, a merged
 * activity feed, a link whose other end lives in another app's schema (which
 * this app has no grant to read).
 *
 * Because it is derived, it can drift, and drift here is silent: search returns
 * slightly stale titles and nobody notices for weeks. Two things keep it honest,
 * and both are load-bearing rather than belt-and-braces:
 *
 *   1. every write goes in the SAME transaction as its source write
 *      (`upsertEntity` takes the caller's `tx`, never opens its own), and
 *   2. `reconcileEntities` re-derives the whole projection from the source
 *      tables and reports the difference.
 *
 * NOTE the two keys. `urn` is the primary key because it is what links point at
 * and what agents pass around. But the urn embeds the workspace slug, and a slug
 * is editable — so the *stable* identity is the natural key below, and that is
 * what upserts conflict on. Renaming a workspace rewrites the urn and cascades
 * into `links`; it does not create a second row.
 */
export const entities = platformSchema.table(
  'entities',
  {
    urn: text('urn').primaryKey(),
    app: varchar('app', { length: 40 })
      .notNull()
      .references(() => apps.slug, { onDelete: 'cascade' }),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'issue' | 'task' | 'project' today. Each app owns its own vocabulary here
    // — platform deliberately does not enumerate them.
    entity_type: varchar('entity_type', { length: 40 }).notNull(),
    // The workspace #number, matching `issues.issues.seq`. Never the row id.
    number: integer('number').notNull(),
    title: text('title').notNull(),
    // Absolute where the app registered a `base_url`, app-relative otherwise.
    // Derived, like everything else here — reconciliation repairs it if the
    // app's base_url changes.
    url: text('url'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Mirrors the source row's soft delete. The row STAYS so links and history
    // still resolve; `deleted_at` is what search and activity filter on.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // The stable identity — see the note above. Upserts conflict on this.
    naturalUniq: uniqueIndex('uq_entities_natural').on(
      t.workspace_id,
      t.app,
      t.entity_type,
      t.number
    ),
    wsUpdatedIdx: index('idx_entities_ws_updated').on(t.workspace_id, t.updated_at),
    wsAppIdx: index('idx_entities_ws_app').on(t.workspace_id, t.app, t.entity_type),
  })
)

/**
 * The relation vocabulary `platform.links.rel` accepts.
 *
 * Deliberately NOT a database CHECK constraint. A future app will want a
 * relation this list does not have, and "add a value" should be a code change
 * plus a changelog line, not a platform migration every app has to sequence
 * around. The API route validates against this list and `/api/meta` serves it,
 * which also keeps it out of the guide — it is a dynamic value.
 *
 * Links are DIRECTED and no inverse row is written: `A blocks B` is one row, and
 * `bk link list B` reports it as an incoming `blocks` from A. Storing both
 * directions would create a second thing that can disagree.
 */
export const LINK_RELATIONS = [
  'blocks',
  'relates_to',
  'duplicates',
  'caused_by',
  'part_of',
  'billed_as',
] as const
export type LinkRelation = (typeof LINK_RELATIONS)[number]

/**
 * `platform.links` — typed relations between any two URNs, in any two apps.
 *
 * This is the referential integrity that a URL pasted into a description does
 * not have. Both ends are real foreign keys into `entities`:
 *
 *   ON UPDATE CASCADE — a workspace slug rename rewrites every urn, and Postgres
 *     carries the links along. This is why "a link survives a rename" is a
 *     property of the schema rather than something a code path must remember.
 *   ON DELETE CASCADE — a *purge* (the hard delete) takes its links with it. A
 *     soft delete does not: the entities row stays with `deleted_at` set, so a
 *     link to something in the recycle bin still resolves and still restores.
 */
export const links = platformSchema.table(
  'links',
  {
    from_urn: text('from_urn')
      .notNull()
      .references(() => entities.urn, { onDelete: 'cascade', onUpdate: 'cascade' }),
    to_urn: text('to_urn')
      .notNull()
      .references(() => entities.urn, { onDelete: 'cascade', onUpdate: 'cascade' }),
    rel: varchar('rel', { length: 40 }).notNull(),
    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.from_urn, t.to_urn, t.rel] }),
    // `bk link list <urn>` asks in both directions; from_urn is covered by the PK.
    toIdx: index('idx_links_to').on(t.to_urn),
    noSelf: check('links_no_self_link', sql`${t.from_urn} <> ${t.to_urn}`),
  })
)

// `workspace_counters` MOVED to the `issues` schema in migration 0040.
//
// It never belonged here. Its columns are `last_issue_seq`, `last_project_seq`,
// `last_task_seq` — one app's entity types, sitting in the schema that is
// supposed to hold only what every app shares. docs/platform-architecture.md §4.6
// used to prescribe reshaping it to `(workspace_id, app, entity_type, last_seq)`
// so apps could share it; building `apps/_scaffold` showed the better answer is
// that they should not share it at all. A counter is app data. Each app keeps
// its own, in its own schema, and no app ever has to ALTER a platform table to
// add an entity type.
//

export const workspaceInvitations = platformSchema.table(
  'workspace_invitations',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    invited_by: integer('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).default('member').notNull(),
    // NULL = an org-level invite: on accept the invitee gets whatever the
    // workspace's enabled apps grant by default. Set = invited straight into one
    // app, and accepting grants that app explicitly even under 'invite_only'.
    app: varchar('app', { length: 40 }).references(() => apps.slug, { onDelete: 'set null' }),
    token: varchar('token', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
    accepted_by: integer('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('uq_workspace_invitations_token').on(t.token),
    workspaceIdx: index('idx_workspace_invitations_ws').on(t.workspace_id),
    emailIdx: index('idx_workspace_invitations_email').on(t.email),
    statusCheck: check(
      'workspace_invitations_status_check',
      sql`${t.status} IN ('pending', 'accepted', 'revoked', 'expired', 'declined')`
    ),
  })
)

export const uploads = platformSchema.table(
  'uploads',
  {
    id: serial('id').primaryKey(),
    // Nullable: an upload whose workspace couldn't be determined is still
    // recorded (never lost) — it just won't appear under a workspace until
    // attributed. ON DELETE CASCADE: dropping a workspace clears its ledger.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // The public URL stored in content bodies / attachments — the join key for
    // reference counting. Unique so recordUpload is idempotent.
    url: text('url').notNull(),
    // Blob pathname (or local /uploads path) — kept for storage-side operations.
    pathname: text('pathname'),
    filename: varchar('filename', { length: 255 }).notNull(),
    // bigint: files are capped at 100MB today but the column shouldn't be the
    // limiting factor if that grows. NULL when the size wasn't reported.
    size: bigint('size', { mode: 'number' }),
    mime_type: varchar('mime_type', { length: 100 }),
    uploaded_by: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    // Which app wrote the file (Phase 7). Nullable for the same reason
    // `events.app` is: the migration lands before the deploy that writes it, and
    // the code running in that window does not know the column exists. NOT NULL
    // would fail every upload made in it, and a DEFAULT would hardcode one app's
    // name into a platform table. Backfilled to 'issues', written by all current
    // code, tightened in Phase 8 — expand → migrate → contract.
    //
    // ON DELETE set null, not cascade: deregistering an app must not delete the
    // ledger rows for files that still exist in the store. An unattributed row
    // is recoverable; a missing one hides bytes nobody can find again.
    //
    // NOT NULL since 0039 (Phase 8, the contract half of expand → migrate →
    // contract). The precondition was verified rather than assumed: 0 NULLs in
    // production, and `apps/issues/lib/db/queries/uploads.ts` injects the slug in
    // a wrapper whose parameter type does not accept `app` at all — so no call
    // site can omit it.
    app: varchar('app', { length: 40 })
      .notNull()
      .references(() => apps.slug, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlUniq: uniqueIndex('uq_uploads_url').on(t.url),
    workspaceIdx: index('idx_uploads_workspace').on(t.workspace_id),
    workspaceAppIdx: index('idx_uploads_workspace_app').on(t.workspace_id, t.app),
  })
)

/**
 * `platform.blob_references` — who points at which stored file, across apps.
 *
 * ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
 * Phase 7's delete gate refuses to remove a blob unless EVERY enabled app has
 * proved it holds no reference. Correct, and impossible to satisfy across
 * deployments: per-app Postgres roles (§4.3) mean the `issues` deployment can
 * never read `sales.*`, so it can never obtain that proof. The moment a second
 * row landed in `platform.apps`, blob deletion would have stopped working
 * entirely. This index is how an app proves its own references to everyone else
 * without exposing its tables.
 *
 * ── WHY POSTGRES TRIGGERS AND NOT APPLICATION WRITES ────────────────────────
 * The migration plan proposed maintaining this from application code, in the
 * same transaction as the content change — the `platform.entities` pattern from
 * Phase 6. The risk profile is NOT the same, and that is the one thing to
 * understand before touching any of this:
 *
 *   entities drift  → `bk search` shows a stale title.        Cosmetic.
 *   blob_references drift, EXTRA row   → a delete is refused.  Safe (leaks bytes).
 *   blob_references drift, MISSING row → a file still in use is DELETED. There
 *                                        is no undo behind Vercel Blob `del()`.
 *
 * So the dangerous direction is "a write path forgot to update the index", and
 * application-level maintenance makes that failure both possible and silent —
 * the next person to add a content column or a write path has to remember. They
 * will not. Triggers move the obligation from every writer to the schema: they
 * fire for every INSERT/UPDATE/DELETE regardless of which code, which ORM or
 * which psql session did it, so no write path can be forgotten. What remains
 * forgettable is adding a *new content column* without a trigger — a much
 * smaller, one-time, checklist-sized surface (docs/adding-an-app.md step 2).
 *
 * ── THE ROWS ARE NOT WRITABLE BY APPS ───────────────────────────────────────
 * App roles hold SELECT only. The trigger function is SECURITY DEFINER and owned
 * by the migrator, so the only writer is the trigger, and an app cannot forge a
 * reference for another app or delete one. See docs/sql/app-role.sql.
 *
 * ── STILL A PROJECTION, SO STILL RECONCILED ─────────────────────────────────
 * `bk super-admin blob-drift` re-derives the index from the live scanner and
 * reports the difference — the same guarantee `bk super-admin entity-drift`
 * gives the Phase 6 projection. It matters more here: it is the standing proof
 * that the trigger mechanism is actually working, run continuously by the one
 * app that also has a scanner to check it against.
 */
export const blobReferences = platformSchema.table(
  'blob_references',
  {
    // The stored file's public URL — the join key, matching `uploads.url`. No
    // FK: the ledger row can legitimately be missing (an old upload, or a URL
    // pasted between workspaces) and a reference must still count.
    url: text('url').notNull(),
    // Who holds the reference. `'platform'` for content in platform-owned
    // tables (comments), which belongs to no single app. No FK to apps.slug,
    // for that reason and because deregistering an app must not silently drop
    // its references and unblock a delete.
    app: varchar('app', { length: 40 }).notNull(),
    // The referencing row, in the app's own vocabulary — the same `type`/`id`
    // pair the scanner's `Reference` carries, so the reconciler can compare the
    // two directly. Deliberately NOT a URN: comments, project updates and
    // attachments have no #number and therefore no URN, and half the index
    // being unaddressable would make the column a trap.
    source_type: varchar('source_type', { length: 40 }).notNull(),
    source_id: bigint('source_id', { mode: 'number' }).notNull(),
    // Nullable, and never a cascade target: this column exists so the Storage
    // page can attribute a foreign app's reference to a workspace. Losing it
    // must not lose the reference.
    workspace_id: integer('workspace_id'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.app, t.source_type, t.source_id, t.url] }),
    // The delete gate's query: "is this url referenced by any of these apps?"
    urlAppIdx: index('idx_blob_references_url_app').on(t.url, t.app),
    wsIdx: index('idx_blob_references_workspace').on(t.workspace_id),
  })
)

export const labels = platformSchema.table(
  'labels',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    color: varchar('color', { length: 7 }).default('#6b7280'),
    description: text('description'),
    // Which app this label belongs to (0043, D-14).
    //
    //   set  — scoped: only that app lists, attaches, renames or deletes it.
    //   NULL — shared: every app in the workspace sees it.
    //
    // 0043 backfilled every existing row to `'issues'`, so NULL currently has no
    // instances — and that is the intended starting state, not an oversight.
    // Sharing is a deliberate act (`SET app = NULL` on one label), never a state
    // a label drifts into, and the column stays nullable to hold exactly that.
    //
    // A label read that ignores this column returns another app's labels while
    // its own command spelling (`bk <app> label list`) promises otherwise, so
    // "app IS NULL OR app = <serving app>" belongs in EVERY read — not just the
    // list route. `apps/issues/lib/db/queries/labels.ts` is the reference
    // implementation and `labels.app-scope.test.ts` enumerates the paths.
    //
    // ON DELETE set null, like `uploads.app` and `workspace_invitations.app`:
    // `issues.issue_labels` cascades from this table, so deregistering an app
    // must not take live rows' labels with it.
    app: varchar('app', { length: 40 }).references(() => apps.slug, { onDelete: 'set null' }),
    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    wsIdx: index('idx_labels_workspace').on(t.workspace_id),
    wsAppIdx: index('idx_labels_workspace_app').on(t.workspace_id, t.app),
  })
)

export const transactionLog = platformSchema.table(
  'transaction_log',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    operation_type: varchar('operation_type', { length: 20 }).notNull(),
    table_name: varchar('table_name', { length: 50 }).notNull(),
    record_id: integer('record_id').notNull(),
    old_data: jsonb('old_data'),
    new_data: jsonb('new_data'),
    rolled_back: boolean('rolled_back').default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_transaction_log_user').on(t.user_id),
    createdIdx: index('idx_transaction_log_created').on(t.created_at),
  })
)

export const apiTokens = platformSchema.table(
  'api_tokens',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    token_hash: varchar('token_hash', { length: 128 }).notNull(),
    token_prefix: varchar('token_prefix', { length: 16 }).notNull(),
    scopes: text('scopes').array().default(sql`ARRAY['full']::text[]`).notNull(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_api_tokens_user').on(t.user_id),
    prefixIdx: index('idx_api_tokens_prefix').on(t.token_prefix),
    hashUniq: uniqueIndex('uq_api_tokens_hash').on(t.token_hash),
  })
)

// password_reset_otps — short-lived one-time codes emailed to a user to verify
// email ownership before setting a new password. Used by both the logged-out
// "forgot password" flow (by email) and the in-app settings flow (session
// email). We store only a hash of the code, cap attempts, and expire fast.

export const passwordResetOtps = platformSchema.table(
  'password_reset_otps',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    otp_hash: varchar('otp_hash', { length: 128 }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailCreatedIdx: index('idx_password_reset_email_created').on(t.email, t.created_at),
  })
)

// issue_watchers — explicit list of users who get notifications for an issue.
// Reason captures *why* they're watching: manual subscription, auto on assign,
// auto on reporter. Auto-watchers are removed when their reason no longer
// applies (e.g. assignee unassigned), unless reason='manual'.

export const events = platformSchema.table(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_token_id: integer('actor_token_id').references(() => apiTokens.id, {
      onDelete: 'set null',
    }),
    // Which app produced this event (Phase 6). NULLABLE on purpose, and it is
    // expand→migrate→contract rather than timidity: the migration lands before
    // the deploy that writes the column, so for the length of that window the
    // *old* code is still inserting rows with no `app`. A NOT NULL would make
    // every one of those inserts fail; a DEFAULT 'issues' would hardcode one
    // app's name into a platform table. Migration 0035 backfills every existing
    // row and all current code sets it.
    //
    // NOT NULL since 0039 (Phase 8) — the contract step. Verified rather than
    // assumed: 0 NULLs in production across 3,630 rows, and `recordEvent` sets
    // `app: APP_SLUG` centrally rather than at the ~40 call sites, so no call
    // site can omit it.
    app: varchar('app', { length: 40 })
      .notNull()
      .references(() => apps.slug, { onDelete: 'set null' }),
    entity_type: varchar('entity_type', { length: 30 }).notNull(),
    entity_id: integer('entity_id').notNull(),
    // The cross-app address of what this event is about — the join key between
    // the activity feed and `entities`/`links`. NULL for events whose subject is
    // not a projected entity (a member added, an invitation, a label).
    //
    // No foreign key, deliberately: events are append-only history and must
    // outlive a purge of their subject. `entity_type`/`entity_id` stay as the
    // in-app coordinates; this is the same fact addressed platform-wide.
    subject_urn: text('subject_urn'),
    action: varchar('action', { length: 40 }).notNull(),
    diff: jsonb('diff'),
    meta: jsonb('meta'),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    idempotency_key: varchar('idempotency_key', { length: 80 }),
  },
  (t) => ({
    wsOccurredIdx: index('idx_events_ws_occurred').on(t.workspace_id, t.occurred_at),
    wsAppIdx: index('idx_events_ws_app').on(t.workspace_id, t.app, t.occurred_at),
    wsSubjectIdx: index('idx_events_ws_subject').on(t.workspace_id, t.subject_urn, t.occurred_at),
    wsEntityIdx: index('idx_events_ws_entity').on(
      t.workspace_id,
      t.entity_type,
      t.entity_id,
      t.occurred_at
    ),
    wsActorIdx: index('idx_events_ws_actor').on(t.workspace_id, t.actor_user_id, t.occurred_at),
    wsActionIdx: index('idx_events_ws_action').on(t.workspace_id, t.action, t.occurred_at),
    idempUniq: uniqueIndex('uq_events_idempotency').on(t.workspace_id, t.idempotency_key),
  })
)

// inbox_messages — per-user projection of events. See §1.5 of the rebuild doc.
//
// event_id is nullable because some inbox rows are synthetic (e.g. system
// announcements, pre-signup invitation materialization). workspace_id is
// nullable for cross-workspace messages but typically populated.
//
// payload carries everything needed to render the message without joining
// events — this keeps the inbox UI snappy and survives the source event being
// deleted (e.g. workspace deletion via cascade).

export const inboxMessages = platformSchema.table(
  'inbox_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event_id: integer('event_id'),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    entity_type: varchar('entity_type', { length: 30 }),
    entity_id: integer('entity_id'),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull(),
    read_at: timestamp('read_at', { withTimezone: true }),
    archived_at: timestamp('archived_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index('idx_inbox_user_created').on(t.user_id, t.created_at),
    userUnreadIdx: index('idx_inbox_user_unread').on(t.user_id, t.read_at),
    userTypeIdx: index('idx_inbox_user_type').on(t.user_id, t.type),
    userWsIdx: index('idx_inbox_user_ws').on(t.user_id, t.workspace_id),
  })
)

// Recycle bin (0022): one row per delete operation. Groups the binned items so
// restore can be batch-aware — items deleted together with their parent restore
// as a group; items deleted alone restore standalone. `mode` records whether the
// children were cascaded into the bin or detached (kept active).

export const deletionBatches = platformSchema.table(
  'deletion_batches',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    mode: varchar('mode', { length: 10 }).notNull(),
    // App-qualified `<app>:<noun>` since 0042 (D-14). 81 = apps.slug (40) + ':'
    // + entities.entity_type (40). See `comments.parent_type` below for why the
    // CHECK validates the shape rather than enumerating anyone's nouns.
    root_type: varchar('root_type', { length: 81 }).notNull(),
    root_id: integer('root_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsIdx: index('idx_deletion_batches_ws').on(t.workspace_id, t.created_at),
    modeCheck: check('deletion_batches_mode_check', sql`${t.mode} IN ('cascade', 'detach')`),
    rootTypeCheck: check(
      'deletion_batches_root_type_check',
      // The bare trio is LEGACY and goes away at the contract step.
      sql`${t.root_type} IN ('project', 'task', 'issue') OR ${t.root_type} ~ '^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$'`
    ),
  })
)

export const errorEvents = platformSchema.table(
  'error_events',
  {
    id: serial('id').primaryKey(),
    // `workspace_id` has NO foreign key, and after the app split it is not
    // self-describing either: each app keeps its OWN workspaces, so
    // `workspace_id = 1` names a different row depending on who wrote it. This
    // column is what disambiguates it, and reading one without the other is the
    // bug it exists to prevent.
    //
    // NULLABLE, and it is expand → migrate → contract rather than timidity —
    // the same sequence `events.app` and `uploads.app` went through, for the
    // same reason: the migration lands before the deploy that writes the
    // column, and for the length of that window the old code is still
    // inserting rows that do not know it exists. NOT NULL would turn every one
    // of those into a failed insert, and this table is the error log — the one
    // place where a failed write costs you the record of why something broke.
    // A DEFAULT would hardcode one app's name into a platform table.
    //
    // Migration 0044 backfills every existing row to 'issues': every row
    // predates the split and issues is the only app whose workspace ids they
    // can mean. NOT NULL is deferred to the refactor's Phase 5, once both apps
    // have been deployed writing it — see multiAppFinalRefactor/PLAN.md §4b.
    //
    // No FK to `apps.slug`, unlike `events.app` and `uploads.app`. Those tables
    // hold an app's data; this one holds the record of an app FAILING, and that
    // record must survive deregistering the app it names. `ON DELETE set null`
    // would erase the attribution of exactly the rows somebody is reading to
    // find out what went wrong.
    //
    // ALL THREE WRITERS SET IT, and none of them takes it from a call site:
    // `apiHandler`'s safeLog and `clientErrorsRoute` read `AppContext.appSlug`,
    // and `insertErrorEvent` requires it in its parameter type so an app-level
    // caller cannot omit it. See `packages/platform-db/src/error-events.ts`.
    app: varchar('app', { length: 40 }),
    workspace_id: integer('workspace_id'),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    level: varchar('level', { length: 10 }).notNull().default('error'),
    code: varchar('code', { length: 50 }),
    message: text('message').notNull(),
    stack: text('stack'),
    route: varchar('route', { length: 255 }),
    method: varchar('method', { length: 10 }),
    status_code: integer('status_code'),
    context: jsonb('context'),
    // Triage state, managed from the super-admin Errors tab.
    resolved: boolean('resolved').notNull().default(false),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    resolved_by: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    occurredIdx: index('idx_error_events_occurred').on(t.occurred_at),
    // "what has app X been throwing lately?" is the question this column was
    // added to make answerable, and it is the one the super-admin Errors tab
    // asks. Paired with occurred_at because every listing here is time-ordered.
    appOccurredIdx: index('idx_error_events_app_occurred').on(t.app, t.occurred_at),
    levelIdx: index('idx_error_events_level').on(t.level),
    codeIdx: index('idx_error_events_code').on(t.code),
    routeIdx: index('idx_error_events_route').on(t.route),
    resolvedIdx: index('idx_error_events_resolved').on(t.resolved),
  })
)

export const emailWhitelist = platformSchema.table(
  'email_whitelist',
  {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 10 }).notNull(), // 'email' | 'domain'
    value: varchar('value', { length: 255 }).notNull(),
    added_by: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    typeValueUniq: uniqueIndex('uq_email_whitelist_type_value').on(t.type, t.value),
    typeCheck: check('email_whitelist_type_check', sql`${t.type} IN ('email', 'domain')`),
  })
)

export const comments = platformSchema.table(
  'comments',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Polymorphic parent, APP-QUALIFIED since 0041 (D-14): `<app>:<noun>` —
    // 'issues:issue', 'sales:prospect'. 81 = apps.slug (40) + ':' +
    // entities.entity_type (40).
    //
    // The CHECK validates the SHAPE, never the vocabulary: `platform` does not
    // enumerate an app's nouns here any more than it does in
    // `entities.entity_type`, and an enumeration would mean a shared-table
    // migration every time any app adds one. So `'nonsense:thing'` is accepted
    // and `'prospect'` — a NEW unqualified noun, the collision D-14 exists to
    // prevent — is not. Migration 0041's header has the full reasoning,
    // including why an FK to `apps.slug` is refused.
    //
    // The three bare values are LEGACY and stay accepted for one release; reads
    // in `apps/issues` match both forms until the contract step drops them.
    parent_type: varchar('parent_type', { length: 81 }),
    parent_id: integer('parent_id'),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    mentions: integer('mentions').array(),
    parent_comment_id: integer('parent_comment_id'),
    edited_at: timestamp('edited_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    parentIdx: index('idx_comments_parent').on(t.parent_type, t.parent_id, t.created_at),
    parentCommentIdx: index('idx_comments_parent_comment').on(t.parent_comment_id),
    parentTypeCheck: check(
      'comments_parent_type_check',
      sql`${t.parent_type} IS NULL OR ${t.parent_type} IN ('issue', 'task', 'project') OR ${t.parent_type} ~ '^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$'`
    ),
  })
)

// ---- inferred row types ----

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Upload = typeof uploads.$inferSelect
export type NewUpload = typeof uploads.$inferInsert
export type Label = typeof labels.$inferSelect
export type TransactionLogEntry = typeof transactionLog.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert
export type PasswordResetOtp = typeof passwordResetOtps.$inferSelect
export type NewPasswordResetOtp = typeof passwordResetOtps.$inferInsert
export type ErrorEvent = typeof errorEvents.$inferSelect
export type NewErrorEvent = typeof errorEvents.$inferInsert
export type DeletionBatch = typeof deletionBatches.$inferSelect
export type NewDeletionBatch = typeof deletionBatches.$inferInsert
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert
export type App = typeof apps.$inferSelect
export type NewApp = typeof apps.$inferInsert
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type Entity = typeof entities.$inferSelect
export type NewEntity = typeof entities.$inferInsert
export type Link = typeof links.$inferSelect
export type NewLink = typeof links.$inferInsert
export type InboxMessage = typeof inboxMessages.$inferSelect
export type NewInboxMessage = typeof inboxMessages.$inferInsert
export type Comment = typeof comments.$inferSelect
export type EmailWhitelistEntry = typeof emailWhitelist.$inferSelect
export type NewEmailWhitelistEntry = typeof emailWhitelist.$inferInsert
