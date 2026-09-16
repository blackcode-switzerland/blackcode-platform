-- Roll back b/billing migration 0003 — the app role's grants.
--
-- After this, `billing_app` can reach its schema and do nothing inside it. The
-- deployment answers 500 on every request that touches the database, which is
-- the intended effect of a rollback and worth saying out loud: this is how you
-- take the app off the air without dropping any data.
--
-- ── IT IS ALSO THE STATE b/books WAS ACCIDENTALLY IN ────────────────────────
-- Measured on 2026-08-17: zero privileges on any table in its own schema, zero
-- default privileges, and the phase 0 boundary probe passing anyway, because
-- every check in it was a denial and a role granted nothing denies everything
-- (CLAUDE.md finding #16). If you run this and then run the probe, expect it to
-- look fine. It is not fine. Read the POSITIVE checks — (1), (4a), (4e).
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
    RAISE NOTICE 'role billing_app does not exist: nothing to revoke.';
    RETURN;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM billing_app;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA billing FROM billing_app;
  REVOKE USAGE ON SCHEMA billing FROM billing_app;

  -- The default privileges too, or a table created after this rollback silently
  -- arrives with the grants this file just removed. `ALTER DEFAULT PRIVILEGES`
  -- applies per granting role, so this must run as the role that ran 0003 — the
  -- migrator.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA billing '
          'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM billing_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA billing '
          'REVOKE USAGE, SELECT ON SEQUENCES FROM billing_app';

  -- `search_path` is reset rather than left pointing at a schema the role can no
  -- longer read, which would make an ad-hoc query fail with a confusing
  -- "relation does not exist" instead of a permission error.
  EXECUTE 'ALTER ROLE billing_app RESET search_path';

  RAISE INFO 'billing_app in-schema grants revoked.';
END
$$;

-- NOT undone: the `platform.*` grants and the `blob_references` read. Those come
-- from docs/sql/billing-app-role.sql, not from this migration, and revoking them
-- here would mean two files fighting over the same privileges. Drop the role
-- entirely if that is what you want:
--
--   REASSIGN OWNED BY billing_app TO neondb_owner;  -- owns nothing, so a no-op
--   DROP OWNED BY billing_app;
--   DROP ROLE billing_app;
