-- Rollback for apps/issues migration 0045 — the two per-app access gates and
-- `platform.transaction_log`.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL.
-- ---------------------------------------------------------------------------
-- Without it `psql` prints an error per failed statement and STILL EXITS 0, so a
-- rollback that did nothing reports success — CLAUDE.md findings #7 and #15, the
-- second of which was a provisioning script in this very directory.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- READ THIS FIRST: IT RESTORES THE STRUCTURE. IT CANNOT RESTORE THE ROWS.
-- ---------------------------------------------------------------------------
-- `DROP TABLE` takes the data with it. This file recreates three EMPTY tables
-- with their original constraints, and that is all it can do from inside the
-- database. Production held 20 `workspace_apps` rows and 49 `app_access` rows
-- at the time of the drop.
--
-- **If you need the data back, restore the pre-phase-5 Neon branch instead.**
-- SAFETY.md requires one taken immediately before this phase, for exactly this.
-- Running this script first does not prevent that, but it is not a substitute
-- for it, and an empty `app_access` is NOT a neutral state for the code that
-- used to read it — it is "nobody may open any app", which renders as an empty
-- workspace list rather than as an error. That failure mode is why 0034 put its
-- DDL and its backfill in one file.
--
-- ---------------------------------------------------------------------------
-- WHICH EMERGENCY ARE YOU IN?
-- ---------------------------------------------------------------------------
--   * **The DEPLOY is bad, the migration is fine** — the usual case. Roll the
--     Vercel deployment back and run NOTHING here. Every reader of these tables
--     was removed in the same release; nothing that predates it is running.
--
--   * **You are reverting the Phase 5 CODE** (restoring `requireAppAccess` and
--     the `/api/workspaces/{ws}/apps` routes) — run step 1, then restore the
--     branch or re-run 0034's backfill. The code refuses everybody against
--     empty tables, so structure alone is not enough.
--
--   * **You want `transaction_log` back** — step 2. Note that nothing has
--     written this table since before the monorepo and `/api/undo` is a 410, so
--     the only reason to recreate it is to satisfy a tool that expects it.

-- ===========================================================================
-- STEP 1 — the two access gates.
-- ===========================================================================
-- Column definitions, FKs and constraints copied from migration 0034. The
-- composite FK on `app_access` is the load-bearing one: it makes
-- access-without-membership unrepresentable and removes a member's access by
-- cascade rather than by remembering to.

CREATE TABLE IF NOT EXISTS platform.workspace_apps (
  workspace_id   integer     NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  app            varchar(40) NOT NULL REFERENCES platform.apps(slug) ON DELETE CASCADE,
  enabled_at     timestamptz NOT NULL DEFAULT now(),
  enabled_by     integer     REFERENCES platform.users(id) ON DELETE SET NULL,
  default_access varchar(20) NOT NULL DEFAULT 'all_members',
  PRIMARY KEY (workspace_id, app),
  CONSTRAINT workspace_apps_default_access_check
    CHECK (default_access IN ('all_members', 'invite_only'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_apps_app ON platform.workspace_apps (app);

CREATE TABLE IF NOT EXISTS platform.app_access (
  workspace_id integer     NOT NULL,
  app          varchar(40) NOT NULL REFERENCES platform.apps(slug) ON DELETE CASCADE,
  user_id      integer     NOT NULL,
  role         varchar(20) NOT NULL DEFAULT 'member',
  granted_at   timestamptz NOT NULL DEFAULT now(),
  granted_by   integer     REFERENCES platform.users(id) ON DELETE SET NULL,
  PRIMARY KEY (workspace_id, app, user_id),
  CONSTRAINT app_access_role_check CHECK (role IN ('owner', 'member')),
  CONSTRAINT app_access_membership_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES platform.workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_access_user_app ON platform.app_access (user_id, app);

-- ===========================================================================
-- STEP 2 — transaction_log. COMMENTED OUT.
-- ===========================================================================
-- Not because it is dangerous — an empty table with no reader is harmless — but
-- because recreating it is almost never what you want, and a table that exists
-- with no writer is the shape somebody later mistakes for a feature. That is the
-- same argument PLAN.md §4b makes for `deletion_batches` in `apps/sales`.
--
-- Uncomment only if a tool outside this repo expects the table to exist.
--
-- Transcribed from `\d platform.transaction_log` against a live database on
-- 2026-08-10, NOT from memory of the original migration. The first draft of this
-- block was written from the plausible shape (`operation`, `entity_type`,
-- `entity_id`, `payload`) and every one of those names was wrong — which is the
-- argument for reading the catalog rather than the repo, one more time.
--
-- CREATE TABLE IF NOT EXISTS platform.transaction_log (
--   id             serial      PRIMARY KEY,
--   user_id        integer     REFERENCES platform.users(id) ON DELETE SET NULL,
--   operation_type varchar(20) NOT NULL,
--   table_name     varchar(50) NOT NULL,
--   record_id      integer     NOT NULL,
--   old_data       jsonb,
--   new_data       jsonb,
--   rolled_back    boolean     DEFAULT false,
--   created_at     timestamptz DEFAULT now()
-- );
-- CREATE INDEX IF NOT EXISTS idx_transaction_log_created ON platform.transaction_log (created_at);
-- CREATE INDEX IF NOT EXISTS idx_transaction_log_user    ON platform.transaction_log (user_id);
