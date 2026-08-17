-- Rollback for apps/books migration 0007 — put the scaffold placeholder back.
--
-- Rollbacks run in REVERSE: this file first, then 0006 … down to 0001. Each
-- file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHY ANYONE WOULD RESTORE A PLACEHOLDER
-- ---------------------------------------------------------------------------
-- Not to use it. `books.notes` has no route, no CLI command and no schema
-- declaration since 0007's commit removed all four together — restoring the
-- TABLE does not restore the feature, and nothing will reach it.
--
-- It exists so the reverse walk is mechanical: rolling back past 0002 means
-- dropping `trg_blob_refs`, and that trigger sits ON `books.notes`. Without
-- this file the walk hits a missing table two steps later and somebody
-- improvises DDL at exactly the moment nobody should.
--
-- Structure only: any rows `books.notes` held when 0007 dropped it are gone.
-- They were the scaffold's dev placeholder data, which is why 0007 could drop
-- the table with a plain DROP in the first place.
--
-- DDL below is copied verbatim from 0001 (the tables) and 0002 (the trigger),
-- so the restored state is the one 0006 left behind.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS books.notes (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  title         varchar(200) NOT NULL,
  body          text,
  created_by    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_ws_seq
  ON books.notes (workspace_id, seq);
CREATE INDEX IF NOT EXISTS idx_notes_ws_live
  ON books.notes (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS books.note_counters (
  workspace_id   integer PRIMARY KEY REFERENCES books.workspaces(id) ON DELETE CASCADE,
  last_note_seq  integer NOT NULL DEFAULT 0
);

-- 0002's trigger, back on the table it watches. `platform.blob_refs_sync` is
-- platform-owned (issues' 0037) and still exists; only the trigger was lost
-- with the DROP TABLE.
DROP TRIGGER IF EXISTS trg_blob_refs ON books.notes;
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON books.notes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'books', 'note', 'workspace_id', 'scan', 'body');

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
-- ---------------------------------------------------------------------------
-- If the intent is a real rollback (not just clearing the way for 0002's),
-- remove `0007_drop_notes_placeholder` from
-- `apps/books/lib/db/migrations/meta/_journal.json` and delete its ledger row —
-- READ the SELECT's result before the DELETE; it removes the LATEST recorded
-- migration, which is only 0007 if nothing was applied after it:
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
