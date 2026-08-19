-- Rollback for apps/books migration 0013 — remove the management tables.
--
-- Rollbacks run in REVERSE: 0014's file first, THEN this one, then 0012,
-- 0011 … down to 0001. Each file's header names its place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS
-- ---------------------------------------------------------------------------
-- `books.analysis` is append-only BY DESIGN: each row is an answer somebody
-- filed, with a `based_on` snapshot of what the agent read at answer time.
-- There is no other copy — dropping the table is destroying the record of
-- what was asked and answered, which is precisely what the table exists to
-- make impossible. So: REFUSED while any analysis exists, seeded or not. No
-- force flag. Production: restore a Neon branch. Dev: `npm run db:seed`
-- rebuilds the two seeded ones (and only those).
--
-- Categories and tax parameters are configuration, not records — but a
-- category the breakdown is using or a parameter set someone confirmed is
-- still someone's work, so both refuse when rows exist beyond none.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  -- Order guard: 0014's objects must already be gone, or the reverse walk
  -- is being run out of order.
  IF to_regclass('books.compliance_rule') IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: books.compliance_rule still exists. Run books-0014-rollback.sql first — rollbacks run in reverse.';
  END IF;

  SELECT count(*) FROM books.analysis INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % filed analysis/analyses exist and this table is their only copy. '
      'Production: restore a Neon branch instead. Dev: npm run db:seed rebuilds the seeded two.',
      n;
  END IF;

  SELECT count(*) FROM books.analytique_category INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % analytique categor(y/ies) exist — configuration somebody wrote. '
      'Retire or remove them deliberately first, or restore a branch.',
      n;
  END IF;

  SELECT count(*) FROM books.tax_params INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % tax parameter record(s) exist, with citations and confirmed flags. '
      'Remove them deliberately first, or restore a branch.',
      n;
  END IF;
END
$do$;

DROP TABLE IF EXISTS books.tax_params;
DROP TABLE IF EXISTS books.analytique_category;
DROP TABLE IF EXISTS books.analysis;

COMMIT;
