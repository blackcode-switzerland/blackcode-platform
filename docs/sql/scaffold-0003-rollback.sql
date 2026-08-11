-- Rollback for apps/_scaffold migration 0003 (multiAppFinalRefactor Phase 7).
--
-- Undoes: this app's own workspaces / workspace_members / invitations, and the
-- two foreign keys that moved off `platform.workspaces`.
--
-- ===========================================================================
-- \set ON_ERROR_STOP on IS NOT DECORATION
-- ===========================================================================
-- WITHOUT it, psql prints `ERROR:` and EXITS 0 — so a rollback that failed
-- halfway reports success and the operator moves on. Reproduced on demand:
--   without:  ERROR: ... does not exist / PSQL EXIT=0
--   with:     same ERROR                / PSQL EXIT=3
-- CLAUDE.md findings #7 and #15 are both this mechanism.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- READ THIS BEFORE RUNNING IT: WHEN THIS SCRIPT STOPS BEING SAFE
-- ---------------------------------------------------------------------------
-- `apps/_scaffold` is NEVER DEPLOYED, so in the repo's own environments these
-- tables are empty and this script is a no-op on data.
--
-- In a COPY of this app that has real users, it is not. Dropping
-- `<app>.workspaces` takes every membership and every invitation with it, and
-- the cascade below then takes every note. Run the count first and decide:
--
--   SELECT (SELECT count(*) FROM scaffold.workspaces)        AS workspaces,
--          (SELECT count(*) FROM scaffold.workspace_members) AS members,
--          (SELECT count(*) FROM scaffold.invitations)       AS invitations,
--          (SELECT count(*) FROM scaffold.notes)             AS notes;
--
-- Zero across the board: this is a structural undo. Anything else: this is data
-- loss with a reassuring filename, and the right move is a Vercel rollback of
-- the DEPLOY rather than a rollback of the MIGRATION — 0003 is additive apart
-- from the FK swap, so the previous release runs fine against this schema.

-- ---------------------------------------------------------------------------
-- 1. Put the two foreign keys back on platform.workspaces
-- ---------------------------------------------------------------------------
-- Matched by TARGET rather than by name, for the reason 0003's own header
-- records: 0001 is hand-written SQL, so Postgres named those constraints
-- `<table>_workspace_id_fkey` and not the Drizzle spelling. The first version of
-- 0003 dropped by name, matched nothing, and left BOTH keys in place.
--
-- This step FAILS LOUDLY if `scaffold.notes` holds a workspace_id that does not
-- exist in `platform.workspaces` — which is correct and is the whole reason to
-- read the counts above first. There is no safe automatic answer to "this note
-- belongs to a workspace the platform never had".
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('scaffold.notes'::regclass, 'scaffold.note_counters'::regclass)
      AND confrelid = 'scaffold.workspaces'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    RAISE NOTICE 'dropped % on %', c.conname, c.tbl;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notes_workspace_id_fkey' AND conrelid = 'scaffold.notes'::regclass
  ) THEN
    ALTER TABLE scaffold.notes
      ADD CONSTRAINT notes_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'note_counters_workspace_id_fkey'
      AND conrelid = 'scaffold.note_counters'::regclass
  ) THEN
    ALTER TABLE scaffold.note_counters
      ADD CONSTRAINT note_counters_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop this app's tenancy
-- ---------------------------------------------------------------------------
-- RESTRICT, not CASCADE, and in dependency order. An unexpected dependant makes
-- the drop FAIL rather than being taken silently with it — which is the same
-- assertion Postgres gives you for free and the reason Phase 5's table drops
-- deliberately omitted `CASCADE`.
DROP TABLE IF EXISTS scaffold.invitations RESTRICT;
DROP TABLE IF EXISTS scaffold.workspace_members RESTRICT;
DROP TABLE IF EXISTS scaffold.workspaces RESTRICT;

-- The `scaffold` schema itself is NOT dropped: 0001 created it along with
-- `notes` and `note_counters`, which this migration did not create and this
-- rollback must not remove.

COMMIT;
