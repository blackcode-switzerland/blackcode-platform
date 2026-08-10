-- b/sales, migration 0004 — this app's domain tables stop pointing at
-- `platform.workspaces` and point at `sales.workspaces` instead.
--
-- The multi-app refactor's Phase 2 (multiAppFinalRefactor/PLAN.md §5).
--
-- ===========================================================================
-- THIS MIGRATION DELETES NOTHING. NOT ONE ROW.
-- ===========================================================================
-- Phase 3 is the only phase that deletes, and that property is what makes
-- "where did the row go?" answerable. So this MIRRORS rather than moves:
--
--   1. copy every `platform.workspaces` row this app actually uses into
--      `sales.workspaces`, PRESERVING THE ID
--   2. copy the matching `platform.workspace_members` rows
--   3. advance `sales.workspaces`' sequence past the highest copied id
--   4. swap each foreign key from `platform.workspaces` to `sales.workspaces`
--
-- Preserving the id is what makes step 4 a catalog change with NO data
-- movement: every `workspace_id` already in a sales table is still valid, so
-- the new constraint validates against rows that were never touched.
--
-- The two tables DRIFT from here, and that is the point. After this, a
-- person's issues workspace and their sales workspace are different things
-- that happen to share an id today.
--
-- ===========================================================================
-- WHICH WORKSPACES GET MIRRORED — DERIVED, NEVER LISTED
-- ===========================================================================
-- Two sources, unioned:
--
--   (a) every `workspace_id` appearing in any of the twelve sales tables.
--       This set is not optional: a row the FK swap could not validate would
--       fail the migration, which is the correct failure but a preventable one.
--   (b) every workspace with `sales` enabled in `platform.workspace_apps`.
--       These are the workspaces a person can open this app in TODAY. Omitting
--       one would sign them out of an app they have access to — the gate
--       `app/dashboard/layout.tsx` used to show is removed in this same phase,
--       so membership is the only thing left that lets them in.
--
-- Nothing is hardcoded. The production numbers (one workspace, id 1) are a
-- fact about today, and a migration that encoded them would be a migration
-- that silently mirrors the wrong set the day they change.
--
-- ===========================================================================
-- `sales.prospect_labels -> platform.labels` IS NOT TOUCHED
-- ===========================================================================
-- It is the thirteenth FK and it belongs to Phase 3, with the rest of labels.
-- Swapping it here would require `sales.labels` to be populated, and this
-- phase does not move label data.
--
-- Re-runnable: the inserts are ON CONFLICT DO NOTHING, the sequence is only
-- ever advanced, and each constraint swap is DROP IF EXISTS + ADD.
-- Rollback: docs/sql/sales-0004-rollback.sql.

-- ---------------------------------------------------------------------------
-- 1 + 2. Mirror the workspaces this app uses, and their memberships.
-- ---------------------------------------------------------------------------
-- `OVERRIDING SYSTEM VALUE` is not needed — `id` is a plain `serial`, not an
-- identity column — but the explicit id list is, and it is the whole trick.
INSERT INTO sales.workspaces (id, name, slug, owner_id, created_at, updated_at)
SELECT w.id, w.name, w.slug, w.owner_id, w.created_at, w.updated_at
FROM platform.workspaces w
WHERE w.id IN (
  SELECT workspace_id FROM sales.prospects
  UNION SELECT workspace_id FROM sales.contacts
  UNION SELECT workspace_id FROM sales.counters
  UNION SELECT workspace_id FROM sales.documents
  UNION SELECT workspace_id FROM sales.matches
  UNION SELECT workspace_id FROM sales.meetings
  UNION SELECT workspace_id FROM sales.objections
  UNION SELECT workspace_id FROM sales.products
  UNION SELECT workspace_id FROM sales.stage_entries
  UNION SELECT workspace_id FROM sales.templates
  UNION SELECT workspace_id FROM sales.communications
  UNION SELECT workspace_id FROM sales.user_preferences
  UNION SELECT workspace_id FROM platform.workspace_apps WHERE app = 'sales'
)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

INSERT INTO sales.workspace_members (workspace_id, user_id, role, joined_at)
SELECT m.workspace_id, m.user_id, m.role, m.joined_at
FROM platform.workspace_members m
WHERE m.workspace_id IN (SELECT id FROM sales.workspaces)
ON CONFLICT (workspace_id, user_id) DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Advance the sequence past every id we borrowed — AND past every id
--    `platform.workspaces` will plausibly reach.
-- ---------------------------------------------------------------------------
-- The first half is obvious: without it the next `INSERT INTO sales.workspaces`
-- — the first-sign-in bootstrap this phase adds — collides with a mirrored id.
--
-- ===========================================================================
-- THE `+ 1000` IS THE IMPORTANT PART, AND IT IS NOT PADDING
-- ===========================================================================
-- Between this phase and Phase 3, `apps/sales` still writes four PLATFORM
-- tables that carry a `workspace_id` with a foreign key on
-- `platform.workspaces`: events, entities, labels, uploads. Those writes now
-- carry a SALES workspace id, and there are exactly two things that can happen:
--
--   (a) the id also exists in `platform.workspaces`  -> the FK is satisfied and
--       the row lands against SOMEBODY ELSE'S WORKSPACE. Silent. Measured on
--       2026-08-10: a sales workspace minted at id 2 wrote a `platform.events`
--       row attributed to platform workspace 2, which belongs to another user.
--
--   (b) the id does not exist there                  -> `insert or update on
--       table "events" violates foreign key constraint
--       events_workspace_id_workspaces_id_fk`. Loud, immediate, attributable.
--
-- (b) is a bug. (a) is cross-tenant contamination that nothing would report.
-- The two id spaces start life overlapping exactly because this migration
-- MIRRORS ids, so without an offset the early sales workspaces land squarely in
-- (a) — the worst case is also the likely one.
--
-- Pushing the sequence a thousand past the platform high-water mark makes (a)
-- unreachable in practice and leaves every such write failing loudly until
-- Phase 3 points those four query layers at `sales.*`. It costs nothing: the
-- column is a plain 4-byte serial and ids are opaque — `/api/meta`'s own
-- guidance is to address a workspace by slug and never by number.
--
-- `GREATEST(...)` so re-running can only ever move it FORWARD: rewinding a
-- sequence is how you hand out an id that is already in use.
SELECT setval(
  pg_get_serial_sequence('sales.workspaces', 'id'),
  GREATEST(
    (SELECT COALESCE(max(id), 0) FROM sales.workspaces),
    (SELECT COALESCE(max(id), 0) FROM platform.workspaces),
    COALESCE(
      pg_sequence_last_value(pg_get_serial_sequence('sales.workspaces', 'id')::regclass),
      0
    )
  ) + 1000,
  true
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The twelve constraint swaps.
-- ---------------------------------------------------------------------------
-- Same names, same ON DELETE CASCADE, different parent. Listed one per line
-- rather than generated in a DO loop on purpose: a loop over
-- `pg_constraint WHERE confrelid = 'platform.workspaces'::regclass` would
-- silently pick up a thirteenth table somebody adds later, and "the migration
-- quietly did more than it says" is not a property worth the brevity.

ALTER TABLE sales.prospects DROP CONSTRAINT IF EXISTS prospects_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.prospects ADD CONSTRAINT prospects_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.contacts DROP CONSTRAINT IF EXISTS contacts_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.contacts ADD CONSTRAINT contacts_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.counters DROP CONSTRAINT IF EXISTS counters_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.counters ADD CONSTRAINT counters_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.documents DROP CONSTRAINT IF EXISTS documents_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.documents ADD CONSTRAINT documents_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.matches DROP CONSTRAINT IF EXISTS matches_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.matches ADD CONSTRAINT matches_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.meetings DROP CONSTRAINT IF EXISTS meetings_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.meetings ADD CONSTRAINT meetings_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.objections DROP CONSTRAINT IF EXISTS objections_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.objections ADD CONSTRAINT objections_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.products DROP CONSTRAINT IF EXISTS products_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.products ADD CONSTRAINT products_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.stage_entries DROP CONSTRAINT IF EXISTS stage_entries_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.stage_entries ADD CONSTRAINT stage_entries_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.templates DROP CONSTRAINT IF EXISTS templates_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.templates ADD CONSTRAINT templates_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.communications DROP CONSTRAINT IF EXISTS communications_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.communications ADD CONSTRAINT communications_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE sales.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_workspace_id_fkey;--> statement-breakpoint
ALTER TABLE sales.user_preferences ADD CONSTRAINT user_preferences_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES sales.workspaces(id) ON DELETE CASCADE;
