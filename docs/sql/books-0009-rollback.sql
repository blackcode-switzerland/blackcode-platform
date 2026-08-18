-- Rollback for apps/books migration 0009 — direction loses `neutral`.
--
-- Runs after books-0010-rollback.sql in the reverse walk, and REFUSES to run
-- before it. Next after this: books-0008-rollback.sql.
--
-- ---------------------------------------------------------------------------
-- WHY THIS REFUSES ON DATA
-- ---------------------------------------------------------------------------
-- 0009 admitted `direction = 'neutral'` (Andrea's own-account-transfer rule,
-- ticket #59). Restoring the two-value CHECK against a book that already
-- holds a neutral row cannot succeed — and "fixing" that by rewriting the
-- rows into recette or dépense would falsify a statement, which is the exact
-- misstatement the rule exists to prevent. An RI entry is a record (art. 958f
-- CO analogy; the 0004-family triggers forbid hard deletes for the same
-- reason), so there is no force flag: production restores a Neon branch; dev
-- rebuilds with `npm run db:seed`.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'books' AND table_name = 'piece_inbox'
      AND column_name = 'matched_ri_entry_id'
  ) THEN
    RAISE EXCEPTION
      'REFUSING: 0010''s column still exists. Run docs/sql/books-0010-rollback.sql first — '
      'the walk is 0010, then this, then 0008 … down to 0001.';
  END IF;

  SELECT count(*) INTO n FROM books.ri_entry WHERE direction = 'neutral';
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: books.ri_entry holds % neutral row(s). Restoring the two-value CHECK would '
      'fail on them, and rewriting a logged transfer into a recette or a dépense misstates the '
      'book. Production: restore a Neon branch instead. Dev: npm run db:seed rebuilds.',
      n;
  END IF;
END
$do$;

ALTER TABLE books.ri_entry DROP CONSTRAINT IF EXISTS ri_entry_direction_check;
ALTER TABLE books.ri_entry ADD CONSTRAINT ri_entry_direction_check
  CHECK (direction IN ('recette', 'depense'));

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- If the intent is a real rollback, remove `0009_ri_neutral_direction` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0009 if 0010's row was already removed:
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
