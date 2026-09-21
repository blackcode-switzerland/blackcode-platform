-- b/billing, migration 0003 — what the app role may actually do.
--
-- ===========================================================================
-- WHY THIS EXISTS: WITHOUT IT, `billing_app` CAN DO NOTHING AT ALL
-- ===========================================================================
-- Measured on `books_app` on 2026-08-17, after that app's first two migrations
-- had landed:
--
--   SELECT table_name, privilege_type FROM information_schema.table_privileges
--    WHERE table_schema='books' AND grantee='books_app';
--   -> 0 rows
--   pg_default_acl for schema books -> 0 rows
--
-- The app role held no privilege on any table in its own schema, and no default
-- privileges to pick up new ones. In production that role could not have served
-- a single request.
--
-- ── AND THE PHASE 0 BOUNDARY PROBE PASSED ANYWAY ────────────────────────────
-- Every check in it was a NEGATIVE: cannot read `issues.*`, cannot purge another
-- app's blob references, owns nothing. A subject with no privileges whatsoever
-- passes all of those. That is CLAUDE.md finding #16:
--
--   "a check built on 'was this denied?' cannot tell a working boundary from a
--    subject that can do nothing at all"
--
-- Nothing broke locally because `.env.local` points at the OWNER credential and
-- says so in its own header. The role was never exercised.
--
-- The cause is upstream: `docs/sql/app-role.sql` tells you to substitute `<app>`
-- but carries literal `issues` / `issues_app` in its second half, including the
-- `ALTER DEFAULT PRIVILEGES` that was supposed to cover exactly this. Running it
-- for a new app silently configures issues instead. This app ships
-- `docs/sql/billing-app-role.sql`, substituted, and the boundary probe's
-- POSITIVE checks — (1), (4a), (4e) — are the ones to read first.
--
-- ===========================================================================
-- THE REVOKE LIST IS EMPTY IN THIS PHASE, ON PURPOSE
-- ===========================================================================
-- `apps/books`' equivalent revokes DELETE on its ledger tables. b/billing has no
-- tables to protect yet: phase 0 creates only tenancy and the counter, and an
-- invoice that must never be deleted does not exist until phase 1's 0004.
--
-- Phase 1's 0006 adds the revokes — `invoice`, `invoice_line`, `audit` — beside
-- the triggers that refuse the same statements. Both, deliberately: the trigger
-- stops anything running as owner, including a migration or a console session,
-- and the revoke stops the app before the statement is attempted and shows up in
-- `\dp` where a reviewer will see it.
--
-- An empty list here is not a gap. A revoke naming a table that does not exist
-- would fail the whole DO block.

DO $$
BEGIN
  -- Guarded on the role existing, so a fresh database can migrate before it is
  -- provisioned. **The order is still role first, then register, then migrate.**
  -- A grant skipped this way is not fixed by re-running: Drizzle records the
  -- migration applied. If you provision the role after migrating, replay this
  -- file by hand.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
    RAISE WARNING 'role billing_app does not exist: grants SKIPPED. Create the role, then replay 0003 by hand.';
    RETURN;
  END IF;

  GRANT USAGE ON SCHEMA billing TO billing_app;

  -- DML on this app's own tables. No DDL: the role owns nothing and cannot ALTER
  -- or DROP, which is the whole point of the per-app role model.
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO billing_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO billing_app;

  -- Future tables, so phase 1 does not rediscover an empty privilege list. This
  -- is the statement `docs/sql/app-role.sql` was meant to run and applied to
  -- `issues` instead.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA billing '
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO billing_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA billing '
          'GRANT USAGE, SELECT ON SEQUENCES TO billing_app';

  -- ------------------------------------------------------------------------
  -- THE SHARED BLOB INDEX STAYS READ-ONLY
  -- ------------------------------------------------------------------------
  -- Re-asserted rather than assumed. It is maintained by the platform trigger,
  -- and an app that could write it could make another app's file look
  -- unreferenced. Kept here so it survives a role rebuild.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM billing_app;
  GRANT SELECT ON platform.blob_references TO billing_app;

  -- ------------------------------------------------------------------------
  -- THE MIGRATION LEDGER IS NOT THE APP'S BUSINESS
  -- ------------------------------------------------------------------------
  -- The app credential must not be able to read or write `drizzle.*`. That is
  -- also what makes `drizzle-kit migrate` as the app role fail loudly with
  -- "permission denied for schema drizzle" (42501) rather than appearing to work
  -- — see scripts/migrate-if-enabled.mjs, which is why MIGRATE_DATABASE_URL
  -- exists.
  REVOKE ALL ON SCHEMA drizzle FROM billing_app;

  EXECUTE 'ALTER ROLE billing_app SET search_path = platform, billing';

  RAISE INFO 'billing_app grants applied.';
END
$$;
