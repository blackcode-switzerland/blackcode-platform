-- platform.error_events gains `app` — the EXPAND half of expand → migrate →
-- contract. Written for the multi-app refactor's Phase 1
-- (multiAppFinalRefactor/PLAN.md §4b).
--
-- ---------------------------------------------------------------------------
-- WHY THIS LIVES IN THE ISSUES LEDGER AND NOT THE SALES ONE
-- ---------------------------------------------------------------------------
-- `platform.*` is migrated from `apps/issues` and always has been — 0037's
-- blob-reference machinery, 0041's comments CHECK, 0043's label scope. A second
-- app INSTALLS things into platform (0002's triggers); it does not ALTER a
-- platform table, because two ledgers with independent high-water marks
-- (`drizzle.__drizzle_migrations` vs `__drizzle_migrations_sales`) give no
-- ordering between them, and "which app's migration ran first" is not a
-- question a shared column should depend on.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN
-- ---------------------------------------------------------------------------
-- `error_events.workspace_id` has no foreign key and never has. That was fine
-- while there was ONE set of workspaces. The refactor gives sales its own, and
-- from that point `workspace_id = 1` names a different row depending on which
-- deployment wrote it — so every error row becomes ambiguous, and the
-- super-admin Errors tab reports a confidently wrong workspace rather than
-- failing. This column is what disambiguates it.
--
-- ---------------------------------------------------------------------------
-- WHY THE BACKFILL IS 'issues' AND NOT NULL
-- ---------------------------------------------------------------------------
-- Every existing row predates the split, and issues is the only app whose
-- workspace ids they can mean — `sales` has never had a workspace of its own.
-- Leaving them NULL would make "written before the column existed" and "written
-- by an app that forgot to set it" indistinguishable, and the second is exactly
-- what the Phase 5 NOT NULL is there to catch.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `SET NOT NULL` HERE
-- ---------------------------------------------------------------------------
-- The migration lands before the deploy that writes the column. For the length
-- of that window the running production code inserts rows with no `app`, and a
-- NOT NULL turns each of them into a failed insert — in the error log, which is
-- the one table where a failed write costs you the record of why something
-- broke. A DEFAULT would hardcode one app's name into a platform table.
-- Phase 5 contracts this, after both apps have deployed writing it.
--
-- ---------------------------------------------------------------------------
-- SAFE AGAINST A RUNNING DEPLOYMENT
-- ---------------------------------------------------------------------------
-- Additive: no existing reader selects a column that did not exist, and both
-- readers (`listPublicErrorEvents`, `listAdminErrorEvents`) project an explicit
-- column list rather than `SELECT *`. The ALTER takes ACCESS EXCLUSIVE but a
-- nullable column with no default is a catalog-only change in PostgreSQL 11+ —
-- no table rewrite, so the lock is held for microseconds, not for a scan of the
-- table. The UPDATE that follows DOES rewrite every row and takes ROW EXCLUSIVE;
-- it is a small table (hundreds of rows, not millions) and it blocks no reader.
--
-- Re-runnable: IF NOT EXISTS, and the backfill is `WHERE app IS NULL`, which
-- converges. Re-running it after the deploy is a no-op rather than a
-- reattribution of sales' rows to issues — that `WHERE` is load-bearing, not
-- decoration.
--
-- Rollback: docs/sql/0044-error-events-app-rollback.sql.

ALTER TABLE platform.error_events
  ADD COLUMN IF NOT EXISTS app varchar(40);--> statement-breakpoint

-- Only rows that have none. See above: this is what makes the migration
-- re-runnable without relabelling another app's rows.
UPDATE platform.error_events SET app = 'issues' WHERE app IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_error_events_app_occurred
  ON platform.error_events (app, occurred_at);
