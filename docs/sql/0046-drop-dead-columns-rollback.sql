-- Rollback for migration 0046 — `workspace_invitations.app` and
-- `error_events.workspace_id`.
--
-- ###########################################################################
-- READ THIS BEFORE RUNNING IT: THIS RESTORES STRUCTURE, NOT DATA.
-- ###########################################################################
-- 0046 DROPPED two columns. Dropping a column destroys its values, and no
-- script can bring them back. What this file gives you is two columns of the
-- right name, type and nullability, containing NULL in every row.
--
-- For `error_events.workspace_id` that is a complete restoration, and 0046's
-- own gate is why: it REFUSES to run unless every row is already NULL, so
-- "NULL in every row" is exactly the state it destroyed. Nothing was lost.
--
-- For `workspace_invitations.app` it is NOT. Historical rows carried the app an
-- invitee was invited into, before Phase 5 removed the grants those values
-- drove. **Those values are gone.** If you need them, restore the Neon branch
-- taken before the phase (SAFETY.md) — that is what the branch is for. This
-- script is for the case where you need the SHAPE back, e.g. to redeploy code
-- that predates 0046.
--
-- ---------------------------------------------------------------------------
-- WHAT ORDER TO USE
-- ---------------------------------------------------------------------------
-- Undoing the CODE (a Vercel Instant Rollback to a deployment that predates
-- Phase 8) does not need this file at all. Neither column had a reader, and the
-- two writers wrote a constant: `routes/invitations.ts` passed `app: null` and
-- `safeLog` never mentioned `workspace_id`. Older code inserting a row that
-- names a column which no longer exists WOULD fail — but no such code exists in
-- any deployment after Phase 5, which is what makes the drop safe to ship on
-- its own.
--
-- Run this only if you are undoing the MIGRATION, and read the paragraph above
-- about what you get back.
--
-- `\set ON_ERROR_STOP on` is not optional here. Without it psql reports success
-- after failing every statement — CLAUDE.md findings #7 and #15.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- workspace_invitations.app
-- ---------------------------------------------------------------------------
-- varchar(40) matching `platform.apps.slug`, nullable, with the same
-- `ON DELETE set null` FK it had: deregistering an app must not delete the
-- invitations that named it.
ALTER TABLE platform.workspace_invitations
  ADD COLUMN IF NOT EXISTS app varchar(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'platform.workspace_invitations'::regclass
      AND contype  = 'f'
      AND confrelid = 'platform.apps'::regclass
  ) THEN
    -- Matched on `confrelid` — the table the FK POINTS AT — and not on a
    -- constraint name. CLAUDE.md finding #20 is exactly this mistake made the
    -- other way round: a guard keyed on Drizzle's spelling
    -- (`..._workspaces_id_fk`) matched nothing, because Postgres had named the
    -- constraint itself (`..._fkey`), so the DROP silently did nothing and the
    -- table ended up carrying both keys. Every statement succeeded, psql exited
    -- 0, and it was found by reading pg_constraint afterwards.
    ALTER TABLE platform.workspace_invitations
      ADD CONSTRAINT workspace_invitations_app_apps_slug_fk
      FOREIGN KEY (app) REFERENCES platform.apps(slug) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- error_events.workspace_id
-- ---------------------------------------------------------------------------
-- integer, nullable, and deliberately NO foreign key — it never had one. The
-- error log must survive the deletion of whatever it names; a row recording why
-- something broke is worth more than its referential tidiness.
ALTER TABLE platform.error_events
  ADD COLUMN IF NOT EXISTS workspace_id integer;

COMMIT;

-- ---------------------------------------------------------------------------
-- CHECK THE CATALOG, NOT THIS FILE'S EXIT CODE.
-- ---------------------------------------------------------------------------
-- Both columns should be listed, and the FK should point at platform.apps.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_schema, table_name, column_name) IN
      (('platform', 'workspace_invitations', 'app'),
       ('platform', 'error_events', 'workspace_id'))
ORDER BY table_name;

SELECT conname, confrelid::regclass AS references
FROM pg_constraint
WHERE conrelid = 'platform.workspace_invitations'::regclass
  AND contype = 'f'
ORDER BY conname;
