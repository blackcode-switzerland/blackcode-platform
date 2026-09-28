-- b/books, migration 0021 — a workspace can carry a logo (2026-09-28).
--
-- Every blackcode app shows and sets workspace logos the same way since this
-- date (the shared workspace kit, `@blackcode/platform-ui/workspace/*`), through
-- `POST /api/workspaces/{ws}/logo` — a logo-only upload, not a general one.
--
-- ---------------------------------------------------------------------------
-- THE COLUMN AND ITS TRIGGER LAND TOGETHER, OR NOT AT ALL
-- ---------------------------------------------------------------------------
-- A logo is an uploaded file, and every deployment's GC decides whether a file
-- may be deleted by asking `platform.blob_references`. A url that nothing
-- indexes reads as an ORPHAN and its bytes are destroyed — `del()` has no undo.
-- The index is maintained by triggers so no write path can forget it, which
-- leaves exactly one thing to forget: a new column without a trigger. So the
-- trigger is in the SAME migration as the column (CLAUDE.md, "Any new content
-- column that can hold a file URL…"; docs/adding-an-app.md step 4).
--
-- `exact` mode — the whole value is the url, as with a project logo — keyed by
-- the workspace's own `id` (`'id'` as the workspace column: a workspace row IS
-- the workspace). source_type `workspace_logo`, which no other trigger on this
-- table uses, so the two can never clear each other's rows.

ALTER TABLE "books"."workspaces" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs_logo ON "books"."workspaces";--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_logo
  AFTER INSERT OR DELETE OR UPDATE OF logo_url ON "books"."workspaces"
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('books', 'workspace_logo', 'id', 'exact', 'logo_url');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AND THE COVERAGE FLAG, RE-ASSERTED
-- ---------------------------------------------------------------------------
-- 0002 sets `platform.apps.maintains_blob_index = true` for books, and its own
-- header warns that if the app is registered AFTER it runs, the UPDATE matches
-- nothing and re-running cannot fix it. That is exactly the state a local
-- database was found in on 2026-09-28 (the catalog said `false`; the repo said
-- true). This migration is the first to put a FILE in a books column, so it is
-- the one that must not ship with the flag wrong. Idempotent; last, so it is
-- only true once the trigger above exists.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'books';
