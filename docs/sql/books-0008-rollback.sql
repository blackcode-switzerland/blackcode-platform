-- Rollback for apps/books migration 0008 — drop the sources depth and the
-- pièces pipeline.
--
-- Runs after books-0009-rollback.sql in the reverse walk, and REFUSES to run
-- before it. Next after this: books-0007-rollback.sql.
--
-- ===========================================================================
-- WHAT THIS DESTROYS, AND WHEN IT MUST NEVER RUN
-- ===========================================================================
-- `piece_inbox` and `source_pull` are RECORDS of what was received: every
-- document the worker delivered and every raw file pulled from a source. 0008
-- revoked DELETE on both from books_app because "we never received that
-- receipt" must not be makeable true by DELETE — and a rollback that drops
-- the tables would make it true wholesale. Art. 958f CO's retention duty
-- extends to what proves the books (art. 957a al. 3: the pièce requirement),
-- so against rows this file REFUSES, with no force flag. Production: restore
-- a Neon branch to the moment before 0008. Dev: `npm run db:seed` tears the
-- seeded workspace down correctly, or clear the two tables as the migrator
-- after reading what you are erasing.
--
-- `runbook` and `drive_manifest` are operational state, not records (0008's
-- own grants doctrine), and fall with the walk without a data guard — but
-- the manifest references piece_inbox, so child drops before parent below.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ri_entry_direction_check'
      AND pg_get_constraintdef(oid) LIKE '%neutral%'
  ) THEN
    RAISE EXCEPTION
      'REFUSING: 0009''s CHECK still admits ''neutral''. Run docs/sql/books-0009-rollback.sql '
      'first — the walk is 0010, 0009, then this, then 0007 … down to 0001.';
  END IF;

  SELECT (SELECT count(*) FROM books.piece_inbox) + (SELECT count(*) FROM books.source_pull) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: piece_inbox and source_pull hold % row(s) between them. They are records of '
      'what was received (0008 revoked DELETE on them for exactly this reason); dropping the '
      'tables is record destruction, not a rollback. Production: restore a Neon branch instead. '
      'Dev: npm run db:seed rebuilds, or clear the two tables consciously as the migrator.',
      n;
  END IF;
END
$do$;

-- Child before parent, RESTRICT rather than CASCADE: if anything outside this
-- file has come to depend on one of these tables, the drop must fail and say
-- so rather than quietly taking the dependant with it.
DROP TABLE IF EXISTS books.drive_manifest RESTRICT;
DROP TABLE IF EXISTS books.piece_inbox RESTRICT;
DROP TABLE IF EXISTS books.runbook RESTRICT;
DROP TABLE IF EXISTS books.source_pull RESTRICT;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- The DELETE revokes 0008 applied died with the tables; nothing to restore.
--
-- If the intent is a real rollback, remove `0008_sources_pieces` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0008 if 0010's and 0009's rows were already removed:
--
--   SELECT hash, created_at FROM drizzle.__drizzle_migrations_books
--   ORDER BY created_at DESC LIMIT 1;
--   DELETE FROM drizzle.__drizzle_migrations_books
--   WHERE hash IN (
--     SELECT hash FROM drizzle.__drizzle_migrations_books
--     ORDER BY created_at DESC LIMIT 1
--   );
--
-- If you are walking all the way down to 0001, skip the ledger bookkeeping:
-- books-0001-rollback.sql drops the whole ledger table.
