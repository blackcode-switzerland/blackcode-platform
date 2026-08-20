-- Rollback for apps/books migration 0003 — drop the statutory core.
--
-- Runs after books-0004-rollback.sql in the reverse walk, and REFUSES to run
-- before it.
--
-- ===========================================================================
-- WHAT THIS DESTROYS, AND WHEN IT MUST NEVER RUN
-- ===========================================================================
-- These twelve tables ARE the books: every entity, exercice, account, opening
-- balance, entry and line. Art. 958f CO puts a TEN-YEAR retention duty on
-- accounting records. Against a database holding real posted entries, this
-- file is not a rollback — it is the destruction of statutory records with a
-- reassuring filename, and the guard below refuses it outright.
--
-- There is deliberately NO force flag. If production is truly in a state where
-- the statutory schema must go, the tool is a Neon branch restore to the
-- moment before 0003, which preserves the history this file would erase. On a
-- dev database, clear the data first — `npm run db:seed:books` tears down the
-- seeded workspace correctly, or remove the workspaces as the migrator with
-- the 0004 triggers disabled (the seed's teardown shows the order).
--
-- The 0004 guard: its triggers sit on these tables and its functions would
-- survive a bare DROP TABLE, leaving orphaned functions behind — and a walk
-- that skipped a step should stop, not adapt.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  IF to_regprocedure('books.assert_entry_balanced(integer)') IS NOT NULL THEN
    RAISE EXCEPTION
      'REFUSING: 0004''s objects still exist. Run docs/sql/books-0004-rollback.sql first — '
      'the walk is 0007, 0006, 0005, 0004, then this.';
  END IF;

  SELECT count(*) INTO n FROM books.entry WHERE status = 'posted';
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: books.entry holds % posted row(s). Posted entries are statutory records under '
      'art. 958f CO (ten-year retention); dropping the schema that holds them is record '
      'destruction, not a rollback. Production: restore a Neon branch instead. Dev: clear the '
      'workspaces first (npm run db:seed:books rebuilds; its teardown shows the trigger order).',
      n;
  END IF;
END
$do$;

-- Child before parent, RESTRICT rather than CASCADE throughout: if anything
-- outside this file has come to depend on one of these tables, the drop must
-- fail and say so rather than quietly taking the dependant with it.
DROP TABLE IF EXISTS books.entry_line RESTRICT;
DROP TABLE IF EXISTS books.entry RESTRICT;
DROP TABLE IF EXISTS books.ri_entry RESTRICT;
DROP TABLE IF EXISTS books.patrimoine RESTRICT;
DROP TABLE IF EXISTS books.rule RESTRICT;
DROP TABLE IF EXISTS books.source RESTRICT;
DROP TABLE IF EXISTS books.opening_balance RESTRICT;
DROP TABLE IF EXISTS books.account RESTRICT;
DROP TABLE IF EXISTS books.exercice RESTRICT;
DROP TABLE IF EXISTS books.entity RESTRICT;
DROP TABLE IF EXISTS books.counters RESTRICT;
DROP TABLE IF EXISTS books.statement_position RESTRICT;

COMMIT;

-- The schema and the tenancy tables (workspaces, members, invitations) are
-- 0001's and stay. The placeholder tables are 0007's business, restored by ITS
-- rollback if the walk came through it.
--
-- Verify — exactly the tenancy tables (plus notes/note_counters if 0007 was
-- rolled back) remain:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'books' ORDER BY table_name;
--
-- Ledger bookkeeping as in books-0007-rollback.sql's closing note.
