-- Rollback for apps/books migration 0006 — `source.layer` NOT NULL again.
--
-- Runs after books-0007-rollback.sql in the reverse walk.
--
-- ---------------------------------------------------------------------------
-- THIS WILL REFUSE ON ANY SEEDED DATABASE, AND THAT IS THE POINT
-- ---------------------------------------------------------------------------
-- 0006 exists because the data legitimately contains NULLs: four of the
-- mockup's nine sources (Stripe, GitHub billing, the AIOSCompanion card, the
-- Drive inbox) have no layer, because `layer` belongs to the three-tier source
-- hierarchy phase 3 builds and they are un-tiered rather than incomplete.
--
-- `SET NOT NULL` against such rows fails — but with a message naming a column,
-- not the situation. The guard below fails with the situation instead, and
-- states the two honest ways forward. What it will NOT do is invent a value:
-- an `UPDATE … SET layer = 'unknown'` here would put a fake tier on real
-- sources to satisfy a rollback, which is backwards.
--
-- Rehearsed 2026-08-17 against the local Postgres: refused with 4 rows named
-- while seeded; applied cleanly once the books workspaces were removed.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM books.source WHERE layer IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING: books.source has % row(s) with layer IS NULL. SET NOT NULL would fail on them. '
      'Either this database holds real data and 0006 must NOT be rolled back (the NULLs are '
      'legitimate, see the migration header), or it is a dev database — reseed or clear it first. '
      'Do not backfill a fake layer to force this through.',
      n;
  END IF;
END
$do$;

ALTER TABLE books.source ALTER COLUMN layer SET NOT NULL;

COMMIT;

-- After running this, ledger bookkeeping as in books-0007-rollback.sql's
-- closing note — or skip it if walking down to 0001.
