-- b/billing, migration 0002 — the blob-reference coverage flag, and the grant a
-- new app otherwise never gets.
--
-- ===========================================================================
-- THIS APP REFERENCES NO UPLOADED FILES, AND THE FLAG IS STILL REQUIRED
-- ===========================================================================
-- `platform.blob_references` is how each app proves to the OTHERS which files it
-- still points at. A file nobody references may be deleted; a file this app
-- references must not be.
--
-- b/billing stores no uploads. There is no `/api/upload` route,
-- `AppContext.uploads` throws rather than recording anything (lib/api.ts), the
-- company logo is initials plus a colour, and the invoice PDF is regenerated on
-- demand byte-stably rather than archived (position P10). So this app's index is
-- empty, and there is **no trigger to install and no backfill to run** — which
-- is why this file is much shorter than `apps/books`' 0002, which it is adapted
-- from.
--
-- ── NOT SETTING THE FLAG IS THE DANGEROUS OPTION ────────────────────────────
-- Registering an app in `platform.apps` with `maintains_blob_index = false`
-- makes blob deletion refuse in EVERY deployment, because no app can then prove
-- a file is unused. Adding b/billing without this flag would break file deletion
-- for issues, sales and books.
--
-- An empty index is honest here, and it is safe: garbage collection refuses a
-- delete if ANY app still references the file, so billing answering "I reference
-- nothing" can never make another app's file deletable.
--
-- ── THE STANDING OBLIGATION THIS CREATES ────────────────────────────────────
-- If any future b/billing column can hold an uploaded file URL, it needs its
-- `platform.blob_refs_sync` trigger IN THE SAME MIGRATION as the column. The
-- flag says this index is authoritative; a column added without a trigger makes
-- that a lie, and nothing will remind you. The candidate is a real company logo
-- asset, which phase 0 deliberately does not build.
--
-- ===========================================================================
-- THE ORDER, AND WHY THE SCAFFOLD'S COMMENT ON IT IS WRONG
-- ===========================================================================
-- **The scaffold's copy of this file claims the purge grant below is "safe to
-- run in any order relative to role provisioning". It is not.** `apps/books`
-- corrected that on 2026-08-17 after hitting it, and this file carries the
-- correction rather than the claim.
--
-- "Skipped" means the grant never happens, and re-running the migration will not
-- perform it, because Drizzle records the migration as applied. Run this before
-- `billing_app` exists and the role ends up with no EXECUTE on
-- `platform.blob_refs_purge` — a hole that LOOKS like a passing boundary probe,
-- because check (4d) then fails with "permission denied for function" instead of
-- the guard's own refusal, and a role granted nothing denies everything
-- (CLAUDE.md finding #16).
--
-- Same for the flag: with no `platform.apps` row the UPDATE matches nothing,
-- stays correct, and never runs again.
--
-- **So the order for a new app is: create the role, register it in
-- platform.apps, THEN migrate.** Both statements in this file depend on
-- something existing beforehand and neither dependency fails loudly. The order
-- is written out in docs/billing-app-plan/local-database.md; three docs in this
-- repo used to disagree about it and docs/platform-db.md was corrected in this
-- phase.

-- ---------------------------------------------------------------------------
-- 1. THE blob_refs_purge GRANT
-- ---------------------------------------------------------------------------
-- Issues' 0038 revoked EXECUTE on `platform.blob_refs_purge` FROM PUBLIC and
-- granted it to each app role existing AT THAT MOMENT. Every app created since
-- arrives with none, and `bk super-admin blob-drift --repair` then cannot clear
-- an orphaned reference, failing with "permission denied for function" rather
-- than anything naming the problem.
--
-- Derived from `platform.apps` and skipped where the role does not exist. If it
-- was skipped, the recovery is the hand-written grant:
--
--   GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint)
--     TO billing_app;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
      FROM platform.apps a
     WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.slug || '_app')
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO %I',
      r.role_name);
  END LOOP;
END
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. DECLARE COVERAGE — LAST, so it is only true once there is an index to
--    declare. Here there is nothing to build, and the statement is still last:
--    the file's shape is the one every app copies, and an app that DOES install
--    a trigger must have it before this line.
-- ---------------------------------------------------------------------------
-- Guarded by the WHERE clause on the row existing: with no `platform.apps` row
-- for this app yet this updates nothing and stays correct, rather than inventing
-- a row that would register an app with no `base_url` and break `bk billing` on
-- every machine.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'billing';
