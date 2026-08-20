-- Rollback for apps/books migration 0019 — forget how to read delimited files.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0018, 0017 … down to 0001.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- Every column mapping established for a delimited feed. Each one was written
-- by a human reading a real export from that issuer, and cannot be recovered by
-- re-running anything — only by fetching another export and reading it again.
-- Export them first if you may want them back:
--
--   SELECT seq, name, import_mapping FROM books.source
--    WHERE import_mapping IS NOT NULL;
--
-- No ledger figure changes: a mapping describes a FILE, never a booking. Rows
-- already imported through one keep their entries, their references and their
-- pulls. What is lost is the ability to import the NEXT file from that source
-- without re-establishing how to read it.
--
-- `draws_from` values are untouched — the column predates this migration and
-- only its index is dropped.
\set ON_ERROR_STOP on
BEGIN;

DROP INDEX IF EXISTS books.idx_books_source_draws_from;

ALTER TABLE books.source DROP COLUMN IF EXISTS import_mapping;

DELETE FROM drizzle.__drizzle_migrations_books
 WHERE hash LIKE '%0019_source_import_mapping%';

COMMIT;
