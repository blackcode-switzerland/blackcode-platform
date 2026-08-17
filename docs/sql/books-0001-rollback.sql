-- Rollback for apps/books migration 0001 (the schema). The LAST step of the
-- reverse walk: 0007, 0006, 0005, 0004, 0003, 0002, then this.
--
-- ===========================================================================
-- THE GUARDS REFUSE UNLESS 0002'S ROLLBACK RAN FIRST. HERE IS WHY.
-- ===========================================================================
-- `DROP SCHEMA books CASCADE` takes the tables and their triggers with it, but
-- it does NOT touch `platform.blob_references` — those rows have no foreign
-- key to anything, deliberately: deregistering an app must not silently drop
-- its references and unblock a delete. Dropping the schema with rows still in
-- the index would leave them orphaned forever, with no source to re-trigger
-- and no scanner to reconcile against (sales-0001-rollback.sql documents the
-- full failure mode; for books the row count SHOULD be zero always, and the
-- guard enforces rather than assumes that).
--
-- And dropping it with `maintains_blob_index` still true would leave every
-- other deployment trusting an index whose app no longer exists.
--
-- The guard is a DO block rather than a comment, because a commented-out check
-- reports success (CLAUDE.md finding #6). And the whole file is ONE
-- TRANSACTION under ON_ERROR_STOP, because sales' first rehearsal watched a
-- guard refuse in capital letters and psql carry on to drop the schema anyway,
-- one autocommitted statement later (their header; findings #7 and #15).
\set ON_ERROR_STOP on
BEGIN;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.blob_references WHERE app = 'books') THEN
    RAISE EXCEPTION
      'REFUSING: platform.blob_references still holds % row(s) for app ''books''. Run '
      'docs/sql/books-0002-rollback.sql first — dropping the schema now would orphan them '
      'permanently.',
      (SELECT count(*) FROM platform.blob_references WHERE app = 'books');
  END IF;

  IF EXISTS (SELECT 1 FROM platform.apps WHERE slug = 'books' AND maintains_blob_index) THEN
    RAISE EXCEPTION
      'REFUSING: platform.apps.maintains_blob_index is still true for ''books''. Run '
      'docs/sql/books-0002-rollback.sql first.';
  END IF;

  IF to_regclass('books.entry') IS NOT NULL THEN
    RAISE EXCEPTION
      'REFUSING: books.entry still exists, so 0003 has not been rolled back. This file removes '
      'the SCHEMA; the statutory tables have their own rollback with its own art. 958f guard, '
      'and CASCADE must not become the way around it.';
  END IF;
END
$do$;

-- Tenancy data (workspaces, members, invitations) goes with the schema. On a
-- dev database that is the point; production should never reach this file
-- outside a full app teardown.
DROP SCHEMA books CASCADE;

-- The per-app migration ledger. Dropping it whole is what makes a later
-- re-adoption clean: `drizzle-kit migrate` recreates it and replays 0001-0007
-- from the files. (Per-app ledger, never the shared one — 0001's header
-- explains why sharing it silently skips migrations.)
DROP TABLE IF EXISTS drizzle.__drizzle_migrations_books;

-- The registry row stays, DISABLED, so the slug remains claimed and `bk` says
-- "app disabled" rather than inventing addresses. Delete the row only if the
-- app is gone for good.
UPDATE platform.apps SET enabled = false WHERE slug = 'books';

COMMIT;

-- ---------------------------------------------------------------------------
-- THE ROLE, IF THE TEARDOWN IS TOTAL
-- ---------------------------------------------------------------------------
-- Separate from this file because provisioning was separate (books-app-role
-- .sql), and because a role drop is cluster-wide where everything above is one
-- database. The role owns nothing by design, so there is no REASSIGN step:
--
--   DROP OWNED BY books_app;   -- drops its PRIVILEGES everywhere, owns no objects
--   DROP ROLE books_app;
--
-- Verify after: SELECT 1 FROM pg_roles WHERE rolname = 'books_app';  -- 0 rows
--
-- Re-adopting the app later is the full order from the top:
-- books-app-role.sql → books-app-register.sql part 1 → migrate → part 2.
