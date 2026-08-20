-- Rollback for apps/books migration 0015 — remove the SHA-256 column.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0014, 0013 … down to 0001.
-- Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- A piece's sha256 is the worker's hash of the captured bytes — the strong
-- half of the evidentiary chain (receipt-002, art. 958f integrity doctrine),
-- and possibly cited on an entry as `piece_hash: sha256:…`. Dropping the
-- column while any row carries one severs proof from record. REFUSED in that
-- case; no force flag. Production: restore a Neon branch. Dev:
-- `npm run db:seed` rebuilds.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  SELECT count(*) FROM books.piece_inbox WHERE sha256 IS NOT NULL INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % piece(s) carry a sha256 — the strong half of the evidentiary chain, possibly cited '
      'by an entry''s piece_hash. Production: restore a Neon branch instead. Dev: npm run db:seed rebuilds.',
      n;
  END IF;
END
$do$;

DROP INDEX IF EXISTS books.uq_books_piece_inbox_file_checksum;
ALTER TABLE books.piece_inbox DROP COLUMN IF EXISTS sha256;
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_piece_inbox_file_checksum
  ON books.piece_inbox (workspace_id, drive_file_id, COALESCE(md5_checksum, ''));

COMMIT;
