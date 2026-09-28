-- 0022 — the openings door can do what it says: replace the whole set.
--
-- blackcode-issues #100. `bk books opening set` returned 500 for EVERY payload,
-- including a balanced first set on a book's first year with nothing to replace.
-- Two defects, the second hidden behind the first:
--
--   1. `setOpenings` (lib/db/queries/openings.ts) replaces a year's set with
--      DELETE-then-INSERT in one transaction. 0005 revoked DELETE on
--      `books.opening_balance` from `books_app`, and Postgres checks the
--      privilege before it looks for rows — so the statement was refused with
--      42501 even when it would have matched nothing. Every test ran as a role
--      that still held DELETE, which is why none saw it.
--
--   2. `books.trg_opening_frozen()` (0016) fires BEFORE INSERT OR UPDATE OR
--      DELETE and ended `RETURN NEW`. On DELETE, NEW is NULL, and a BEFORE row
--      trigger returning NULL SILENTLY SKIPS the row. So once the grant existed,
--      replacing a set would have kept the old rows and then failed on the
--      unique key at the insert. `trg_entry_line_frozen` (0004) has the same
--      shape and already returns COALESCE(NEW, OLD); the other `*_frozen`
--      triggers fire on UPDATE only, where NEW is never NULL.
--
-- ── WHY THE GRANT, AND NOT A setOpenings WITHOUT DELETE ────────────────────
-- 0005's revoke was "no hard delete" doctrine, and for entries, lines, RI
-- entries and the chart that doctrine is right: those rows are the record, art.
-- 958f CO keeps them ten years, and a correction is a new row. Opening balances
-- are different in the one way that matters: the openings of an OPEN first year
-- are a draft being typed from a fiduciary's balance sheet, not a filed record.
-- What 0005 meant to protect — a filed year's openings never change — has been
-- enforced at the table since 0016 by `trg_opening_frozen`, which refuses
-- insert, update AND delete on a closed year for every role including the owner,
-- and `setOpenings` refuses any year but a book's first. The alternative (upsert
-- by account, zero the dropped ones) would leave zero-amount rows standing for
-- accounts the balance sheet never had, and change the "whole set" semantics the
-- door is built on. So the privilege comes back for this one table; the trigger
-- is the guard.
--
-- Guarded like 0005: a database without `books_app` (a fresh local one) warns
-- rather than failing, and 0005's replay note applies.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    RAISE WARNING 'role books_app does not exist: DELETE on books.opening_balance NOT granted. Create the role, then replay 0005 and 0022 by hand.';
    RETURN;
  END IF;
  GRANT DELETE ON books.opening_balance TO books_app;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION books.trg_opening_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_exercice integer;
  target_status   varchar(20);
  target_year     integer;
BEGIN
  target_exercice := COALESCE(NEW.exercice_id, OLD.exercice_id);
  SELECT status, year INTO target_status, target_year
    FROM books.exercice WHERE id = target_exercice;

  IF target_status = 'closed' THEN
    RAISE EXCEPTION
      'exercice % is closed: its opening balances are part of what was filed',
      target_year USING ERRCODE = 'check_violation';
  END IF;

  -- Was `RETURN NEW`: NULL on DELETE, which silently skipped the row.
  RETURN COALESCE(NEW, OLD);
END;
$$;
