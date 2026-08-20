-- Rollback for apps/books migration 0016 — drop the year-close guards.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0015, 0014 … down to 0001.
-- Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- Nothing, and that is the point: 0016 adds only triggers. No column, no table
-- and no row is touched, so this file is safe to run at any time.
--
-- What it GIVES UP is the enforcement:
--
--   * a closed exercice becomes reopenable, and its dates editable;
--   * a closed year's opening balances become writable again;
--   * a posting line may once more name an account this book's chart does not
--     carry, which is how a POSTED entry produced a bilan reporting
--     `balanced: false` on 2026-08-19.
--
-- The application doors in `lib/db/queries/` still refuse all three with
-- worded messages. Rolling back leaves them as the only line of defence, so do
-- it only to move past 0016, not as a way to edit a filed year: the correction
-- for a closed year is a reversing entry in the current one (art. 958f CO).
\set ON_ERROR_STOP on
BEGIN;

DROP TRIGGER IF EXISTS trg_line_account_in_chart ON books.entry_line;
DROP FUNCTION IF EXISTS books.trg_line_account_in_chart();

DROP TRIGGER IF EXISTS trg_opening_frozen ON books.opening_balance;
DROP FUNCTION IF EXISTS books.trg_opening_frozen();

DROP TRIGGER IF EXISTS trg_exercice_frozen ON books.exercice;
DROP FUNCTION IF EXISTS books.trg_exercice_frozen();

DELETE FROM drizzle.__drizzle_migrations_books
 WHERE hash LIKE '%0016_year_close_guards%';

COMMIT;
