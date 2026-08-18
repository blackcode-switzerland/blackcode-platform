-- Rollback for apps/books migration 0010 — remove the RI half of the match.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0009, 0008, 0007 … down to
-- 0001. Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- `matched_ri_entry_id` records which recettes-dépenses entry a delivered
-- document proves. Dropping the column erases that interpretation for every
-- matched piece at once — the pieces stay (they are records; 0008 revoked
-- DELETE on them for a reason), but each one forgets what it documented, and
-- the RI entries keep piece_* references that nothing then explains.
--
-- So: REFUSED while any piece is matched to an RI entry. There is no force
-- flag, deliberately. Production: restore a Neon branch to the moment before
-- 0010. Dev: `npm run db:seed` rebuilds the seeded workspace, or null the
-- column consciously as the migrator after reading what you are erasing.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM books.piece_inbox WHERE matched_ri_entry_id IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % piece(s) are matched to RI entries. Dropping matched_ri_entry_id erases '
      'which entry each document proves. Production: restore a Neon branch instead. Dev: '
      'npm run db:seed rebuilds, or null the column consciously first.',
      n;
  END IF;
END
$do$;

ALTER TABLE books.piece_inbox DROP CONSTRAINT IF EXISTS piece_inbox_one_journal_check;
ALTER TABLE books.piece_inbox DROP COLUMN IF EXISTS matched_ri_entry_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- If the intent is a real rollback (not just clearing the way for an earlier
-- one), remove `0010_piece_ri_match` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0010 if nothing was applied after it:
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
