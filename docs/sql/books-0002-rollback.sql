-- Rollback for apps/books migration 0002 (the blob-reference index).
--
-- Runs after books-0003-rollback.sql in the reverse walk, and needs 0007's to
-- have run before that: the trigger this file drops sits on `books.notes`,
-- which only exists again once books-0007-rollback.sql has restored it.
--
-- ---------------------------------------------------------------------------
-- FLAG FIRST, TRIGGER SECOND, INDEX ROWS LAST — sales-0002-rollback.sql
-- carries the full argument and the 2026-08-07 rehearsal; the order is the
-- same here and for the same reason: dropping the trigger while the flag is
-- still true leaves every other deployment trusting an index that has silently
-- stopped tracking, which is the state that ends in a deleted file. Clearing
-- the flag first makes the gate REFUSE instead, which is the safe failure.
--
-- While `books` is enabled with the flag false, blob deletion is refused
-- PLATFORM-WIDE. That is the gate working. If the rollback will take more than
-- a few minutes, run step 0 so issues and sales keep working meanwhile.
--
-- For b/books the index rows step is a formality — this app stores no uploads
-- and its index is empty by design (0002's header) — and it stays in the file
-- because a rollback that assumes emptiness instead of enforcing it converges
-- on nothing when the assumption breaks.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
BEGIN
  IF to_regclass('books.notes') IS NULL THEN
    RAISE EXCEPTION
      'REFUSING: books.notes does not exist, so 0007 has not been rolled back. The walk is '
      '0007 … 0003, then this — run docs/sql/books-0007-rollback.sql first.';
  END IF;
END
$do$;

-- 0. Optional: stop the gate consulting this app at all while you work.
-- UPDATE platform.apps SET enabled = false WHERE slug = 'books';

-- 1. The flag. Before the trigger, always.
UPDATE platform.apps SET maintains_blob_index = false WHERE slug = 'books';

-- 2. The one trigger. `platform.blob_refs_sync` itself is NOT dropped — it is
--    platform-owned (issues' 0037) and the other apps are using it.
DROP TRIGGER IF EXISTS trg_blob_refs ON books.notes;

-- 3. The index rows this app owns. Zero by design; enforced, not assumed.
DELETE FROM platform.blob_references WHERE app = 'books';

COMMIT;

-- ---------------------------------------------------------------------------
-- NOT ROLLED BACK, DELIBERATELY: the blob_refs_purge EXECUTE grants
-- ---------------------------------------------------------------------------
-- 0002's DO loop granted EXECUTE to EVERY existing `<slug>_app` role, and for
-- issues_app and sales_app that only re-asserted what their own migrations had
-- already granted. Revoking here would break blob-drift repair for the OTHER
-- apps to undo a books migration. books_app's own EXECUTE goes with the role
-- (books-0001-rollback.sql's closing note), where it belongs.
--
-- Verify — all three:
--   SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'books' AND NOT t.tgisinternal;               -- 0
--   SELECT count(*) FROM platform.blob_references WHERE app = 'books'; -- 0
--   SELECT maintains_blob_index FROM platform.apps WHERE slug='books'; -- f
--
-- Ledger bookkeeping as in books-0007-rollback.sql's closing note — or skip
-- it, since the next step (0001's rollback) drops the ledger table whole.
