-- b/books, migration 0004 — the accounting rules, as database objects.
--
-- These are NOT app checks. A balanced entry enforced in TypeScript is enforced
-- for callers who go through that TypeScript, and this app has two front doors
-- plus a CLI plus whatever an agent does with a bearer token. Postgres is the one
-- place all of them meet.
--
-- Hand-written. See 0001's header.
--
-- ===========================================================================
-- WHAT "IMMUTABLE" ACTUALLY MEANS HERE, AND WHY IT IS NOT THE WHOLE ROW
-- ===========================================================================
-- The plan says "posted rows immutable, block UPDATE and DELETE". Implemented
-- literally, that BREAKS THE APP'S CORE LOOP, and the mockup says so explicitly.
--
-- Entry 1009 is `status: posted`, its lines balance, and it carries
-- `counterparty: null`, `explanation: null`, `recognition: unrecognized`,
-- `evidence_tier: bare`. Its own verdict block states the intended next step:
--
--   "Identify the counterparty (UBS dossier); attestation or third-party
--    confirmation -> moves to «partial»"
--
-- That is a mutation of a posted row, it is the Reconnaissance screen's entire
-- purpose, and it is correct. Money that moved is a fact; what it was FOR is a
-- question that stays open for months.
--
-- So the freeze is column-scoped, and the line is drawn at the accounting:
--
--   FROZEN once posted      entity, exercice, entry_no, date, the lines and their
--                           amounts and accounts, and un-posting. Plus no delete,
--                           hard or soft: a correction is a REVERSING ENTRY.
--
--   OPEN after posting      counterparty, explanation, recognition, matched rule,
--                           evidence tier and note, related party, the pièce, and
--                           history. Everything that records what it MEANT.
--
-- `raw_label` is frozen at EVERY status, which is stricter than the rest of this
-- file: it is the bank's own text and the only independent record of what
-- arrived. An explanation is added beside it, never over it.

-- ---------------------------------------------------------------------------
-- GUARD 1 — A POSTED ENTRY BALANCES, AND EVERY LINE HAS AN ACCOUNT
-- ---------------------------------------------------------------------------
-- Deferred, because an entry and its lines arrive as separate statements in one
-- transaction: checked at INSERT time, every entry would fail on its first line.
-- `DEFERRABLE INITIALLY DEFERRED` moves the check to COMMIT, which is also the
-- only point at which "does this balance" is a meaningful question.
--
-- Fires on POSTED rows only. Staged entries 1012, 1013 and 2004 in the mockup
-- carry `account: null` on the debit side, which is the normal arrival state:
-- the money moved and nobody has said yet what it was for.
CREATE OR REPLACE FUNCTION books.assert_entry_balanced(p_entry_id integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_status   text;
  v_debit    numeric(14,2);
  v_credit   numeric(14,2);
  v_lines    integer;
  v_unmapped integer;
BEGIN
  SELECT status INTO v_status FROM books.entry WHERE id = p_entry_id;

  -- The entry is gone (the whole transaction deleted it). Nothing to assert.
  IF v_status IS NULL THEN RETURN; END IF;
  IF v_status <> 'posted' THEN RETURN; END IF;

  SELECT count(*),
         COALESCE(sum(debit), 0),
         COALESCE(sum(credit), 0),
         count(*) FILTER (WHERE account_no IS NULL)
    INTO v_lines, v_debit, v_credit, v_unmapped
    FROM books.entry_line WHERE entry_id = p_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION
      'entry % cannot be posted with % line(s): double entry needs at least two',
      p_entry_id, v_lines
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_unmapped > 0 THEN
    RAISE EXCEPTION
      'entry % cannot be posted: % line(s) have no account. Resolve it first',
      p_entry_id, v_unmapped
      USING ERRCODE = 'check_violation';
  END IF;

  -- Exact equality, not a tolerance. numeric(14,2) is exact, so a tolerance here
  -- would only ever hide a real error.
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION
      'entry % does not balance: debit % <> credit %',
      p_entry_id, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION books.trg_entry_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM books.assert_entry_balanced(COALESCE(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION books.trg_entry_line_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM books.assert_entry_balanced(COALESCE(NEW.entry_id, OLD.entry_id));
  RETURN NULL;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_entry_balanced ON books.entry;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_entry_balanced
  AFTER INSERT OR UPDATE ON books.entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION books.trg_entry_balanced();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_entry_line_balanced ON books.entry_line;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_entry_line_balanced
  AFTER INSERT OR UPDATE OR DELETE ON books.entry_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION books.trg_entry_line_balanced();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GUARD 2 — THE ACCOUNTING FACTS OF A POSTED ENTRY ARE FROZEN
-- ---------------------------------------------------------------------------
-- Not deferred and not a constraint trigger: this one must refuse the statement
-- that attempts it, so the error names the column somebody tried to change.
CREATE OR REPLACE FUNCTION books.trg_entry_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- `raw_label` is frozen at every status, not only once posted.
  IF NEW.raw_label IS DISTINCT FROM OLD.raw_label THEN
    RAISE EXCEPTION
      'entry %: raw_label is the bank''s own text and is never overwritten. Put the interpretation in explanation',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'posted' THEN RETURN NEW; END IF;

  IF NEW.status <> 'posted' THEN
    RAISE EXCEPTION
      'entry % is posted and cannot be un-posted. Correct it with a reversing entry (reverses_entry_id)',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION
      'entry % is posted and cannot be deleted, not even soft. A correction is a reversing entry',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.entity_id  IS DISTINCT FROM OLD.entity_id
  OR NEW.exercice_id IS DISTINCT FROM OLD.exercice_id
  OR NEW.entry_no   IS DISTINCT FROM OLD.entry_no
  OR NEW.date       IS DISTINCT FROM OLD.date
  OR NEW.seq        IS DISTINCT FROM OLD.seq THEN
    RAISE EXCEPTION
      'entry % is posted: entity, exercice, entry_no, date and seq are fixed. A correction is a reversing entry',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  -- The VAT AMOUNTS are in the books and are frozen with them. Whether input VAT
  -- is CLAIMED is a position that legitimately changes as evidence arrives, so
  -- tva_input_claimed and tva_note are deliberately absent from this list.
  IF NEW.tva_rate   IS DISTINCT FROM OLD.tva_rate
  OR NEW.tva_amount IS DISTINCT FROM OLD.tva_amount THEN
    RAISE EXCEPTION
      'entry % is posted: the VAT rate and amount are booked figures. tva_input_claimed may still change',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_entry_frozen ON books.entry;--> statement-breakpoint
CREATE TRIGGER trg_entry_frozen
  BEFORE UPDATE ON books.entry
  FOR EACH ROW EXECUTE FUNCTION books.trg_entry_frozen();--> statement-breakpoint

-- The lines of a posted entry are the entry. No exceptions, no column carve-outs:
-- nothing about what an entry MEANT lives down here.
--
-- ── POSTING IS A TRANSITION, NEVER AN INITIAL STATE ─────────────────────────
-- This trigger means an entry cannot be INSERTED as `posted` and then given
-- lines: the first line would be refused. That is deliberate, and it was found by
-- probing rather than by design — the first version of this file made creating a
-- posted entry impossible in a way no test would have noticed until the seed ran.
--
-- The required flow is therefore:
--
--   1. INSERT the entry with status 'staged'
--   2. INSERT its lines
--   3. UPDATE status to 'posted'   <- the deferred balance check fires at COMMIT
--
-- Which is the correct accounting model anyway. Nobody creates a posted entry;
-- they post one, and that act is what the balance check is FOR. It also makes
-- `usePostEntry` in lib/mutations.ts the only door in, and guarantees every posted
-- entry was staged first, so the journal has a real before state.
--
-- The error message says all of this, because the person who hits it is writing a
-- seed or an importer and needs the flow rather than a refusal.
CREATE OR REPLACE FUNCTION books.trg_entry_line_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_entry integer;
BEGIN
  v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT status INTO v_status FROM books.entry WHERE id = v_entry;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION
      'entry % is posted: its lines are fixed. Insert the entry as ''staged'', add its lines, then UPDATE status to ''posted''. To change a posted entry, write a reversing entry (reverses_entry_id)',
      v_entry USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_entry_line_frozen ON books.entry_line;--> statement-breakpoint
CREATE TRIGGER trg_entry_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON books.entry_line
  FOR EACH ROW EXECUTE FUNCTION books.trg_entry_line_frozen();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GUARD 3 — NO HARD DELETE OF AN ENTRY, AT ANY STATUS
-- ---------------------------------------------------------------------------
-- Art. 958f CO requires ten years of retention. A staged entry that turned out to
-- be a duplicate is soft-deleted; a posted one is reversed. Neither is removed,
-- and `DELETE` is the one verb with no legitimate caller.
--
-- 0005 revokes the privilege from `books_app` as well. Both, deliberately: the
-- grant stops the app, and this stops a migration, a console session, and
-- whatever runs as owner at 2am.
CREATE OR REPLACE FUNCTION books.trg_no_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are never hard-deleted (art. 958f, ten-year retention). Soft-delete a staged row; reverse a posted one',
    TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON books.entry;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON books.entry
  FOR EACH ROW EXECUTE FUNCTION books.trg_no_hard_delete();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON books.ri_entry;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON books.ri_entry
  FOR EACH ROW EXECUTE FUNCTION books.trg_no_hard_delete();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GUARD 4 — A CAPITAL COMPANY CAN NEVER KEEP SIMPLIFIED BOOKS
-- ---------------------------------------------------------------------------
-- Art. 957 al. 1 ch. 2 CO. An SA or a Sàrl has NO simplified option at any
-- turnover, and this is the single most consequential rule in the app: getting it
-- wrong means filing the wrong kind of accounts for a company.
--
-- A CHECK rather than validation, so the state cannot be REPRESENTED. Compliance
-- rule bk-001 in the mockup says the same thing with severity `blocker`; a rule an
-- agent evaluates is advice, and this is arithmetic the database refuses.
--
-- Note the direction. The forbidden thing is a capital company falling back to
-- simplified. The reverse — an RI electing full double entry under art. 957 al. 2
-- — is legitimate, common, and left open on purpose (`entity.regime_election`).
ALTER TABLE books.entity
  ADD CONSTRAINT chk_books_entity_capital_company_double_entry
  CHECK (
    bookkeeping_regime <> 'simplified'
    OR upper(legal_form) NOT IN ('SA', 'SARL', 'SÀRL', 'AG', 'GMBH')
  );--> statement-breakpoint

-- And the regime itself is a closed vocabulary. `simplified` misspelled would
-- otherwise slip past the constraint above by not matching it.
ALTER TABLE books.entity
  ADD CONSTRAINT chk_books_entity_regime
  CHECK (bookkeeping_regime IN ('double_entry', 'simplified'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GUARD 5 — CLOSED VOCABULARIES ON THE LEDGER
-- ---------------------------------------------------------------------------
-- These mirror lib/vocabularies.ts. A value that reaches the database outside the
-- list means a screen renders a badge with no colour and no label, and the row
-- looks empty rather than wrong.
ALTER TABLE books.entry
  ADD CONSTRAINT chk_books_entry_status
  CHECK (status IN ('posted', 'staged'));--> statement-breakpoint
ALTER TABLE books.entry
  ADD CONSTRAINT chk_books_entry_recognition
  CHECK (recognition IN ('known_recurring', 'known_one_off', 'inferred', 'unrecognized'));--> statement-breakpoint
ALTER TABLE books.entry
  ADD CONSTRAINT chk_books_entry_evidence_tier
  CHECK (evidence_tier IN ('full', 'partial', 'bare'));--> statement-breakpoint
ALTER TABLE books.ri_entry
  ADD CONSTRAINT chk_books_ri_entry_recognition
  CHECK (recognition IN ('known_recurring', 'known_one_off', 'inferred', 'unrecognized'));--> statement-breakpoint
ALTER TABLE books.ri_entry
  ADD CONSTRAINT chk_books_ri_entry_evidence_tier
  CHECK (evidence_tier IN ('full', 'partial', 'bare'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GUARD 6 — INPUT VAT CANNOT BE CLAIMED WITHOUT A COMPLIANT INVOICE
-- ---------------------------------------------------------------------------
-- Art. 26 LTVA. This is the one place the two evidence consequences touch, and
-- they touch in exactly one direction: `partial` and `bare` LOSE input VAT, while
-- profit-tax deductibility survives on `partial`. That asymmetry is why the tier
-- and the claim are separate columns everywhere else in this schema.
--
-- Enforced here rather than left to the app because overclaiming input VAT is a
-- filing offence, and it is the mistake most likely to be made by whoever writes
-- the derivation that fills a VAT return.
ALTER TABLE books.entry
  ADD CONSTRAINT chk_books_entry_input_vat_needs_full_evidence
  CHECK (tva_input_claimed = false OR evidence_tier = 'full');
