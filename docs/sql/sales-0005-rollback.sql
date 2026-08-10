-- Rollback for apps/sales migration 0005 — point `sales.prospect_labels.label_id`
-- back at `platform.labels`.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL — without it psql prints every error and
-- still exits 0, and a rollback that failed every statement reports success
-- (CLAUDE.md findings #7 and #15).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- WHEN THIS WORKS, AND WHEN IT CANNOT
-- ---------------------------------------------------------------------------
-- On the day 0005 runs, `sales.prospect_labels` is empty (production: 0 rows;
-- the migration REFUSES to run if it is not), so the swap back is a pure
-- catalog change and this file is enough.
--
-- It stops being enough the moment somebody attaches a `sales.labels` row to a
-- prospect, because those label ids are this app's own serials and mean nothing
-- in `platform.labels`. Re-pointing the constraint then fails LOUDLY on the
-- offending rows, which is correct — do not "fix" it by deleting attachments or
-- by dropping the constraint.
--
-- Run this FIRST and read it. Anything other than an empty result means you
-- want a Neon branch restore rather than this file:
--
--   SELECT pl.prospect_id, pl.label_id
--   FROM sales.prospect_labels pl
--   LEFT JOIN platform.labels l ON l.id = pl.label_id
--   WHERE l.id IS NULL;
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not put back the rows Phase 3 deleted from `platform.labels`, and it
-- cannot: they were deleted by the phase's delete ritual, not by 0005, and the
-- source for them is the Neon branch taken immediately before. Reversing the
-- CODE (a Vercel rollback) plus this file gets you a running app pointed back at
-- the platform table; reversing the DATA is a branch restore.
--
-- It also does not drop `sales.labels`. That is 0003's, and sales-0003-rollback
-- .sql carries the same warning about when it stops being a no-op on data.

ALTER TABLE sales.prospect_labels
  DROP CONSTRAINT IF EXISTS prospect_labels_label_id_fkey;

ALTER TABLE sales.prospect_labels
  ADD CONSTRAINT prospect_labels_label_id_fkey
  FOREIGN KEY (label_id) REFERENCES platform.labels(id) ON DELETE CASCADE;
