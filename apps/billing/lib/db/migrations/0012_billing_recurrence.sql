-- b/billing, migration 0012 — finite recurrence. Phase 4, ticket #91;
-- docs/billing-app-plan/phase-4-recurrence.md; DATA-MODEL invariant I9.
--
-- (The plan calls this "migration 0008". 0008 went to the reference shape, and
-- phase 4 landed after 0011; the number is only an order.)
--
-- ===========================================================================
-- A RULE IS DATA, AND NOTHING FIRES ON IT
-- ===========================================================================
-- A series is a frequency, a start date, an OCCURRENCE COUNT that is its end
-- condition, a counter and the next date. Nothing in this app schedules
-- anything: an agent reads `next_date` (`bk billing recurrence list --due`) and
-- asks for the next occurrence, which is created as an ordinary draft through
-- the ordinary create path.
--
-- ===========================================================================
-- WHAT THE DATABASE HOLDS, AND WHY EACH IS HERE RATHER THAN IN THE APP
-- ===========================================================================
-- | guard                                   | what it stops                         |
-- |-----------------------------------------|---------------------------------------|
-- | occurrences_total >= 1, NOT NULL        | an open-ended series (I9)             |
-- | 0 <= done <= total                      | a series billed past its cap          |
-- | completed ⇔ done = total ⇔ next is null | `completed` set by hand, or a         |
-- |                                         | finished series with a next date      |
-- | uq_invoice_occurrence (partial)         | TWO LIVE BILLS FOR ONE PERIOD — the   |
-- |                                         | retrying agent, whatever path it took |
-- | invoice_series_frozen trigger           | an occurrence re-labelled into        |
-- |                                         | another period or series afterwards   |
-- | no DELETE (trigger + revoke)            | a series vanishing with its history   |
--
-- The app's generate path ALSO checks, under a row lock, so that a second call
-- gets a 409 naming the invoice that already exists. The index is what makes
-- that true for every other path — a script, a console, a future route — and
-- it is the only guard here that settles a race nobody locked for.

CREATE TABLE IF NOT EXISTS billing.recurrence (
  id                  serial PRIMARY KEY,
  workspace_id        integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  seq                 integer NOT NULL,
  company_id          integer NOT NULL REFERENCES billing.company(id) ON DELETE RESTRICT,
  -- NULLABLE, legitimately: a series that ended before this app existed has its
  -- template in the imported archive, not here (the mockup's Häberli series).
  -- Such a rule lists and shows; it cannot generate.
  --
  -- NO ACTION, not RESTRICT, on this key and on `invoice.recurrence_id` below.
  -- The two point at each other, and a workspace delete (the seed's rebuild)
  -- cascades to both tables in one statement: RESTRICT is checked row by row,
  -- mid-cascade, and fails on whichever row goes first; NO ACTION is checked at
  -- the end of the statement, when both are gone. Nothing deletes either table
  -- otherwise — the no-delete trigger and the revoke see to that.
  template_invoice_id integer REFERENCES billing.invoice(id),
  status              varchar(10) NOT NULL DEFAULT 'active',
  frequency           varchar(10) NOT NULL,
  start_date          date NOT NULL,
  -- THE END CONDITION. Required, and at least one: there is no open-ended series.
  occurrences_total   integer NOT NULL,
  occurrences_done    integer NOT NULL DEFAULT 0,
  next_date           date,
  label_fr            varchar(200),
  label_en            varchar(200),
  external_ref        varchar(80),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by          integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_recurrence_ws_seq UNIQUE (workspace_id, seq)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurrence_ws_external_ref
  ON billing.recurrence (workspace_id, external_ref)
  WHERE external_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recurrence_ws_next ON billing.recurrence (workspace_id, status, next_date);--> statement-breakpoint

ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_status_check
  CHECK (status IN ('active', 'paused', 'completed'));--> statement-breakpoint
ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_frequency_check
  CHECK (frequency IN ('monthly', 'quarterly', 'yearly'));--> statement-breakpoint
ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_finite
  CHECK (occurrences_total >= 1 AND occurrences_done >= 0 AND occurrences_done <= occurrences_total);--> statement-breakpoint

-- `completed` is DERIVED from the counter reaching the cap (I9), so the two can
-- never disagree — and a finished series has no next date, an unfinished one
-- always has one. Every term is `=` over non-null operands or `IS NULL`, which
-- yield true or false and never NULL, so no row slips through the CHECK-NULL trap
-- 0010's flag constraint fell into (`next_date` is the only nullable column, and
-- it only appears under `IS NULL`).
ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_completed_by_the_cap
  CHECK (
    (status = 'completed') = (occurrences_done = occurrences_total)
    AND (status = 'completed') = (next_date IS NULL)
  );--> statement-breakpoint

ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_labels_not_blank
  CHECK (
    (label_fr IS NULL OR btrim(label_fr) <> '')
    AND (label_en IS NULL OR btrim(label_en) <> '')
  );--> statement-breakpoint

ALTER TABLE billing.recurrence
  ADD CONSTRAINT recurrence_metadata_is_object
  CHECK (jsonb_typeof(metadata) = 'object');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_no_hard_delete ON billing.recurrence;--> statement-breakpoint
CREATE TRIGGER trg_no_hard_delete
  BEFORE DELETE ON billing.recurrence
  FOR EACH ROW EXECUTE FUNCTION billing.no_hard_delete();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- TWO COLUMNS ON THE INVOICE
-- ---------------------------------------------------------------------------
-- `recurrence_id` is set on every occurrence AND on the template. A void does
-- not clear it: a cancelled occurrence stays part of its series, which is what
-- lets a card say "2/8 issued" while the list shows three invoices.
--
-- `occurrence_period` is the period an occurrence bills: `2026-10` monthly,
-- `2026-Q4` quarterly, `2026` yearly. NULL on a one-off, and on a template that
-- is not itself an occurrence.
ALTER TABLE billing.invoice
  ADD COLUMN IF NOT EXISTS recurrence_id integer REFERENCES billing.recurrence(id);--> statement-breakpoint
ALTER TABLE billing.invoice ADD COLUMN IF NOT EXISTS occurrence_period varchar(7);--> statement-breakpoint

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_occurrence_period_shape
  CHECK (occurrence_period IS NULL OR occurrence_period ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$');--> statement-breakpoint

-- A period belongs to a series. `IS NULL OR IS NOT NULL`: true or false, never NULL.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_period_requires_series
  CHECK (occurrence_period IS NULL OR recurrence_id IS NOT NULL);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_invoice_recurrence ON billing.invoice (recurrence_id) WHERE recurrence_id IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE IDEMPOTENCY INDEX — THE WHOLE POINT OF THE PHASE
-- ---------------------------------------------------------------------------
-- At most one LIVE invoice per (series, period). Two decisions in the WHERE:
--
--   - a retrying agent cannot double-bill: the second insert for a period
--     violates this index whatever path it took;
--   - `status <> 'void'` means a CANCELLED occurrence frees its period for a
--     replacement (position P7) while keeping its own number consumed forever.
--     The mockup's BC-2026-0033 (void) and BC-2026-0034 are ONE occurrence of the
--     Junod series.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_occurrence
  ON billing.invoice (recurrence_id, occurrence_period)
  WHERE recurrence_id IS NOT NULL
    AND occurrence_period IS NOT NULL
    AND status <> 'void';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AN INVOICE JOINS A SERIES ONCE, AND STAYS
-- ---------------------------------------------------------------------------
-- Both columns may go from NULL to a value (a template joining the series it
-- seeds), and never change after. Not in G2's list, because G2 only guards a
-- non-draft invoice and this must hold on a draft too: a draft occurrence
-- re-labelled into another period would free the period it really bills.
CREATE OR REPLACE FUNCTION billing.invoice_series_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.recurrence_id IS NOT NULL AND NEW.recurrence_id IS DISTINCT FROM OLD.recurrence_id THEN
    RAISE EXCEPTION 'invoice % belongs to series %, and an invoice never leaves or changes its series', OLD.number, OLD.recurrence_id;
  END IF;
  IF OLD.occurrence_period IS NOT NULL AND NEW.occurrence_period IS DISTINCT FROM OLD.occurrence_period THEN
    RAISE EXCEPTION 'invoice % bills period %, and that never changes', OLD.number, OLD.occurrence_period
      USING HINT = 'void it with a reason; its period is then free for a replacement';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_invoice_series_frozen ON billing.invoice;--> statement-breakpoint
CREATE TRIGGER trg_invoice_series_frozen
  BEFORE UPDATE ON billing.invoice
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_series_frozen();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The app role: read, create and advance a rule; never delete one
-- ---------------------------------------------------------------------------
-- Guarded on the role like 0003, 0006 and 0010: skipped with a WARNING on a
-- database that has not been provisioned yet, and not fixed by re-running.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
    RAISE WARNING 'role billing_app does not exist: recurrence grants SKIPPED. Create the role, then replay 0012''s DO block by hand.';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE ON billing.recurrence TO billing_app;
  GRANT USAGE, SELECT ON SEQUENCE billing.recurrence_id_seq TO billing_app;
  REVOKE DELETE ON billing.recurrence FROM billing_app;
  RAISE INFO 'billing_app on billing.recurrence: SELECT, INSERT and UPDATE; DELETE revoked.';
END
$$;
