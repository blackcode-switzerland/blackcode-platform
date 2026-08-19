-- Rollback for apps/books migration 0014 — remove the compliance layer.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0013, 0012 … down to 0001.
-- Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- A rule a fiduciary has APPROVED, EDITED or REJECTED carries their sign-off —
-- work this table is the only record of. Draft rules reload from
-- fixtures/compliance-rules.json, so a table of pure drafts drops freely;
-- one reviewed rule refuses the whole walk.
--
-- A verdict on an entry is the Devil's Advocate's flag, and the entry's
-- history keeps the trail — but the CURRENT verdict lives only in the column.
-- Refused while any verdict stands: dropping the column silently unblocks
-- entries a reviewer said must not post.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  SELECT count(*) FROM books.compliance_rule WHERE review_state <> 'draft' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % rule(s) carry a fiduciary review (approved/edited/rejected) and this table is the only record of it. '
      'Production: restore a Neon branch instead.',
      n;
  END IF;

  SELECT (SELECT count(*) FROM books.entry    WHERE verdict IS NOT NULL)
       + (SELECT count(*) FROM books.ri_entry WHERE verdict IS NOT NULL) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % record(s) carry a compliance verdict. Dropping the column silently unblocks '
      'entries a reviewer said must not post. Clear the verdicts deliberately first, or restore a branch.',
      n;
  END IF;
END
$do$;

DROP TABLE IF EXISTS books.compliance_rule;
ALTER TABLE books.entry    DROP COLUMN IF EXISTS verdict;
ALTER TABLE books.ri_entry DROP COLUMN IF EXISTS verdict;

COMMIT;
