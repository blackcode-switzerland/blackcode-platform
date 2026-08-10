-- b/sales, migration 0005 — the THIRTEENTH foreign key.
--
-- `sales.prospect_labels.label_id` stops pointing at `platform.labels` and
-- points at `sales.labels`. Phase 3 of multiAppFinalRefactor; migration 0004
-- swapped the other twelve and left this one deliberately, because swapping it
-- there would have required `sales.labels` to be the table the query layer
-- writes, and that is this phase's first step.
--
-- ===========================================================================
-- THIS MIGRATION MOVES NO LABEL ROWS, AND THAT IS A DECISION
-- ===========================================================================
-- PLAN.md decision 2: sales' data does not need preserving. Production holds
-- **zero** `platform.labels WHERE app = 'sales'` rows and **zero**
-- `sales.prospect_labels` rows, so there is nothing to copy there; local dev
-- holds one label and no attachments, and it is test residue.
--
-- A copy step would therefore be machinery that runs against nothing in the
-- only place it matters, which is the shape CLAUDE.md's finding #6 is about.
-- The label rows are deleted from `platform.labels` by the phase's delete
-- ritual, not by this file — a migration that deletes rows from a table another
-- app owns is not something anybody should be able to read past.
--
-- ===========================================================================
-- WHY THE GUARD BELOW IS NOT DECORATION
-- ===========================================================================
-- If `sales.prospect_labels` were NOT empty, the constraint swap would fail on
-- a foreign-key violation — the correct outcome, but with an error naming a
-- constraint rather than the situation. Attachments pointing at label rows that
-- are about to be deleted is a state somebody has to decide about, so the guard
-- says so in one sentence instead.
--
-- Watched fire before it was trusted: an attachment row inserted against a
-- platform label id makes this migration stop with the message below.
--
-- Re-runnable: DROP CONSTRAINT IF EXISTS + ADD, and the guard passes trivially
-- on a second run because the rows it looks for are the ones the swap forbids.
-- Rollback: docs/sql/sales-0005-rollback.sql.

DO $$
DECLARE
  orphans bigint;
BEGIN
  SELECT count(*) INTO orphans
  FROM sales.prospect_labels pl
  WHERE NOT EXISTS (SELECT 1 FROM sales.labels l WHERE l.id = pl.label_id);

  IF orphans > 0 THEN
    RAISE EXCEPTION
      'sales.prospect_labels holds % attachment(s) whose label_id is not in sales.labels. '
      'Phase 3 assumed this table was empty (production: 0 rows). Somebody has been '
      'attaching labels to prospects: decide whether those labels are worth copying from '
      'platform.labels into sales.labels BEFORE running this migration. Do not delete the '
      'attachments to make this pass.', orphans;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE sales.prospect_labels
  DROP CONSTRAINT IF EXISTS prospect_labels_label_id_fkey;--> statement-breakpoint

ALTER TABLE sales.prospect_labels
  ADD CONSTRAINT prospect_labels_label_id_fkey
  FOREIGN KEY (label_id) REFERENCES sales.labels(id) ON DELETE CASCADE;
