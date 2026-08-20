-- Rollback for apps/books migration 0011 — drop the FX vocabulary.
--
-- Runs after books-0012-rollback.sql in the reverse walk, and REFUSES to run
-- before it. Next after this: books-0010-rollback.sql.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- `fx` is display-only (nothing computes with it), but it is still EVIDENCE:
-- "this 4.47 was USD 5.00 at the issuer's rate" is the kind of annotation a
-- fiduciaire writes in the margin of a paper book, and dropping the column
-- erases every margin at once. So: REFUSED while any row carries a story.
-- No force flag. Production: restore a Neon branch. Dev: `npm run db:seed`
-- rebuilds, or null the columns consciously as the migrator first.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'books' AND table_name = 'entry' AND column_name = 'bank_ref'
  ) THEN
    RAISE EXCEPTION
      'REFUSING: 0012''s columns still exist. Run docs/sql/books-0012-rollback.sql first — '
      'the walk is 0012, then this, then 0010 … down to 0001.';
  END IF;

  SELECT (SELECT count(*) FROM books.entry WHERE fx IS NOT NULL)
       + (SELECT count(*) FROM books.ri_entry WHERE fx IS NOT NULL) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % entry row(s) carry an fx story. It is evidence of the original currency; '
      'dropping the column erases it. Production: restore a Neon branch instead. Dev: '
      'npm run db:seed rebuilds, or null the fx columns consciously first.',
      n;
  END IF;
END
$do$;

ALTER TABLE books.entry DROP COLUMN IF EXISTS fx;
ALTER TABLE books.ri_entry DROP COLUMN IF EXISTS fx;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- If the intent is a real rollback (not just clearing the way for an earlier
-- one), remove `0011_fx_vocabulary` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0011 if nothing was applied after it:
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
