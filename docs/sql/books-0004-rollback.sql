-- Rollback for apps/books migration 0004 — remove the statutory guards.
--
-- Runs after books-0005-rollback.sql in the reverse walk.
--
-- ===========================================================================
-- READ THIS TWICE. AFTER THIS FILE, THE DATABASE BELIEVES ANYTHING.
-- ===========================================================================
-- 0004 is where the accounting rules live AS DATABASE OBJECTS: posted entries
-- balance, posted lines are frozen, nothing hard-deletes, a capital company
-- cannot keep simplified books, input VAT needs full evidence. The app checks
-- NONE of this in TypeScript, on purpose — Postgres is the one place this
-- app's two front doors, the CLI and every agent's bearer token all meet
-- (0004's header).
--
-- So after this file runs there is NO layer left that refuses an unbalanced
-- posted entry, an un-posting, a hard delete of the ledger, or a simplified
-- SA. **Do not leave the app serving requests against this state.** This is a
-- teardown step or an emergency measure taken with the app stopped, never a
-- live configuration.
--
-- (0005's DELETE revoke survives if it has not been rolled back yet — but the
-- reverse walk runs 0005's first, so assume nothing is left.)
--
-- Order inside the file: triggers, then functions, then constraints. A
-- function cannot be dropped while a trigger references it.
\set ON_ERROR_STOP on
BEGIN;

-- The six triggers.
DROP TRIGGER IF EXISTS trg_entry_balanced      ON books.entry;
DROP TRIGGER IF EXISTS trg_entry_line_balanced ON books.entry_line;
DROP TRIGGER IF EXISTS trg_entry_frozen        ON books.entry;
DROP TRIGGER IF EXISTS trg_entry_line_frozen   ON books.entry_line;
DROP TRIGGER IF EXISTS trg_no_hard_delete      ON books.entry;
DROP TRIGGER IF EXISTS trg_no_hard_delete      ON books.ri_entry;

-- The six functions behind them.
DROP FUNCTION IF EXISTS books.trg_entry_balanced();
DROP FUNCTION IF EXISTS books.trg_entry_line_balanced();
DROP FUNCTION IF EXISTS books.trg_entry_frozen();
DROP FUNCTION IF EXISTS books.trg_entry_line_frozen();
DROP FUNCTION IF EXISTS books.trg_no_hard_delete();
DROP FUNCTION IF EXISTS books.assert_entry_balanced(integer);

-- The eight constraints.
ALTER TABLE books.entity   DROP CONSTRAINT IF EXISTS chk_books_entity_capital_company_double_entry;
ALTER TABLE books.entity   DROP CONSTRAINT IF EXISTS chk_books_entity_regime;
ALTER TABLE books.entry    DROP CONSTRAINT IF EXISTS chk_books_entry_status;
ALTER TABLE books.entry    DROP CONSTRAINT IF EXISTS chk_books_entry_recognition;
ALTER TABLE books.entry    DROP CONSTRAINT IF EXISTS chk_books_entry_evidence_tier;
ALTER TABLE books.entry    DROP CONSTRAINT IF EXISTS chk_books_entry_input_vat_needs_full_evidence;
ALTER TABLE books.ri_entry DROP CONSTRAINT IF EXISTS chk_books_ri_entry_recognition;
ALTER TABLE books.ri_entry DROP CONSTRAINT IF EXISTS chk_books_ri_entry_evidence_tier;

COMMIT;

-- Verify — both must return 0:
--   SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'books' AND NOT t.tgisinternal
--      AND t.tgname LIKE 'trg_%';
--   SELECT count(*) FROM pg_constraint
--    WHERE conname LIKE 'chk_books_%';
--
-- To re-apply the guards WITHOUT a full re-migrate: 0004 is written to be
-- replayable (every CREATE is OR REPLACE, every trigger drop-then-create) —
-- but the constraints will only re-add if the data still satisfies them, which
-- after any time in the unguarded state is exactly what you cannot assume.
-- Check before replaying:
--   SELECT id FROM books.entry e WHERE status = 'posted' AND (
--     SELECT count(*) FROM books.entry_line l WHERE l.entry_id = e.id
--   ) < 2;                                           -- and the balance query
--
-- Ledger bookkeeping as in books-0007-rollback.sql's closing note.
