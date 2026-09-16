-- b/billing, migration 0005 — the guards, in SQL.
--
-- ===========================================================================
-- THESE ARE NOT APP CHECKS, AND THE DIFFERENCE IS THE WHOLE POINT
-- ===========================================================================
-- An invoice is a numbered legal document. The app is not the only thing that
-- can write to this database: a migration can, a console session can, and a
-- second deployment can. A rule enforced in a route holds for requests that go
-- through that route; a rule enforced here holds.
--
-- Six guards, G1 to G6. Each one names its correction path in its own error
-- message, because the person who hits it is mid-task and the message is the
-- only documentation they will read.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ────────────────────────────────────────
-- Two rules need a row from another table and therefore cannot be a CHECK:
--
--   - QRR requires the company to HAVE a `qr_iban`. The CHECK on `invoice`
--     cannot see `company`.
--   - a company with `vat_registered = false` may carry no non-null
--     `vat_rate` on any line.
--
-- Both are enforced at the write door and asserted by a test. A trigger could
-- do either, at the cost of a cross-table read on every write; the write door is
-- the cheaper place and the test is what stops it being the only place by
-- accident. **Say so rather than leaving a reader to notice the gap.**

-- ---------------------------------------------------------------------------
-- G6 (first, because the others reference the same values): CLOSED VOCABULARIES
-- ---------------------------------------------------------------------------
-- Every one of these lists also exists in lib/vocabularies.ts and as a union in
-- types/index.ts. **Three copies of one list is two too many**, so
-- lib/vocabularies.test.ts reads all three and fails when they disagree. That
-- test exists because of CLAUDE.md finding #18: a comment claimed a test
-- asserted a scanner matched a migration's triggers, and no such test had ever
-- been written.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_status_check
  CHECK (status IN ('draft', 'sent', 'paid', 'void'));--> statement-breakpoint

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_ref_type_check
  CHECK (ref_type IN ('QRR', 'SCOR', 'NON'));--> statement-breakpoint

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_language_check
  CHECK (language IN ('fr', 'de', 'it', 'en'));--> statement-breakpoint

-- ISO 4217 by SHAPE, not by list. A closed currency list would be a migration
-- every time somebody bills in a new one, and the payment-part restriction
-- (CHF and EUR only) is a different rule enforced where the payment part is
-- drawn — an invoice in GBP is legitimate and simply carries no payment part.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_currency_shape_check
  CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint

ALTER TABLE billing.company
  ADD CONSTRAINT company_rounding_check
  CHECK (rounding IN ('line_0_05', 'total_0_05', 'none'));--> statement-breakpoint

ALTER TABLE billing.company
  ADD CONSTRAINT company_default_ref_type_check
  CHECK (default_ref_type IN ('QRR', 'SCOR', 'NON'));--> statement-breakpoint

ALTER TABLE billing.company
  ADD CONSTRAINT company_default_language_check
  CHECK (default_language IN ('fr', 'de', 'it', 'en'));--> statement-breakpoint

ALTER TABLE billing.audit
  ADD CONSTRAINT audit_action_check
  CHECK (action IN ('created', 'field_changed', 'status_changed', 'sent', 'paid', 'voided'));--> statement-breakpoint

ALTER TABLE billing.audit
  ADD CONSTRAINT audit_via_check
  CHECK (via IN ('session', 'token'));--> statement-breakpoint

ALTER TABLE billing.audit
  ADD CONSTRAINT audit_subject_type_check
  CHECK (subject_type IN ('invoice', 'company', 'recurrence'));--> statement-breakpoint

ALTER TABLE billing.idempotency_keys
  ADD CONSTRAINT idempotency_status_check
  CHECK (status IN ('pending', 'done'));--> statement-breakpoint

-- A VAT rate is a percentage, and a negative one is not a thing. 100 is the
-- ceiling rather than 27 (the EU maximum) because this column is a rate, not a
-- Swiss rate — an export line at 0 and a foreign rate both have to fit.
ALTER TABLE billing.invoice_line
  ADD CONSTRAINT invoice_line_vat_rate_range
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100));--> statement-breakpoint

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_vat_rate_range
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G4: THE SWISS COMBINATION MATRIX
-- ---------------------------------------------------------------------------
-- docs/billing-app-plan/qr-bill.md has the full table. The half expressible as a
-- CHECK is here; the QR-IBAN half is at the write door (see the header).
--
-- QRR: CHF only, and exactly 26 digits in the body. The 27th character is the
-- modulo-10 check digit, which is DERIVED on every render and never stored —
-- storing it would be storing a value that can disagree with the body it checks.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_qrr_matrix_check
  CHECK (
    ref_type <> 'QRR'
    OR (currency = 'CHF' AND ref_body IS NOT NULL AND ref_body ~ '^[0-9]{26}$')
  );--> statement-breakpoint

-- NON: no reference at all, so the body must be EMPTY. A body with no reference
-- type to interpret it is a value nothing will ever read, which is how a
-- half-migrated invoice looks.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_non_matrix_check
  CHECK (ref_type <> 'NON' OR ref_body IS NULL);--> statement-breakpoint

-- SCOR: ISO 11649, so a non-empty body of up to 25 characters after the RF
-- prefix. The check digits are derived, like QRR's.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_scor_matrix_check
  CHECK (
    ref_type <> 'SCOR'
    OR (ref_body IS NOT NULL AND length(ref_body) BETWEEN 1 AND 25)
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G3 (part 1): THE STATUS MACHINE'S FIELD DEPENDENCIES
-- ---------------------------------------------------------------------------
-- A CHECK can say "paid requires a paid date". It cannot say "paid may only
-- follow sent", because it cannot see the old row — that is the trigger below.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_paid_requires_date
  CHECK (status <> 'paid' OR paid_date IS NOT NULL);--> statement-breakpoint

-- A void with no reason is a deletion with extra steps. The reason is what makes
-- the record a record.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_void_requires_record
  CHECK (status <> 'void' OR void IS NOT NULL);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G1: THE NUMBER IS PERMANENT
-- ---------------------------------------------------------------------------
-- `number`, `seq_no`, `company_id` and `seq` cannot change after insert. This is
-- the guard that makes the statutory sequence mean anything: a number that can
-- be edited is not a number, it is a label.
--
-- Column-scoped and comparing OLD to NEW, so an UPDATE touching other columns is
-- unaffected — which is most updates, because editing a draft is the app's main
-- loop.
CREATE OR REPLACE FUNCTION billing.invoice_number_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION
      'invoice number is permanent (was %, tried %)', OLD.number, NEW.number
      USING HINT = 'a wrong invoice is voided with a reason and reissued; the number stays consumed';
  END IF;
  IF NEW.seq_no IS DISTINCT FROM OLD.seq_no THEN
    RAISE EXCEPTION
      'invoice seq_no is permanent (was %, tried %)', OLD.seq_no, NEW.seq_no
      USING HINT = 'the statutory sequence has no holes and no reuse; see the allocator in lib/db/queries/seq.ts';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION
      'invoice issuer is permanent (was company %, tried %)', OLD.company_id, NEW.company_id
      USING HINT = 'an invoice that changed issuer would be a different document with the same number; void and reissue from the other company';
  END IF;
  IF NEW.seq IS DISTINCT FROM OLD.seq THEN
    RAISE EXCEPTION 'invoice #number is permanent (was %, tried %)', OLD.seq, NEW.seq
      USING HINT = 'the #number is this invoice''s address; it appears in URNs that have been printed';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_invoice_number_frozen ON billing.invoice;--> statement-breakpoint
CREATE TRIGGER trg_invoice_number_frozen
  BEFORE UPDATE ON billing.invoice
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_number_frozen();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G3 (part 2): THE TRANSITIONS
-- ---------------------------------------------------------------------------
-- `draft → sent → paid`, anything → `void`, and nothing else.
--
-- Note what is NOT permitted: `paid → sent`, `sent → draft`, `void → anything`.
-- Un-sending a bill somebody has received is not a state change, it is a
-- fiction; and a void is terminal because its number is already consumed.
CREATE OR REPLACE FUNCTION billing.invoice_status_machine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- `void` from anywhere except itself. A mistake is always cancellable.
  IF NEW.status = 'void' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'invoice % is void and cannot be revived (tried %)', OLD.number, NEW.status
      USING HINT = 'its number is consumed forever; issue a new invoice instead';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'sent' THEN RETURN NEW; END IF;
  IF OLD.status = 'sent'  AND NEW.status = 'paid' THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'invoice % cannot go from % to %', OLD.number, OLD.status, NEW.status
    USING HINT = 'the machine is draft -> sent -> paid, and anything -> void';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_invoice_status_machine ON billing.invoice;--> statement-breakpoint
CREATE TRIGGER trg_invoice_status_machine
  BEFORE UPDATE OF status ON billing.invoice
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_status_machine();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G2: A SENT DOCUMENT IS FROZEN — COLUMN BY COLUMN
-- ---------------------------------------------------------------------------
-- Once `status <> 'draft'`, the DOCUMENT half is immutable: `currency`,
-- `ref_type`, `ref_body`, `client`, `prices_include_vat`, `issue_date`, and the
-- lines. What stays writable is the part that is not a legal fact:
-- `message`, `due_date`, `paid_date`, `status`, `void`, `external_ref`,
-- `metadata`.
--
-- ** COLUMN-SCOPED IS STRONGER THAN A TABLE-LEVEL REVOKE, NOT WEAKER. ** A
-- revoke cannot tell an amount from a payment message, and only one of those is
-- a legal fact. `apps/books/lib/db/migrations/0005_app_role_grants.sql` records
-- the same disagreement with its own plan and resolves it the same way.
--
-- This is position P9, and it is an ASSUMPTION: the safe reading of invariant
-- I12. Loosening it later is easy; tightening it after real bills exist is not.
-- See the README's table of provisional answers.
CREATE OR REPLACE FUNCTION billing.invoice_document_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  frozen text;
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  frozen := CASE
    WHEN NEW.currency           IS DISTINCT FROM OLD.currency           THEN 'currency'
    WHEN NEW.ref_type           IS DISTINCT FROM OLD.ref_type           THEN 'ref_type'
    WHEN NEW.ref_body           IS DISTINCT FROM OLD.ref_body           THEN 'ref_body'
    WHEN NEW.client             IS DISTINCT FROM OLD.client             THEN 'client'
    WHEN NEW.prices_include_vat IS DISTINCT FROM OLD.prices_include_vat THEN 'prices_include_vat'
    WHEN NEW.issue_date         IS DISTINCT FROM OLD.issue_date         THEN 'issue_date'
    ELSE NULL
  END;

  IF frozen IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % is % and its % is part of the sent document', OLD.number, OLD.status, frozen
      USING HINT = 'void it with a reason and reissue; message, due_date, paid_date and status stay editable';
  END IF;

  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_invoice_document_frozen ON billing.invoice;--> statement-breakpoint
CREATE TRIGGER trg_invoice_document_frozen
  BEFORE UPDATE ON billing.invoice
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_document_frozen();--> statement-breakpoint

-- The LINES of a sent invoice ARE the document — this is the half that is easy
-- to forget, and forgetting it would leave the amounts editable after send while
-- the header was locked.
--
-- It fires on INSERT and DELETE as well as UPDATE: adding a line to a sent
-- invoice changes its total just as surely as editing one.
CREATE OR REPLACE FUNCTION billing.invoice_line_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv_status text;
  inv_number text;
  target_id  integer;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT status, number INTO inv_status, inv_number
    FROM billing.invoice WHERE id = target_id;

  IF inv_status IS NULL OR inv_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'invoice % is % and its lines are part of the sent document (%)', inv_number, inv_status, TG_OP
    USING HINT = 'void it with a reason and reissue; the amounts on a sent bill are a legal fact';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_invoice_line_frozen ON billing.invoice_line;--> statement-breakpoint
CREATE TRIGGER trg_invoice_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_line
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_line_frozen();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G5: NOTHING IS EVER DELETED
-- ---------------------------------------------------------------------------
-- Art. 958f CO: ten-year retention. An invoice is voided with a reason, never
-- binned, which is why this app serves no `trash` and no `label`.
--
-- ** BOTH THE TRIGGER AND THE REVOKE (0006), DELIBERATELY. ** The trigger stops
-- anything running as owner — a migration, a console session, a script somebody
-- wrote in a hurry. The revoke stops the app before the statement is even
-- attempted, and shows up in `\dp` where a reviewer will see it. Neither alone
-- is the whole guard.
CREATE OR REPLACE FUNCTION billing.no_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted (art. 958f CO, ten-year retention)', TG_TABLE_NAME
    USING HINT = 'an invoice is voided with a reason and keeps its number; a company is retired with retired_at; an audit row is permanent';
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON billing.invoice;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON billing.invoice
  FOR EACH ROW EXECUTE FUNCTION billing.no_hard_delete();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON billing.audit;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON billing.audit
  FOR EACH ROW EXECUTE FUNCTION billing.no_hard_delete();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON billing.company;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON billing.company
  FOR EACH ROW EXECUTE FUNCTION billing.no_hard_delete();--> statement-breakpoint

-- `invoice_line` is deliberately NOT given this trigger, and the reason is a
-- real ordering problem rather than an oversight.
--
-- A DRAFT's lines must be deletable: removing a line is half of editing a draft,
-- which is the app's main loop. `trg_invoice_line_frozen` above already refuses
-- a DELETE once the invoice is not a draft, so the retention rule is enforced
-- where it applies — and 0006's `REVOKE DELETE` would break draft editing, so it
-- is NOT applied to this table either.
--
-- Stated because the asymmetry looks like a gap: `invoice` has both a trigger
-- and a revoke, `invoice_line` has a conditional trigger and no revoke.

-- ---------------------------------------------------------------------------
-- THE AUDIT LOG IS APPEND-ONLY, AND UPDATE IS THE HALF A DELETE-GUARD MISSES
-- ---------------------------------------------------------------------------
-- Rewriting an audit row is worse than deleting one: a deleted row leaves a gap
-- in the sequence that `uq_audit_ws_seq` and a reader can both notice, while an
-- edited row leaves a plausible lie.
CREATE OR REPLACE FUNCTION billing.audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing.audit is append-only (row % of workspace %)', OLD.seq, OLD.workspace_id
    USING HINT = 'the log IS the edit workflow; correct a record by appending, never by rewriting';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_append_only ON billing.audit;--> statement-breakpoint
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE ON billing.audit
  FOR EACH ROW EXECUTE FUNCTION billing.audit_append_only();
