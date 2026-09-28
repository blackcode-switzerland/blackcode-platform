-- b/issues, migration 0050 — uploaded profile photos join the blob-reference index.
--
-- `platform.users.avatar_url` holds an uploaded image once somebody uploads a
-- photo (`POST /api/upload` then `PATCH /api/me`, and since 2026-09-28 the
-- narrow `POST /api/me/avatar`). NOTHING indexed it — no trigger, and no app's
-- scanner reads `platform.users` — so every deployment's clean-up saw an
-- uploaded avatar as an orphan and could delete a photo still in use. Found
-- 2026-09-28, the same day and by the same question as workspace logos
-- (migration 0049).
--
-- ATTRIBUTED TO 'platform', like `platform.comments` (0037): the row is shared
-- by every app and written from any of them, so its references belong to no
-- single app, and the delete gate always consults 'platform'. Maintained from
-- THIS app's migrations because apps/issues is the app that migrates the shared
-- platform tables.
--
-- `exact` mode: the whole value is the url. A Google photo (an external url) is
-- not an uploaded asset and `blob_refs_sync` ignores it. No workspace: a person
-- is not in one, and `workspace_id` is absent from the row, so the reference's
-- workspace is NULL.

DROP TRIGGER IF EXISTS trg_blob_refs_avatar ON platform.users;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_avatar
  AFTER INSERT OR DELETE OR UPDATE OF avatar_url ON platform.users
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('platform', 'user_avatar', 'workspace_id', 'exact', 'avatar_url');--> statement-breakpoint

-- Backfill every avatar already on file, through the trigger that will maintain it.
UPDATE platform.users SET avatar_url = avatar_url WHERE avatar_url IS NOT NULL;
