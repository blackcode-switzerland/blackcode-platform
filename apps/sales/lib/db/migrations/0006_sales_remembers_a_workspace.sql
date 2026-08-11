-- b/sales, migration 0006 — where "which workspace am I in" is remembered.
--
-- ===========================================================================
-- WHY THIS TABLE DID NOT EXIST UNTIL NOW
-- ===========================================================================
-- `lib/api.ts`'s WorkspaceSource has carried this comment since Phase 2:
--
--     setDefaultForUser: async () => {}
--     // One workspace per person (PLAN.md §1), so "the default" is "theirs"
--     // and there is nothing to remember. […] which is the sensible answer on
--     // the day this app grows a switcher and a person has two.
--
-- That day is today. A person invited into somebody else's workspace ends up in
-- TWO: signing in mints their own (ensureWorkspaceForUser is keyed on
-- membership, and they have none until they accept), and accepting the
-- invitation adds the second. Measured 2026-08-11 by running the real sequence
-- against a local database, not by reading the code.
--
-- With a switcher, "the default" stops being derivable. The old
-- `getDefaultForUser` returned the LAST membership — a positional guess that is
-- stable only while nobody chooses. This makes the choice a fact.
--
-- ===========================================================================
-- WHY A TABLE AND NOT `platform.users.active_workspace_id`
-- ===========================================================================
-- That column exists and is tempting and would be WRONG. It holds an
-- `issues` workspace id, and the two apps' workspace tables have overlapping
-- ids — `sales.workspaces.id = 1031` and `platform.workspaces.id = 1031` are
-- different workspaces in different schemas. Writing a sales id there points
-- the issues app at whatever it happens to collide with.
--
-- This is the same collision that made the CLI keep its active workspace PER
-- APP in `~/.config/bk/config.json` (one shared field meant
-- `bk sales workspace use x` silently retargeted `bk issues …`). The server
-- side needs the same separation, and a table in this app's own schema is what
-- gives it: `sales_app` has no grant on another app's schema, so this pointer
-- CANNOT be made to name one.
--
-- ===========================================================================
-- ON DELETE SET NULL, NOT CASCADE
-- ===========================================================================
-- On `active_workspace_id` only. Deleting a workspace must not delete the row
-- that remembers a person's other preferences; it must leave the pointer empty
-- so the reader falls back. CASCADE here would delete the settings row of every
-- member of a deleted workspace.
--
-- On `user_id` it IS cascade: no user, no settings.
--
-- A NULL pointer and a pointer at a workspace you have since been removed from
-- are both handled in the READER (`getDefaultForUser` re-checks membership) —
-- a foreign key can enforce that the workspace exists, never that you are still
-- in it.

CREATE TABLE IF NOT EXISTS "sales"."user_settings" (
  "user_id" integer PRIMARY KEY NOT NULL
    REFERENCES "platform"."users"("id") ON DELETE CASCADE,
  "active_workspace_id" integer
    REFERENCES "sales"."workspaces"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
