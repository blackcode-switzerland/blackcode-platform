-- 0016 — the guards behind the close and openings doors.
--
-- 0004 established the doctrine for entries: what is filed is frozen, and a
-- correction is a new record rather than an edit. Closing a year is the same
-- act one level up, so it gets the same treatment — enforced at the table, not
-- only in the door that happens to be in front of it today.
--
-- Three rules:
--
--   1. A CLOSED YEAR DOES NOT REOPEN. art. 958f CO keeps a filed year for ten
--      years as it was filed. Something found afterwards is corrected in the
--      CURRENT year with a reversing entry, exactly as `trg_entry_frozen`
--      requires for a posted entry.
--
--   2. A CLOSED YEAR'S DATES AND YEAR NUMBER ARE FIXED. Moving the boundary of
--      a filed year would silently move which entries it contains.
--
--   3. OPENING BALANCES OF A CLOSED YEAR ARE FROZEN. They are part of what was
--      filed, and next year's openings were computed from them. `closeExercice`
--      writes into the NEXT year, which is still open, so the legitimate carry
--      is unaffected.
--
-- Rule 3 also stops the one destructive path the openings door could otherwise
-- have: `setOpenings` deletes before inserting, and a delete against a closed
-- year would erase filed figures.

CREATE OR REPLACE FUNCTION books.trg_exercice_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'closed' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'closed' THEN
    RAISE EXCEPTION
      'exercice % is closed and cannot be reopened. A correction belongs in the current year, as a reversing entry',
      OLD.year USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.year       IS DISTINCT FROM OLD.year
  OR NEW.starts_on  IS DISTINCT FROM OLD.starts_on
  OR NEW.ends_on    IS DISTINCT FROM OLD.ends_on
  OR NEW.entity_id  IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION
      'exercice % is closed: its year, its dates and its book are what was filed',
      OLD.year USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_exercice_frozen ON books.exercice;--> statement-breakpoint
CREATE TRIGGER trg_exercice_frozen
  BEFORE UPDATE ON books.exercice
  FOR EACH ROW EXECUTE FUNCTION books.trg_exercice_frozen();--> statement-breakpoint

-- Openings of a closed year: no insert, no update, no delete.
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

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_opening_frozen ON books.opening_balance;--> statement-breakpoint
CREATE TRIGGER trg_opening_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON books.opening_balance
  FOR EACH ROW EXECUTE FUNCTION books.trg_opening_frozen();--> statement-breakpoint

-- The backstop for the chart check in `lib/db/queries/chart-guard.ts`.
--
-- `entry_line.account_no` cannot be a foreign key: the chart is scoped to the
-- ENTITY and the line only knows its entry. So the equivalent is a trigger that
-- follows the entry to its book and looks the account up there.
--
-- The door refuses first and with a suggestion, because "1022 is not in this
-- book's chart, add it with bk books account create" is help and a SQL
-- exception is not. This is what catches anything arriving another way — and
-- it is what would have caught the CHF 43.70 that a workspace clone posted to a
-- ghost account on 2026-08-19, leaving a POSTED, debit-equals-credit entry
-- whose credit side no derivation could see, and a bilan reporting
-- `balanced: false`.
--
-- NULL is allowed and always will be: a staged bank line with no account yet is
-- the normal arrival state from an import, and naming it is what the worklist
-- is for.
CREATE OR REPLACE FUNCTION books.trg_line_account_in_chart() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_entity integer;
BEGIN
  IF NEW.account_no IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT entity_id INTO target_entity FROM books.entry WHERE id = NEW.entry_id;
  IF target_entity IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM books.account
     WHERE entity_id = target_entity AND no = NEW.account_no
  ) THEN
    RAISE EXCEPTION
      'account % is not in this book''s chart. A posting to an account the chart does not carry is invisible to every derivation, and unbalances the bilan',
      NEW.account_no USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_line_account_in_chart ON books.entry_line;--> statement-breakpoint
CREATE TRIGGER trg_line_account_in_chart
  BEFORE INSERT OR UPDATE OF account_no ON books.entry_line
  FOR EACH ROW EXECUTE FUNCTION books.trg_line_account_in_chart();
