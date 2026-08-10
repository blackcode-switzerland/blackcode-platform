-- The `sales_app` Postgres role — docs/adding-an-app.md step 2, filled in.
--
-- **THIS IS A HUMAN STEP.** Run it against Neon as `neondb_owner`, substituting
-- a generated password. Never commit a real one.
--
-- `docs/sql/app-role.sql` is the general template and explains WHY each grant
-- exists (read it first — particularly the split between the migrator and the
-- app role, and why the app must own nothing). This file is the same script with
-- `sales` substituted, so nobody has to do it under time pressure.
--
--   neondb_owner  the MIGRATOR. Owns both schemas and every table. Used by
--                 `drizzle-kit migrate`. Not used by the app.
--   sales_app     the APP role. DML only, owns nothing, so it cannot ALTER or
--                 DROP — including tables in `platform` that every other app
--                 depends on.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL, AND HERE IS WHAT IT COST TO LEARN.
-- ---------------------------------------------------------------------------
-- Rehearsed 2026-08-07 against a copy of the local database, in the order
-- the deploy runbook gave (role first, migrations later). That runbook was
-- archived on 2026-08-10 to ~/Documents/BAK/blackcode-platform-backups/;
-- `docs/adding-an-app.md` carries the ordering that survived it.
-- **Five of this file's ten statements failed and psql exited 0:**
--
--     psql:role.sql:18: ERROR:  role "sales_app" already exists   (rehearsal only)
--     psql:role.sql:22: ERROR:  schema "sales" does not exist
--     psql:role.sql:25: ERROR:  schema "sales" does not exist
--     psql:role.sql:30: ERROR:  schema "sales" does not exist
--     psql:role.sql:36: ERROR:  schema "sales" does not exist
--     psql:role.sql:38: ERROR:  schema "sales" does not exist
--     PSQL EXIT=0
--
-- Steps 2–5 are every grant this role has. Skipping them all leaves a LOGIN role
-- with no USAGE on any schema — the app cannot start, and the provisioning step
-- that was supposed to create it reported success. That is CLAUDE.md finding #7
-- (`psql` printing 27 errors and exiting 0) reproduced in a provisioning script,
-- by the third file in this directory to carry a warning about it.
--
-- Two fixes, both applied:
--   * `\set ON_ERROR_STOP on` below, so the failure is the exit code too.
--   * step 1b, which creates the schema this file always assumed was there.
--     `apps/issues` never hit it because `issues` was created by migration 0033
--     years before anyone wrote a role script for it.
\set ON_ERROR_STOP on

-- 1. The role.
CREATE ROLE sales_app LOGIN PASSWORD '<generated-password>';

-- 1b. The schema — **BEFORE the grants, because steps 2–5 all name it.**
--     `IF NOT EXISTS`, and migration 0001 opens with the same statement, so it
--     does not matter which of the two gets there first. Owned by the MIGRATOR;
--     the app role must own nothing.
CREATE SCHEMA IF NOT EXISTS sales AUTHORIZATION neondb_owner;

-- 2. Reach the schemas. USAGE alone grants nothing inside them.
--    NOTE `sales` and NOT `issues` — that omission IS the app boundary.
GRANT USAGE ON SCHEMA platform, sales TO sales_app;

-- 3. Data access. NO TRUNCATE, NO REFERENCES, NO TRIGGER — DML only.
--
--    `ON ALL TABLES` means "all tables that exist RIGHT NOW", and at this point
--    `sales` is empty — so this line grants exactly nothing in it and everything
--    in `platform`. That is correct and not a gap: step 5 is what covers the
--    seventeen tables migration 0001 is about to create. Verified in the
--    2026-08-07 rehearsal — after the migrations, with no re-grant of any kind,
--    `sales_app` could read `sales.prospects` and held USAGE on 10 of 10 new
--    sequences. **If you ever move this file to AFTER the migrations, step 5
--    still has to run; do not delete it because step 3 looks sufficient.**
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, sales TO sales_app;

-- 4. Sequences. Easy to forget, and the failure is confusing: every INSERT into
--    a table with a `serial` primary key fails with "permission denied for
--    sequence" even though the INSERT grant is present.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform, sales TO sales_app;

-- 5. Future objects, so the next migration does not create a table the app
--    cannot read. ALTER DEFAULT PRIVILEGES applies per granting role, so this
--    must run as the role that will create those objects — the migrator.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, sales
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sales_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, sales
  GRANT USAGE, SELECT ON SEQUENCES TO sales_app;

-- 5b. **DO NOT SKIP THIS.** The default privileges above hand every future
--     `platform` table full DML to the app role, and that is wrong for exactly
--     one table. `blob_references` is how each app proves to the OTHERS what
--     files it still points at; a role with DELETE on it could erase a rival
--     app's references, after which a delete that should have been refused goes
--     ahead and the bytes are gone. It is written only by the SECURITY DEFINER
--     triggers, so the app never needs to write it itself.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM sales_app;
GRANT SELECT ON platform.blob_references TO sales_app;

-- 5c. **ALSO NOT IN THE TEMPLATE, AND ALSO NOT OPTIONAL.** Issues' migration
--     0038 revoked EXECUTE on `platform.blob_refs_purge` from PUBLIC and granted
--     it to each app role that existed AT THAT MOMENT. `sales_app` did not, so
--     it arrives with no EXECUTE — and `bk super-admin blob-drift --repair`
--     cannot clear an ORPHANED reference (the one repair with no source row left
--     to re-trigger), failing with "permission denied for function" rather than
--     anything that names the problem.
--
--     Migration 0002 re-runs this loop for every app role, so applying the
--     migrations covers it. It is repeated here because provisioning happens
--     BEFORE the migrations and check (4e) of the boundary probe runs against
--     whatever state the role is in when you run it.
GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO sales_app;

-- 6. A safety net, not the mechanism. Drizzle writes every table
--    schema-qualified; this only stops an unqualified ad-hoc query from silently
--    finding nothing. `public` is deliberately absent, and so is `issues`.
ALTER ROLE sales_app SET search_path = platform, sales;

-- 7. The app must never migrate. With no rights on the Drizzle ledger, a stray
--    `drizzle-kit migrate` under the app credentials fails loudly instead of
--    half-applying.
REVOKE ALL ON SCHEMA drizzle FROM sales_app;

-- ---------------------------------------------------------------------------
-- THEN PROVE IT, AS THE NEW ROLE — **AFTER THE MIGRATIONS, NOT NOW.**
-- ---------------------------------------------------------------------------
--   psql "postgres://sales_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
--
-- The probe needs the schema to have TABLES: its check (1) reads one, and its
-- check (4e) purges this app's own references. Run at this point, with `sales`
-- freshly created and empty, it reports `(1) FAILED: schema sales has no tables`
-- and then denies the rest for the wrong reason. See the probe's own header —
-- the rehearsal that found this is written up there, because that is where
-- somebody about to run it will be standing.
--
-- Every deny must be `42501`. `SET ROLE` from the owner is NOT a substitute and
-- quietly gives the wrong answer: `session_user` ignores SET ROLE by design, and
-- inside a SECURITY DEFINER function `current_user` is the function's owner
-- rather than the caller. That exact mistake is why the probe exists —
-- `platform.blob_refs_purge` guarded on `current_user` and was therefore true
-- for everybody, so any app could purge any other app's blob references.
--
-- **Check (2) of the probe runs for real for the first time with this role.**
-- Until now `issues` was the only app schema, so it reported SKIPPED. It should
-- now find `sales.prospects` from the app registry and be REFUSED. If it still
-- says SKIPPED, something is wrong with `platform.apps`, not with the probe.
--
-- These assertions must each return zero rows:
--
--   -- (a) the app role owns nothing
--   SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--   WHERE r.rolname = 'sales_app';
--
--   -- (b) no DDL-implying privilege anywhere
--   SELECT table_schema, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE grantee = 'sales_app'
--     AND privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE');
--
--   -- (c) it cannot see the other app, in either direction
--   --     as sales_app:  SELECT * FROM issues.issues LIMIT 1;   -> 42501
--   --     as issues_app: SELECT * FROM sales.prospects LIMIT 1; -> 42501
--
-- (c) is the one people run in one direction only. `issues_app` was granted
-- `USAGE ON SCHEMA platform, issues` before `sales` existed, so it has no reach
-- into the new schema — but the default privileges in step 5 are per-schema and
-- it costs nothing to confirm rather than assume.
