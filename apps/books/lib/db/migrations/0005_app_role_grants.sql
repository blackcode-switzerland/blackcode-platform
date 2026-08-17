-- b/books, migration 0005 — what the app role may actually do.
--
-- ===========================================================================
-- WHY THIS EXISTS: `books_app` COULD DO NOTHING AT ALL
-- ===========================================================================
-- Measured 2026-08-17, after 0003 and 0004 landed:
--
--   SELECT table_name, privilege_type FROM information_schema.table_privileges
--    WHERE table_schema='books' AND grantee='books_app';
--   -> 0 rows
--
--   pg_default_acl for schema books -> 0 rows
--
-- So the app role held no privilege on any table in its own schema, and no
-- default privileges to pick up new ones. In production that role could not have
-- served a single request.
--
-- ── AND THE PHASE 0 BOUNDARY PROBE PASSED ANYWAY ────────────────────────────
-- Every check in it was a NEGATIVE: cannot read `issues.*`, cannot purge another
-- app's blob references, owns nothing. A subject with no privileges whatsoever
-- passes all of those. `apps/_scaffold/lib/auth/register-gate.test.ts` states the
-- rule this broke, as its Finding #16:
--
--   "a check built on 'was this denied?' cannot tell a working boundary from a
--    subject that can do nothing at all"
--
-- Nothing broke locally because `.env.local` points at the OWNER credential and
-- says so in its own header. The role was never exercised.
--
-- The cause is upstream: `docs/sql/app-role.sql` tells you to substitute `<app>`
-- but carries literal `issues` / `issues_app` in its second half (lines 82-109),
-- including the `ALTER DEFAULT PRIVILEGES IN SCHEMA platform, issues` that was
-- supposed to cover exactly this. Running it for a new app silently configures
-- issues instead. `docs/sql/books-app-role.sql` is owed, substituted, and the
-- boundary probe is owed a positive case.
--
-- ===========================================================================
-- WHERE THIS FILE DISAGREES WITH THE PLAN, AND WHY
-- ===========================================================================
-- phase-1-statutory-core.md says: "REVOKE UPDATE, DELETE on the posted ledger
-- tables from `books_app`. The app role then cannot break immutability even by
-- accident."
--
-- The DELETE half is right and is done below. **The UPDATE half is wrong**, and
-- following it would break the app's main loop.
--
-- Mockup entry 1009 is posted, balanced, and unrecognized, and its own verdict
-- states the intended next step: identify the counterparty, and the evidence tier
-- moves from `bare` to `partial`. That is an UPDATE of a posted row, it is what
-- the Reconnaissance screen does, and revoking UPDATE would make it impossible.
--
-- Immutability is enforced per COLUMN by 0004's triggers instead, which is
-- stronger than a table-level revoke rather than weaker: a revoke cannot tell the
-- date of an entry from its explanation, and only one of those is a booked fact.

-- ---------------------------------------------------------------------------
-- 1. THE GRANTS THE APP ACTUALLY NEEDS
-- ---------------------------------------------------------------------------
-- Guarded on the role existing, so a fresh database can migrate before it is
-- provisioned. **The order is still role first, then register, then migrate** —
-- 0002's comment claimed order did not matter here and it was wrong, because a
-- grant skipped this way is not fixed by re-running: Drizzle records the
-- migration applied. If you provision the role after migrating, replay this file
-- by hand.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    RAISE WARNING 'role books_app does not exist: grants SKIPPED. Create the role, then replay 0005 by hand.';
    RETURN;
  END IF;

  GRANT USAGE ON SCHEMA books TO books_app;

  -- DML on this app's own tables. No DDL: the role owns nothing and cannot ALTER
  -- or DROP, which is the whole point of the per-app role model.
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA books TO books_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA books TO books_app;

  -- Future tables, so phase 2 does not rediscover an empty privilege list. This
  -- is the statement `docs/sql/app-role.sql` was meant to run and applied to
  -- `issues` instead.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA books '
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO books_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA books '
          'GRANT USAGE, SELECT ON SEQUENCES TO books_app';

  -- ------------------------------------------------------------------------
  -- 2. NO HARD DELETE, AT THE PRIVILEGE LEVEL AS WELL AS THE TRIGGER LEVEL
  -- ------------------------------------------------------------------------
  -- Art. 958f, ten-year retention. 0004 has a trigger that refuses DELETE on
  -- these tables; this removes the privilege too.
  --
  -- Both, deliberately. The trigger stops anything running as owner, including a
  -- migration or a console session. The revoke stops the app before the statement
  -- is even attempted, and shows up in `\dp` where a reviewer will see it.
  REVOKE DELETE ON books.entry      FROM books_app;
  REVOKE DELETE ON books.entry_line FROM books_app;
  REVOKE DELETE ON books.ri_entry   FROM books_app;
  REVOKE DELETE ON books.patrimoine FROM books_app;

  -- Opening balances and the chart of accounts are not deleted either. An account
  -- that is no longer used stays in the chart, because entries reference it and a
  -- statement for a past year has to render.
  REVOKE DELETE ON books.account         FROM books_app;
  REVOKE DELETE ON books.opening_balance FROM books_app;

  -- A closed exercice is the anchor for every opening balance after it.
  REVOKE DELETE ON books.exercice FROM books_app;

  -- ------------------------------------------------------------------------
  -- 3. THE LAW IS NOT RUNTIME-EDITABLE
  -- ------------------------------------------------------------------------
  -- `books.statement_position` holds the art. 959a / 959b line keys. It is seeded
  -- by migration from lib/statements.ts, and changing it is a reviewed code change
  -- citing an article, never an app write. SELECT only.
  REVOKE INSERT, UPDATE, DELETE ON books.statement_position FROM books_app;

  -- ------------------------------------------------------------------------
  -- 4. THE SHARED BLOB INDEX STAYS READ-ONLY
  -- ------------------------------------------------------------------------
  -- Re-asserted rather than assumed. It is maintained by the platform trigger, and
  -- an app that could write it could make another app's file look unreferenced.
  -- Verified already true on 2026-08-17; kept here so it survives a role rebuild.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM books_app;
  GRANT SELECT ON platform.blob_references TO books_app;

  -- ------------------------------------------------------------------------
  -- 5. THE MIGRATION LEDGER IS NOT THE APP'S BUSINESS
  -- ------------------------------------------------------------------------
  REVOKE ALL ON SCHEMA drizzle FROM books_app;

  EXECUTE 'ALTER ROLE books_app SET search_path = platform, books';

  RAISE INFO 'books_app grants applied.';
END
$$;
