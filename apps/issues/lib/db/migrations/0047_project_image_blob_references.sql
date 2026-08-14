-- Project logo/banner become a SEVENTH blob-reference surface.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS AT ALL
-- ---------------------------------------------------------------------------
-- `issues.projects.icon_url` and `banner_url` have been columns since the
-- baseline, but nothing ever WROTE them: `updateProject` did not copy either
-- field out of its patch, so the settings modal's uploads were dropped on every
-- save (fixed 2026-08-13, same change as this file).
--
-- The moment they start holding real urls they become a delete hazard. Both the
-- GC (`platform-storage/gc.ts`) and the owner-facing Storage delete gate on
-- `isUrlReferencedAnywhere`, which consults the scanners and this index. A url
-- that neither knows about reads as an ORPHAN, and an orphan gets its bytes
-- destroyed with no undo. So the column and the trigger have to land together —
-- shipping the write path first would open a window in which every project logo
-- is deletable while in use.
--
-- ---------------------------------------------------------------------------
-- WHY A SECOND TRIGGER RATHER THAN MORE COLUMNS ON THE FIRST
-- ---------------------------------------------------------------------------
-- `trg_blob_refs` on this table runs in `scan` mode over `summary, description`:
-- rich text, from which urls are EXTRACTED. An image column is the other kind —
-- the whole value is the url — which is `exact` mode, the mode
-- `issues.attachments.file_url` already uses. `blob_refs_sync` takes one mode
-- per trigger, so these columns need their own.
--
-- Two triggers on one table are safe here because `blob_refs_sync` scopes its
-- DELETE by `(app, source_type, source_id)`: with a distinct `source_type` the
-- two cannot delete each other's rows. That is why this one is `project_image`
-- and not `project`. Sharing the type would make each trigger clear the other's
-- references on every write — the bug would look like intermittent orphaning.

DROP TRIGGER IF EXISTS trg_blob_refs_images ON issues.projects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_images
  AFTER INSERT OR DELETE OR UPDATE OF icon_url, banner_url ON issues.projects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'project_image', 'workspace_id', 'exact', 'icon_url', 'banner_url');--> statement-breakpoint

-- Backfill: assign the columns to themselves so the trigger computes the index
-- entry for every row that already has an image, using the same code path that
-- will maintain it. `UPDATE OF` fires on ASSIGNMENT, not on the value changing,
-- so this is a no-op for rows with no urls and correct for the rest.
--
-- Guarded on IS NOT NULL only as an optimisation; the trigger is idempotent.
UPDATE issues.projects
   SET icon_url = icon_url, banner_url = banner_url
 WHERE icon_url IS NOT NULL OR banner_url IS NOT NULL;--> statement-breakpoint
