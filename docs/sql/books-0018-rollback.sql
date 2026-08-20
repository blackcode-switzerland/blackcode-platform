-- Rollback for apps/books migration 0018 — forget the statement closing balance.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0017, 0016 … down to 0001.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- The CLBD and closing date recorded for every statement imported since 0018.
-- Nothing else reads them, and no posted record depends on them, so no ledger
-- figure changes and no statement moves.
--
-- What it GIVES UP is the bank reconciliation: `bk books source show` stops
-- being able to say whether the ledger agrees with what the bank last reported,
-- and a posting to a bank account that the bank never saw becomes invisible
-- again. The values cannot be recovered by re-running anything — they came off
-- statement files that live outside this database. Re-importing the statements
-- is the only way back, and the import is idempotent on the bank's own
-- reference, so it will refuse the duplicates rather than restore the columns.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE books.source_pull
  DROP COLUMN IF EXISTS closing_balance,
  DROP COLUMN IF EXISTS closing_on;

DELETE FROM drizzle.__drizzle_migrations_books
 WHERE hash LIKE '%0018_pull_closing_balance%';

COMMIT;
