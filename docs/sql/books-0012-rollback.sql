-- Rollback for apps/books migration 0012 — remove the bank door's columns.
--
-- Rollbacks run in REVERSE: 0013's file first, THEN this one, then 0011,
-- 0010, 0009 … down to 0001. Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- `bank_ref` is each imported line's identity in the bank's own vocabulary —
-- the proof that a book row IS a statement row, and the key that lets a
-- re-imported statement converge instead of duplicating. Dropping it does not
-- delete a single entry, but it orphans every imported one: no re-import can
-- ever converge again, and the next overlapping statement DOUBLES the book.
-- So: REFUSED while any imported row exists. No force flag. Production:
-- restore a Neon branch. Dev: `npm run db:seed` rebuilds.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  -- Order guard: 0013's tables must already be gone, or the reverse walk
  -- is being run out of order.
  IF to_regclass('books.analysis') IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: books.analysis still exists. Run books-0013-rollback.sql first — rollbacks run in reverse.';
  END IF;

  SELECT (SELECT count(*) FROM books.entry    WHERE bank_ref IS NOT NULL)
       + (SELECT count(*) FROM books.ri_entry WHERE bank_ref IS NOT NULL) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % imported row(s) carry a bank_ref. Dropping the column orphans them — the '
      'next overlapping statement would double the book. Production: restore a Neon branch '
      'instead. Dev: npm run db:seed rebuilds.',
      n;
  END IF;
END
$do$;

DROP INDEX IF EXISTS books.uq_books_entry_bank_ref;
DROP INDEX IF EXISTS books.uq_books_ri_entry_bank_ref;
ALTER TABLE books.entry    DROP COLUMN IF EXISTS bank_ref;
ALTER TABLE books.ri_entry DROP COLUMN IF EXISTS bank_ref;
ALTER TABLE books.ri_entry DROP COLUMN IF EXISTS source_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- If the intent is a real rollback (not just clearing the way for an earlier
-- one), remove `0012_bank_import` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0012 if nothing was applied after it:
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
