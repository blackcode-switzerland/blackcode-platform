-- b/issues, migration 0049 — workspace logos join the blob-reference index.
--
-- `platform.workspaces.logo_url` has held uploaded images since the baseline,
-- and NOTHING indexed it: migration 0037 put triggers on every content table
-- and 0047 on project logos, and the workspace logo was missed. Found
-- 2026-09-28 while giving every app workspace logos. Until now a workspace logo
-- was protected only by this app's scanner — which the GC consults for THIS
-- deployment, but not for the others, which ask the index.
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

-- `platform.workspaces` is this app's table (CLAUDE.md: platform.* is not a
-- synonym for "shared"), so this app maintains its index.

DROP TRIGGER IF EXISTS trg_blob_refs_logo ON platform.workspaces;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_logo
  AFTER INSERT OR DELETE OR UPDATE OF logo_url ON platform.workspaces
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'workspace_logo', 'id', 'exact', 'logo_url');--> statement-breakpoint

-- Backfill: assign the column to itself, so the trigger computes the entry for
-- every workspace that already has a logo, by the code that will maintain it.
UPDATE platform.workspaces SET logo_url = logo_url WHERE logo_url IS NOT NULL;
