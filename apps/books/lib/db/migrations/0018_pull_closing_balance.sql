-- b/books, migration 0018 — a pull remembers what the bank said it closed at.
--
-- ===========================================================================
-- THE IMPORT CHECKED THE CLOSING BALANCE AND THEN THREW IT AWAY
-- ===========================================================================
-- `verifyCamt` already refuses a statement whose OPBD + Σ(lines) does not equal
-- its CLBD to the rappen, so a damaged file cannot get in. That check is about
-- the FILE. Nothing has ever checked the file against the BOOK.
--
-- Measured 2026-08-20 on a book driven end to end from the CLI:
--
--   statement CLBD, 30 April      17'030.00
--   account 1020 in the ledger     9'965.00
--
-- Both are correct. April payroll of 7'065.00 was declared and posted, and it
-- is not on the April statement — it will land on May's. That is ordinary, and
-- so is the opposite case, which is not ordinary at all: a posting to 1020 that
-- the bank never saw, a movement resolved to the wrong account, a statement
-- imported for the wrong book. Today all of them look identical to this one,
-- because nothing compares the two numbers at any point after the import.
--
-- A bank reconciliation is the oldest control in bookkeeping and the app could
-- not perform one, because after `importCamt` returned, the only figure worth
-- reconciling against no longer existed anywhere.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS
-- ---------------------------------------------------------------------------
-- Two columns on `books.source_pull`, both NULLABLE, because every pull already
-- recorded is a pull whose statement was parsed before this migration and whose
-- balances are genuinely not known. A backfill would have to invent them.
-- `derive/reconcile.ts` reports `known: false` for those and says why, rather
-- than reporting a drift of zero — an unknown is not an agreement.
--
--   closing_balance   the CLBD the file carried, in the statement's currency
--   closing_on        the date it closed (camt `ToDtTm`), so the ledger side
--                     can be summed to the SAME instant
--
-- No trigger and no constraint: this is a record of what a document said, not a
-- rule about what is true. The comparison is derived at read time (ring 3) and
-- stored nowhere, like every other statement in this app.

ALTER TABLE books.source_pull
  ADD COLUMN IF NOT EXISTS closing_balance numeric(14,2),
  ADD COLUMN IF NOT EXISTS closing_on date;--> statement-breakpoint

COMMENT ON COLUMN books.source_pull.closing_balance IS
  'CLBD as the imported statement stated it. NULL for pulls recorded before 0018, and for pulls the import door did not make itself (`source record-pull`).';--> statement-breakpoint

COMMENT ON COLUMN books.source_pull.closing_on IS
  'The date the statement closed, so the ledger side is summed to the same instant.';
