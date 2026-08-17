-- b/books, migration 0001 — the schema, this app's tenancy, and the placeholder
-- entity.
--
-- ===========================================================================
-- WHY THIS FILE IS HAND-WRITTEN AND NOT GENERATED
-- ===========================================================================
-- `npm run db:generate` DOES NOT WORK for a new app on this platform, and the
-- failure is silent-looking rather than loud. `lib/db/schema.ts` line 33 carries
-- `export * from '@blackcode/platform-db/schema'`, so drizzle-kit sees all 18
-- `platform.*` tables as part of THIS app's schema and emits `CREATE TABLE
-- platform.users`, `platform.workspaces`, and so on — 379 lines that would have
-- this app owning the shared schema.
--
-- Ownership is what confers DDL (docs/platform-db.md): an owner can ALTER or
-- DROP tables every other app depends on. The whole per-app role model exists to
-- prevent exactly that.
--
-- So: every migration in this directory is written by hand, the same way
-- `apps/_scaffold` and `apps/sales` wrote theirs. The giveaway that theirs are
-- hand-written is `CREATE TABLE IF NOT EXISTS`, which drizzle-kit never emits.
-- `docs/adding-an-app.md` does not mention this; found by app #3, 2026-08-17.
--
-- ===========================================================================
-- WHAT THIS SQUASHES
-- ===========================================================================
-- The scaffold reached this state in three migrations: 0001 created `notes`
-- against `platform.workspaces`, 0003 gave the app its own workspaces and moved
-- the foreign keys over with a DO block. A new app has no history to migrate, so
-- `notes` points at `books.workspaces` from the first statement and the DO block
-- is not needed.
--
-- `notes` is the SCAFFOLD'S placeholder entity and is deliberately temporary
-- here: it keeps the app buildable and the CLI-parity guard satisfied while
-- phase 0 is in progress. Phase 1 replaces it with `entry` / `entry_line` and
-- drops it, along with its blob trigger in 0002.

CREATE SCHEMA IF NOT EXISTS books;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THIS APP'S OWN TENANCY
-- ---------------------------------------------------------------------------
-- An app owns its workspaces, members and invitations (multiAppFinalRefactor
-- Phase 7). `platform.*` is identity plus an address book; `platform.workspaces`
-- is `apps/issues`' data despite the name. FK into `platform.users` freely, and
-- into nothing else outside this schema.
CREATE TABLE IF NOT EXISTS books.workspaces (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  slug        varchar(40) NOT NULL,
  owner_id    integer NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_workspaces_slug
  ON books.workspaces (slug);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_workspaces_owner
  ON books.workspaces (owner_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS books.workspace_members (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_workspace_members_role_check CHECK (role IN ('owner', 'member'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_workspace_members_ws_user
  ON books.workspace_members (workspace_id, user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_workspace_members_user
  ON books.workspace_members (user_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS books.invitations (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  email         varchar(255) NOT NULL,
  invited_by    integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  token         varchar(64) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_invitations_token
  ON books.invitations (token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_invitations_ws
  ON books.invitations (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_invitations_email
  ON books.invitations (email);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE PLACEHOLDER ENTITY — TEMPORARY, REMOVED IN PHASE 1
-- ---------------------------------------------------------------------------
-- `seq` is the workspace-scoped #number: the address every agent, URN and CLI
-- command uses. The serial `id` is never printed by any surface.
--
-- Soft delete only. `deleted_at IS NULL` means live. A hard DELETE would fire
-- the 0002 blob trigger and drop the row's file references, making a file
-- deletable the instant somebody pressed delete on a restorable row.
CREATE TABLE IF NOT EXISTS books.notes (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  title         varchar(200) NOT NULL,
  body          text,
  created_by    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_ws_seq
  ON books.notes (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_ws_live
  ON books.notes (workspace_id) WHERE deleted_at IS NULL;--> statement-breakpoint

-- The counter is bumped with RETURNING inside the insert's transaction, never
-- read-then-write: two concurrent creates would otherwise read the same value
-- and collide on uq_notes_ws_seq.
CREATE TABLE IF NOT EXISTS books.note_counters (
  workspace_id   integer PRIMARY KEY REFERENCES books.workspaces(id) ON DELETE CASCADE,
  last_note_seq  integer NOT NULL DEFAULT 0
);
