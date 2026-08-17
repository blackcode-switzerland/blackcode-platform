-- Rollback for apps/books migration 0005 — take back the app role's grants.
--
-- Runs after books-0006-rollback.sql in the reverse walk.
--
-- ---------------------------------------------------------------------------
-- WHAT STATE THIS RETURNS TO, SAID PLAINLY
-- ---------------------------------------------------------------------------
-- The state 0005 was written to fix: `books_app` with ZERO privileges in its
-- own schema — the measured pre-0005 condition its header documents, the one
-- the boundary probe passed anyway because every check was a negative
-- (Finding #16). A production app running against this state serves nothing.
--
-- So this file is for exactly two situations: a full teardown (walking down to
-- 0001), or rebuilding the role's grants from scratch before replaying 0005.
-- It is not a security hardening — the role already cannot DDL anything.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DELIBERATELY LEAVES ALONE
-- ---------------------------------------------------------------------------
-- Everything platform-side. USAGE on `platform`, the platform table grants,
-- the `blob_references` carve-out, the `blob_refs_purge` EXECUTE and the
-- search_path all come from provisioning (docs/sql/books-app-role.sql), not
-- from 0005 — 0005 only RE-ASSERTED the blob_references revoke. Undoing
-- provisioning is role teardown, and books-0001-rollback.sql's closing note
-- covers it.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    RAISE WARNING 'role books_app does not exist: nothing to revoke. Skipping.';
    RETURN;
  END IF;

  -- The default privileges first: they are what makes new tables reachable,
  -- and 0005 created them for schema books only.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA books '
          'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM books_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA books '
          'REVOKE USAGE, SELECT ON SEQUENCES FROM books_app';

  -- Then everything already granted in the schema. This also swallows 0005's
  -- per-table REVOKEs (DELETE on the ledger, writes on statement_position):
  -- revoking ALL leaves nothing for them to have carved out of.
  REVOKE ALL ON ALL TABLES IN SCHEMA books FROM books_app;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA books FROM books_app;
  REVOKE USAGE ON SCHEMA books FROM books_app;

  RAISE INFO 'books_app in-schema grants revoked. The role can now do NOTHING in schema books.';
END
$do$;

COMMIT;

-- Verify — both must return 0 rows:
--   SELECT table_name, privilege_type FROM information_schema.table_privileges
--    WHERE table_schema = 'books' AND grantee = 'books_app';
--   SELECT * FROM pg_default_acl a JOIN pg_namespace n ON n.oid = a.defaclnamespace
--    WHERE n.nspname = 'books';
--
-- Ledger bookkeeping as in books-0007-rollback.sql's closing note.
