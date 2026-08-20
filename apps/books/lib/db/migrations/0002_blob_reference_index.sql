-- b/books, migration 0002 — the blob-reference trigger and the coverage flag.
--
-- ===========================================================================
-- READ THIS BEFORE CHANGING ANYTHING. THE ORDER IS THE POINT.
-- ===========================================================================
-- `platform.blob_references` is how each app proves to the OTHERS which files it
-- still points at. A file nobody references may be deleted; a file this app
-- references must not be.
--
-- Three steps, and they DO NOT COMMUTE:
--
--   1. THE TRIGGER   — start recording references for every future write
--   2. THE BACKFILL  — record references for rows that already exist
--   3. THE FLAG      — `platform.apps.maintains_blob_index = true`: this app
--                      telling every other deployment "trust my index"
--
-- Set the flag before the backfill and you have advertised an EMPTY index as
-- authoritative. Every other deployment then believes no file is referenced
-- here, and the next garbage collection deletes files this app is using. There
-- is no undo. That is why the flag is the last statement in the file.
--
-- ===========================================================================
-- WHY b/books NEEDS THIS AT ALL, GIVEN IT STORES NO UPLOADS
-- ===========================================================================
-- b/books does not use Vercel Blob. Supporting documents are Google Drive
-- references (`drive_ref` + sha256), and `AppContext.uploads` throws rather than
-- recording anything (lib/api.ts). So this app's index will be empty.
--
-- The flag is still required, and NOT setting it is the dangerous option:
-- registering an app in `platform.apps` with `maintains_blob_index = false`
-- makes blob deletion refuse in EVERY deployment, because no app can then prove
-- a file is unused. Adding b/books would break file deletion for issues and
-- sales.
--
-- An empty index is honest here, and safe: garbage collection refuses a delete
-- if ANY app still references the file, so books answering "I reference nothing"
-- can never make another app's file deletable.
--
-- THE STANDING OBLIGATION THIS CREATES: if any future b/books column can hold an
-- uploaded file URL, it needs its trigger IN THE SAME MIGRATION as the column.
-- The flag says this index is authoritative; a column added without a trigger
-- makes that a lie, and nothing will remind you.
--
-- The trigger below covers `books.notes.body`, the scaffold's placeholder entity.
-- Phase 1 drops that table and its trigger. The flag stays true.
--
-- Re-runnable: the drop precedes the create, and the backfill converges.

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGER
-- ---------------------------------------------------------------------------
-- `UPDATE OF body` keeps the trigger off writes touching other columns.
-- `deleted_at` is deliberately NOT in the list: a soft delete assigns it, and
-- binning a restorable row must not drop its references.
--
-- `platform.blob_refs_sync` is platform-owned, created by issues' 0037. It is
-- NOT created here and must not be dropped by this app's rollback.
DROP TRIGGER IF EXISTS trg_blob_refs ON books.notes;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON books.notes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'books', 'note', 'workspace_id', 'scan', 'body');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. THE BACKFILL — rows written before the trigger existed
-- ---------------------------------------------------------------------------
-- A no-op UPDATE fires the AFTER UPDATE trigger: one implementation of the
-- extraction, not two. For a fresh app this is a no-op, and it stays here so the
-- file is correct if it is ever re-run against a populated database.
UPDATE books.notes SET body = body WHERE body IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2b. THE blob_refs_purge GRANT, WHICH A NEW APP OTHERWISE NEVER GETS
-- ---------------------------------------------------------------------------
-- Issues' 0038 revoked EXECUTE on `platform.blob_refs_purge` FROM PUBLIC and
-- granted it to each app role existing AT THAT MOMENT. Every app created since
-- arrives with none, and `bk super-admin blob-drift --repair` then cannot clear
-- an orphaned reference, failing with "permission denied for function" rather
-- than anything naming the problem.
--
-- Derived from `platform.apps` and skipped where the role does not exist.
--
-- ** THE SCAFFOLD'S COPY OF THIS COMMENT CLAIMS THAT MAKES IT "SAFE TO RUN IN
-- ANY ORDER RELATIVE TO ROLE PROVISIONING". IT IS NOT. ** Corrected here after
-- hitting it, 2026-08-17.
--
-- "Skipped" means the grant never happens, and re-running the migration will not
-- perform it because Drizzle records the migration as applied. Run this before
-- `books_app` exists and the role ends up with no EXECUTE on
-- `platform.blob_refs_purge` — a hole that LOOKS like a passing boundary probe,
-- because check (4d) then fails with "permission denied for function" instead of
-- the guard's own refusal, and a role granted nothing denies everything.
--
-- What actually went wrong here: this migration ran before the role existed.
-- Probe check (4e), "purging its OWN references", failed. Recovery is the
-- hand-written grant, which is what was done:
--
--   GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint)
--     TO books_app;
--
-- **So the order for a new app is: create the role, register it in
-- platform.apps, THEN migrate.** Two of the three steps in this file depend on
-- something existing beforehand, and neither dependency fails loudly.
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
-- 3. DECLARE COVERAGE — LAST, so it is only true once the index is built
-- ---------------------------------------------------------------------------
-- Guarded on the row existing: with no `platform.apps` row for this app yet this
-- updates nothing and stays correct, rather than inventing a row that would
-- register an app with no `base_url` and break `bk books` on every machine.
--
-- **If you register the app AFTER running this migration, the flag is never set
-- and re-running the migration will not fix it** — Drizzle records it as
-- applied. Recovery is a hand-written UPDATE. Register first.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'books';
