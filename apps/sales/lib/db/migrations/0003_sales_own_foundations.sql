-- b/sales, migration 0003 — this app's own workspaces, membership, invitations,
-- labels, upload ledger and activity.
--
-- The multi-app refactor's Phase 1 (docs/2026-08-multi-app-refactor.md §5).
--
-- ===========================================================================
-- ADDITIVE, AND NOTHING READS THESE TABLES WHEN THIS LANDS
-- ===========================================================================
-- Every table below is created empty and no code path touches it. That is the
-- point of the phase, not an unfinished state: the migration that decides the
-- SHAPES cannot break either app, so it is the cheap place to get them wrong.
-- Phase 2 bootstraps sign-up onto them and Phase 3 moves the query layer over
-- one table at a time. Until then `apps/sales` keeps using `platform.*` exactly
-- as it does today.
--
-- It touches NOTHING outside the `sales` schema — no `platform` table, no
-- `issues` table, no trigger, no row. `platform.error_events` gains its `app`
-- column in the SAME phase but from the issues ledger, where every other
-- `platform` migration lives (`apps/issues/.../0044_error_events_app.sql`).
--
-- ===========================================================================
-- WHAT IS NOT HERE
-- ===========================================================================
-- **No `sales.comments`.** D-13: this app has no platform comments and never
-- had one. `communications` with `channel = 'note'` is its equivalent and
-- migration 0001 already created it. The plan asked for one from a file-count
-- survey that counted the WORD "comments"; a grep for the TABLE finds zero call
-- sites in this app.
--
-- **No `sales.deletion_batches`.** This app's bin is `deleted_at` plus a
-- cascade stamping one instant (`lib/db/queries/trash.ts`), and the trash route
-- deliberately answers `batch_id` as ABSENT rather than inventing one. The plan
-- itself measured zero files touching it.
--
-- **No `app` column anywhere below.** The platform copies carry one because
-- they are shared. Here the schema name is the answer.
--
-- **No `sales.users`.** Identity stays shared; every `*_id` below is a
-- cross-schema FK into `platform.users` (and `platform.api_tokens` for the
-- event actor). Those FKs are the boundary this refactor keeps, not a breach of
-- it.
--
-- ===========================================================================
-- GRANTS — READ THIS BEFORE ASSUMING IT IS HANDLED
-- ===========================================================================
-- `sales_app` gets DML on these tables with NO re-grant, because
-- `docs/sql/sales-app-role.sql` step 5 ran `ALTER DEFAULT PRIVILEGES IN SCHEMA
-- platform, sales` **as the migrator**, and the migrator is what creates the
-- tables below. That is a claim about a script that was run by hand once, so it
-- was not assumed: a bounded probe role was created locally with exactly that
-- provisioning, this migration was applied, and the role's DML on all six new
-- tables and their sequences was confirmed without any further GRANT. See
-- ~/Documents/BAK/blackcode-platform-backups/multiAppFinalRefactor-correspondence/agent2/agent-2026-08-10-1.txt §4.
--
-- If `ALTER DEFAULT PRIVILEGES` was ever skipped in an environment, the failure
-- is `permission denied for table workspaces` at runtime in Phase 2, not here —
-- this migration runs as the migrator and will succeed regardless.
--
-- Re-runnable: every CREATE is IF NOT EXISTS.
-- Rollback: docs/sql/sales-0003-rollback.sql.

CREATE SCHEMA IF NOT EXISTS sales;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspaces — this app's tenancy root
-- ---------------------------------------------------------------------------
-- No `logo_url` (no workspace chrome to put one in), no `storage_limit_bytes`
-- (never enforced, and a quota over one shared Blob store is not a per-app
-- fact), no `deleted_at` (no writer in either app — carrying an unwritten
-- column forward is how it acquires two meanings).
CREATE TABLE IF NOT EXISTS sales.workspaces (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  slug        varchar(40) NOT NULL,
  owner_id    integer NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_workspaces_slug
  ON sales.workspaces (slug);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_workspaces_owner
  ON sales.workspaces (owner_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.workspace_members (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_workspace_members_role_check CHECK (role IN ('owner', 'member'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_workspace_members_ws_user
  ON sales.workspace_members (workspace_id, user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_workspace_members_user
  ON sales.workspace_members (user_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
-- Named short: the schema already says which app, and there is one kind of
-- invitation here. No `app` column — that one selects an app WITHIN a shared
-- workspace, under gates Phase 5 deletes.
--
-- `status` omits 'declined': nothing has ever written it, and an accepted value
-- is a promise that some code path produces it.
CREATE TABLE IF NOT EXISTS sales.invitations (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  email         varchar(255) NOT NULL,
  invited_by    integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  token         varchar(64) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invitations_token
  ON sales.invitations (token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_invitations_ws
  ON sales.invitations (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_invitations_email
  ON sales.invitations (email);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- labels
-- ---------------------------------------------------------------------------
-- No `app`, and therefore no `app IS NULL OR app = 'sales'` predicate to port.
-- That predicate is D-14's workaround for one table serving two apps; here
-- every row is this app's, so the correct scope is the absence of one.
--
-- `workspace_id` is NOT NULL where the platform column is nullable — that
-- nullability is a backfill artefact on a table with live rows.
CREATE TABLE IF NOT EXISTS sales.labels (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  name          varchar(50) NOT NULL,
  color         varchar(7) DEFAULT '#8a8578',  -- lib/pipeline.ts DEFAULT_LABEL_COLOR; held by lib/db/label-default-color.test.ts
  description   text,
  created_by    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sales_labels_workspace
  ON sales.labels (workspace_id);--> statement-breakpoint
-- Not in the platform table, which lets a workspace hold two labels called
-- "Enterprise" and leaves `bk sales label attach enterprise` with no defensible
-- answer. New table, so this costs nothing to get right now.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_labels_ws_name
  ON sales.labels (workspace_id, name);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- uploads — the LEDGER, not the storage
-- ---------------------------------------------------------------------------
-- One Vercel Blob store, one bill, one quota, unchanged. What splits is the
-- record of which of this app's files exist. `platform.blob_references` — the
-- cross-app delete gate — is untouched and stays shared.
--
-- `url` is not in the plan's column list and has to be here: it is the join key
-- the ledger is addressed by, and its UNIQUE index is the only reason
-- `recordUpload` is idempotent. Without it a repeated blob callback writes a
-- second row.
--
-- `workspace_id` stays NULLABLE, unlike labels above: an upload whose workspace
-- could not be determined is still RECORDED rather than lost. An unattributed
-- ledger row is recoverable; a missing one hides bytes nobody can find again.
CREATE TABLE IF NOT EXISTS sales.uploads (
  id            serial PRIMARY KEY,
  workspace_id  integer REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  url           text NOT NULL,
  pathname      text,
  filename      varchar(255) NOT NULL,
  size          bigint,
  mime_type     varchar(100),
  uploaded_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_uploads_url
  ON sales.uploads (url);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_uploads_workspace
  ON sales.uploads (workspace_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- events — the activity spine
-- ---------------------------------------------------------------------------
-- No `app`. `subject_urn` IS kept and is flagged for Phase 3 rather than
-- decided here: it backs `?subject_urn=` / `bk activity --subject`, and a sales
-- URN is derivable from `sales.*` alone — `platform.entities` is how it is
-- looked up, not what makes it true. Dropping an unused column from an empty
-- table is free; adding one back to a populated table is not.
--
-- No FK on `subject_urn`, for the platform table's reason: events are
-- append-only history and must outlive a purge of their subject.
CREATE TABLE IF NOT EXISTS sales.events (
  id               bigserial PRIMARY KEY,
  workspace_id     integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  actor_user_id    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  actor_token_id   integer REFERENCES platform.api_tokens(id) ON DELETE SET NULL,
  entity_type      varchar(30) NOT NULL,
  entity_id        integer NOT NULL,
  subject_urn      text,
  action           varchar(40) NOT NULL,
  diff             jsonb,
  meta             jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  idempotency_key  varchar(80)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sales_events_ws_occurred
  ON sales.events (workspace_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_events_ws_subject
  ON sales.events (workspace_id, subject_urn, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_events_ws_entity
  ON sales.events (workspace_id, entity_type, entity_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_events_ws_actor
  ON sales.events (workspace_id, actor_user_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_events_ws_action
  ON sales.events (workspace_id, action, occurred_at);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_events_idempotency
  ON sales.events (workspace_id, idempotency_key);
