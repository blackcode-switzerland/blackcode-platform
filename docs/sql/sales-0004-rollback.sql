-- Rollback for apps/sales migration 0004 — point the twelve foreign keys back
-- at `platform.workspaces`.
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on. NOT OPTIONAL — without it psql prints every error and
-- still exits 0, and a rollback that failed every statement reports success
-- (CLAUDE.md findings #7 and #15). Watched failing before this header was
-- written; see the phase-2 reply.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- WHEN THIS WORKS, AND THE ONE THING THAT MAKES IT FAIL
-- ---------------------------------------------------------------------------
-- 0004 mirrored ids rather than remapping them, so every `workspace_id` in a
-- sales table is *simultaneously* valid against both parents on the day it
-- runs. That is what makes this file a pure constraint swap in reverse.
--
-- It stops being true the moment `sales.workspaces` gains a row that
-- `platform.workspaces` does not have — which is the first-sign-in bootstrap
-- this same phase adds. From then on, re-pointing a FK at `platform.workspaces`
-- will fail on any sales row belonging to a sales-only workspace, LOUDLY, with
-- the offending constraint named. That failure is correct and must not be
-- worked around by deleting the rows.
--
-- Run this FIRST and read it. Anything other than an empty result means the
-- swap back cannot succeed and you want a Neon branch restore instead:
--
--   SELECT w.id, w.slug
--   FROM sales.workspaces w
--   LEFT JOIN platform.workspaces p ON p.id = w.id
--   WHERE p.id IS NULL;
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not delete the mirrored rows from `sales.workspaces` /
-- `sales.workspace_members`, and it does not rewind the sequence.
--
-- Deleting them would be this refactor's only undeclared delete, and rewinding
-- a sequence hands out an id that is already in use. Both are also unnecessary:
-- with the FKs pointed back at platform, the mirrored rows are inert — exactly
-- the empty-and-unread state 0003 left behind. If you genuinely want them gone,
-- that is `sales-0003-rollback.sql`, and read ITS header first.
--
-- Usual case: none of this. 0004 changes no application behaviour on its own,
-- so a bad deploy is a Vercel Instant Rollback and nothing here.

ALTER TABLE sales.prospects DROP CONSTRAINT IF EXISTS prospects_workspace_id_fkey;
ALTER TABLE sales.prospects ADD CONSTRAINT prospects_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.contacts DROP CONSTRAINT IF EXISTS contacts_workspace_id_fkey;
ALTER TABLE sales.contacts ADD CONSTRAINT contacts_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.counters DROP CONSTRAINT IF EXISTS counters_workspace_id_fkey;
ALTER TABLE sales.counters ADD CONSTRAINT counters_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.documents DROP CONSTRAINT IF EXISTS documents_workspace_id_fkey;
ALTER TABLE sales.documents ADD CONSTRAINT documents_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.matches DROP CONSTRAINT IF EXISTS matches_workspace_id_fkey;
ALTER TABLE sales.matches ADD CONSTRAINT matches_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.meetings DROP CONSTRAINT IF EXISTS meetings_workspace_id_fkey;
ALTER TABLE sales.meetings ADD CONSTRAINT meetings_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.objections DROP CONSTRAINT IF EXISTS objections_workspace_id_fkey;
ALTER TABLE sales.objections ADD CONSTRAINT objections_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.products DROP CONSTRAINT IF EXISTS products_workspace_id_fkey;
ALTER TABLE sales.products ADD CONSTRAINT products_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.stage_entries DROP CONSTRAINT IF EXISTS stage_entries_workspace_id_fkey;
ALTER TABLE sales.stage_entries ADD CONSTRAINT stage_entries_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.templates DROP CONSTRAINT IF EXISTS templates_workspace_id_fkey;
ALTER TABLE sales.templates ADD CONSTRAINT templates_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.communications DROP CONSTRAINT IF EXISTS communications_workspace_id_fkey;
ALTER TABLE sales.communications ADD CONSTRAINT communications_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;

ALTER TABLE sales.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_workspace_id_fkey;
ALTER TABLE sales.user_preferences ADD CONSTRAINT user_preferences_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES platform.workspaces(id) ON DELETE CASCADE;
