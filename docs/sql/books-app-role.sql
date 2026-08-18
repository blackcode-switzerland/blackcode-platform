-- The `books_app` Postgres role — docs/adding-an-app.md step 2, filled in.
--
-- **THIS IS A HUMAN STEP.** Run it against Neon as `neondb_owner`, substituting
-- a generated password. Never commit a real one.
--
-- `docs/sql/app-role.sql` is the general template and explains WHY each grant
-- exists. **Do not run the template for this app**: its second half carries
-- literal `issues` / `issues_app` names (lines 82-109), so running it for a new
-- app silently configures issues instead. That is not hypothetical — it is how
-- `books_app` reached phase 1 with ZERO privileges in its own schema and the
-- boundary probe passing anyway, because a role granted nothing denies
-- everything (migration 0005's header, and Finding #16). This file is the
-- substituted version, so nobody has to do the substitution under time pressure.
--
--   neondb_owner  the MIGRATOR. Owns both schemas and every table. Used by
--                 `drizzle-kit migrate`. Not used by the app.
--   books_app     the APP role. DML only, owns nothing, so it cannot ALTER or
--                 DROP — including tables in `platform` that every other app
--                 depends on.
--
-- ---------------------------------------------------------------------------
-- THE ORDER: role (this file) → register part 1 → migrate → register part 2
-- ---------------------------------------------------------------------------
-- Two of books' migrations depend on this role already existing, and NEITHER
-- fails loudly if it does not:
--
--   0002  grants EXECUTE on platform.blob_refs_purge to every `<slug>_app` role
--         that exists at that moment — a missing role is silently skipped
--   0005  grants the in-schema DML (see below) — a missing role raises a
--         WARNING, not an error, and the migration is still recorded as applied
--
-- A grant skipped this way is not fixed by re-running: Drizzle records the
-- migration applied. Recovery is replaying 0005 by hand. Run this file first.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL.
-- ---------------------------------------------------------------------------
-- The sales copy of this file watched five of its ten statements fail while
-- psql exited 0, leaving a LOGIN role with no USAGE anywhere (its header, and
-- CLAUDE.md finding #7). Same fix here: the failure must be the exit code.
\set ON_ERROR_STOP on

-- 1. The role.
CREATE ROLE books_app LOGIN PASSWORD '<generated-password>';

-- 1b. The schema — BEFORE the grants, because they name it. `IF NOT EXISTS`,
--     and migration 0001 opens with the same statement, so it does not matter
--     which of the two gets there first. Owned by the MIGRATOR; the app role
--     must own nothing.
CREATE SCHEMA IF NOT EXISTS books AUTHORIZATION neondb_owner;

-- 2. Reach the schemas. USAGE alone grants nothing inside them.
--    NOTE `books` and NOT `issues` or `sales` — that omission IS the app
--    boundary.
GRANT USAGE ON SCHEMA platform, books TO books_app;

-- 3. Data access on the SHARED schema. NO TRUNCATE, NO REFERENCES, NO TRIGGER —
--    DML only.
--
--    ── `books` IS DELIBERATELY ABSENT FROM THIS GRANT, UNLIKE SALES' FILE ────
--    The in-schema grants for books live in MIGRATION 0005, not here, and the
--    difference is load-bearing. 0005 grants DML and then REVOKES DELETE on the
--    seven ledger tables (art. 958f) and all writes on `statement_position`
--    (the law is not runtime-editable). A blanket `GRANT ... ON ALL TABLES IN
--    SCHEMA books` in this file would be harmless on a fresh database (the
--    schema is empty) — and would UNDO those revokes if anybody ever re-ran
--    this file against a migrated one. Provisioning must be idempotent against
--    a live database, so the grant that would break that is not in it.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO books_app;

-- 4. Sequences, same scope, same reason as sales: without this every INSERT
--    into a serial-keyed platform table fails with "permission denied for
--    sequence" even though the INSERT grant is present.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO books_app;

-- 5. Future PLATFORM objects. Books-schema default privileges are 0005's, per
--    the note on step 3. ALTER DEFAULT PRIVILEGES applies per granting role, so
--    this must run as the role that creates those objects — the migrator.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO books_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT USAGE, SELECT ON SEQUENCES TO books_app;

-- 5b. **DO NOT SKIP THIS.** Step 3 handed every platform table full DML, and
--     that is wrong for exactly one. `blob_references` is how each app proves
--     to the OTHERS what files it still points at; a role with DELETE on it
--     could erase a rival app's references, after which a delete that should
--     have been refused goes ahead and the bytes are gone. It is written only
--     by the SECURITY DEFINER triggers. b/books holds NO uploads at all
--     (Google Drive references only, 0007's header) and still gets SELECT:
--     read-only is the boundary, not absence.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM books_app;
GRANT SELECT ON platform.blob_references TO books_app;

-- 5c. blob_refs_purge, which a new app role otherwise never gets: issues' 0038
--     granted EXECUTE to the roles existing at that moment. Books' 0002 re-runs
--     the loop for every role, so migrating covers it — IF the role exists by
--     then, which is this file's job. Granted here too because provisioning
--     happens before the migrations and the boundary probe's check (4e) runs
--     against whatever state the role is in.
GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO books_app;

-- 6. A safety net, not the mechanism. Drizzle writes every table
--    schema-qualified; this only stops an unqualified ad-hoc query from
--    silently finding nothing. `public` is deliberately absent, and so are
--    `issues` and `sales`.
ALTER ROLE books_app SET search_path = platform, books;

-- 7. The app must never migrate. With no rights on the Drizzle ledger, a stray
--    `drizzle-kit migrate` under the app credentials fails loudly instead of
--    half-applying.
REVOKE ALL ON SCHEMA drizzle FROM books_app;

-- ---------------------------------------------------------------------------
-- THEN PROVE IT, AS THE NEW ROLE — **AFTER THE MIGRATIONS, NOT NOW.**
-- ---------------------------------------------------------------------------
-- Two probes for this app, and both are needed:
--
--   psql "postgres://books_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
--   psql "postgres://books_app:<pw>@<host>/<db>" -f docs/sql/books-guard-probe.sql
--
-- The boundary probe proves the role stops at the app boundary. The guard probe
-- proves the STATUTORY rules hold for this role — and it contains the positive
-- cases (a staged entry CAN be edited, entry 1009-style resolution works), which
-- is what makes it immune to the all-negatives failure this file's header
-- describes: a role with no privileges at all FAILS the guard probe.
--
-- Run them before the migrations and both report failure for the wrong reason —
-- the schema has no tables yet. After, every deny must be `42501` and every
-- positive case must succeed. `SET ROLE` from the owner is NOT a substitute
-- (see sales-app-role.sql for the SECURITY DEFINER trap that rule comes from).
--
-- And the two assertions that catch a mis-provisioned role in one query each:
--
--   -- (a) the app role owns nothing
--   SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--   WHERE r.rolname = 'books_app';                                   -- 0 rows
--
--   -- (b) no DDL-implying privilege anywhere
--   SELECT table_schema, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE grantee = 'books_app'
--     AND privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE'); -- 0 rows
--
--   -- (c) DELETE is absent on the ledger even though 0005 granted DML broadly
--   SELECT table_name FROM information_schema.table_privileges
--   WHERE grantee = 'books_app' AND table_schema = 'books'
--     AND privilege_type = 'DELETE';
--   -- must NOT list: entry, entry_line, ri_entry, patrimoine, account,
--   -- opening_balance, exercice, statement_position
