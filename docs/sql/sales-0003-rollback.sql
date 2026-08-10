-- Rollback for apps/sales migration 0003 — this app's own foundations.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL — see 0044's rollback for what it cost
-- to learn (CLAUDE.md findings #7 and #15).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- WHEN THIS IS SAFE, AND WHEN IT STOPS BEING SAFE
-- ---------------------------------------------------------------------------
-- **Through the end of the refactor's Phase 1 this is a no-op on data.** The
-- six tables are created empty and nothing reads or writes them; PLAN.md §5
-- lists "drop the new tables — nothing referenced them" as the phase's revert
-- for exactly this reason.
--
-- **From Phase 2 onward it destroys the app.** Phase 2 points sign-up and first
-- sign-in at `sales.workspaces`; from that moment these tables hold the only
-- copy of who may use this app, and Phase 3 moves labels, uploads and activity
-- across. Running this file then is not a rollback, it is a data loss with a
-- reassuring filename.
--
-- The check that tells you which world you are in — every count must be 0:
--
--   SELECT 'workspaces' t, count(*) FROM sales.workspaces
--   UNION ALL SELECT 'workspace_members', count(*) FROM sales.workspace_members
--   UNION ALL SELECT 'invitations',       count(*) FROM sales.invitations
--   UNION ALL SELECT 'labels',            count(*) FROM sales.labels
--   UNION ALL SELECT 'uploads',           count(*) FROM sales.uploads
--   UNION ALL SELECT 'events',            count(*) FROM sales.events;
--
-- If ANY of them is non-zero, stop. Something is using these tables and this
-- file is not what you want. (PLAN.md decision 2 says sales' data may be
-- destroyed freely — that licence is about `sales.prospects` and friends under
-- a plan that expects it, not about running a DROP because a count surprised
-- you.)
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT TOUCH
-- ---------------------------------------------------------------------------
-- Migration 0001's tables (prospects, meetings, communications, …) and 0002's
-- blob-reference triggers. Their rollbacks are `sales-0001-rollback.sql` and
-- `sales-0002-rollback.sql`, and running THIS file leaves both entirely intact
-- — the schema itself is deliberately not dropped below.
--
-- Order is child-before-parent so the FKs do not have to be defeated with
-- CASCADE: everything below references `sales.workspaces`, so it goes last.
-- `RESTRICT` rather than `CASCADE` on purpose — if something outside this file
-- has come to depend on one of these tables, the drop must fail and say so
-- rather than quietly taking the dependant with it.

DROP TABLE IF EXISTS sales.events RESTRICT;
DROP TABLE IF EXISTS sales.uploads RESTRICT;
DROP TABLE IF EXISTS sales.labels RESTRICT;
DROP TABLE IF EXISTS sales.invitations RESTRICT;
DROP TABLE IF EXISTS sales.workspace_members RESTRICT;
DROP TABLE IF EXISTS sales.workspaces RESTRICT;

-- The schema is NOT dropped: migration 0001's seventeen tables live in it.

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- Remove the `0003_sales_own_foundations` entry from
-- `apps/sales/lib/db/migrations/meta/_journal.json` and delete the matching row
-- from `drizzle.__drizzle_migrations_sales`, or the next `drizzle-kit migrate`
-- believes 0003 has already been applied and the tables never come back:
--
--   DELETE FROM drizzle.__drizzle_migrations_sales
--   WHERE hash IN (
--     SELECT hash FROM drizzle.__drizzle_migrations_sales ORDER BY created_at DESC LIMIT 1
--   );
--
-- Read that DELETE before running it — it removes the LATEST recorded
-- migration, which is only 0003 if nothing has been applied since.
