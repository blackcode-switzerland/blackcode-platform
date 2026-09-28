-- b/books, migration 0020 — where "which workspace am I in" is remembered.
--
-- ===========================================================================
-- WHY THIS TABLE DID NOT EXIST UNTIL NOW (2026-09-28)
-- ===========================================================================
-- `lib/api.ts`' WorkspaceSource answered `setDefaultForUser` with a no-op, and
-- `POST /api/me/active-workspace` — which the switcher and `bk books workspace
-- use` both call — therefore stored nothing. The reason it gave was right:
-- `platform.users.active_workspace_id` is ONE column read by every deployment,
-- and a books workspace id written there is read back by apps/issues as one of
-- ITS ids. What was missing was the other half: a place of this app's own.
--
-- This is apps/sales' `0006_sales_remembers_a_workspace.sql`, ported (read its
-- header for the full argument). The day it became necessary here is the day
-- this app gained a workspace switcher and a person could belong to two.
--
-- ON DELETE SET NULL on the pointer, CASCADE on the user: deleting a workspace
-- must leave the pointer empty (the reader falls back), not delete the row. A
-- pointer at a workspace you have since left is handled in the READER, which
-- re-checks membership — a foreign key can say a workspace exists, never that
-- you are still in it.

CREATE TABLE IF NOT EXISTS "books"."user_settings" (
  "user_id" integer PRIMARY KEY NOT NULL
    REFERENCES "platform"."users"("id") ON DELETE CASCADE,
  "active_workspace_id" integer
    REFERENCES "books"."workspaces"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The app role's DML on the new table. `ALTER DEFAULT PRIVILEGES` covers tables
-- created by the role that ran it, which is not a promise about who runs this
-- file — so the grant is explicit, and skipped loudly where the role is absent
-- (a local database, where every app connects as the owner).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    RAISE WARNING 'role books_app does not exist: grant on books.user_settings SKIPPED.';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "books"."user_settings" TO books_app;
END $$;
