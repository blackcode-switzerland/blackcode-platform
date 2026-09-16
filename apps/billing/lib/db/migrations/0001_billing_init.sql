-- b/billing, migration 0001 — the schema, this app's tenancy, and the #number
-- allocator.
--
-- ===========================================================================
-- WHY THIS FILE IS HAND-WRITTEN AND NOT GENERATED
-- ===========================================================================
-- `npm run db:generate` DOES NOT WORK for a new app on this platform, and the
-- failure is silent-looking rather than loud. `lib/db/schema.ts` carries
-- `export * from '@blackcode/platform-db/schema'`, so drizzle-kit sees every
-- `platform.*` table as part of THIS app's schema and emits
-- `CREATE TABLE platform.users`, `platform.workspaces`, and so on — hundreds of
-- lines that would have this app owning the shared schema.
--
-- Ownership is what confers DDL (docs/platform-db.md): an owner can ALTER or
-- DROP tables every other app depends on. The whole per-app role model exists to
-- prevent exactly that.
--
-- So: every migration in this directory is written by hand, the same way
-- `apps/_scaffold`, `apps/sales` and `apps/books` wrote theirs. The giveaway
-- that theirs are hand-written is `CREATE TABLE IF NOT EXISTS`, which
-- drizzle-kit never emits.
--
-- ===========================================================================
-- WHAT THIS SQUASHES, AND WHAT IT DELIBERATELY DROPS
-- ===========================================================================
-- The scaffold reached this state in three migrations: 0001 created its tables
-- against `platform.workspaces`, and 0003 gave the app its own workspaces and
-- moved the foreign keys over with a guarded DO block. A new app has no history
-- to migrate, so the foreign keys point at `billing.workspaces` from the first
-- statement and **the DO block is not carried**.
--
-- That DO block is also finding #20 in CLAUDE.md: it guarded its DROP on a
-- CONSTRAINT NAME, Postgres had named the constraint something else, the DROP
-- matched nothing, the ADD succeeded, and the table ended up carrying BOTH
-- foreign keys while every statement exited 0. Not carrying it is not laziness;
-- there is nothing here for it to repoint.
--
-- **There is no placeholder entity.** `apps/books`' 0001 kept the scaffold's
-- `notes` table to satisfy the CLI-parity guard during its phase 0, and then
-- spent its phase 1 dropping the table and its blob trigger. That is not needed:
-- `appOwnClaims` is satisfied by the appverbs commands alone
-- (`bk billing workspace list`, `member list`, `invite list|send|revoke` are all
-- attributed to this app, verified with `bk __routes` on 2026-09-16), so the app
-- is parity-green with no entity of its own. Phase 1's tables arrive in 0004
-- against a schema that never carried a table nobody wanted.

CREATE SCHEMA IF NOT EXISTS billing;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THIS APP'S OWN TENANCY
-- ---------------------------------------------------------------------------
-- An app owns its workspaces, members and invitations (multiAppFinalRefactor
-- Phase 7). FK into `platform.users` freely, and into nothing else outside this
-- schema.
--
-- `ON DELETE RESTRICT` on `owner_id` is kept and is INERT: it cannot fire
-- against the UPDATE that soft-deletes a user, which is how an account is
-- actually closed. `/api/me/footprint` is what protects this data. See the
-- column's note in lib/db/schema.ts.
CREATE TABLE IF NOT EXISTS billing.workspaces (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  slug        varchar(40) NOT NULL,
  owner_id    integer NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_workspaces_slug
  ON billing.workspaces (slug);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_billing_workspaces_owner
  ON billing.workspaces (owner_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS billing.workspace_members (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_workspace_members_role_check CHECK (role IN ('owner', 'member'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_workspace_members_ws_user
  ON billing.workspace_members (workspace_id, user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_billing_workspace_members_user
  ON billing.workspace_members (user_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS billing.invitations (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  email         varchar(255) NOT NULL,
  invited_by    integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  token         varchar(64) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invitations_token
  ON billing.invitations (token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_billing_invitations_ws
  ON billing.invitations (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_billing_invitations_email
  ON billing.invitations (email);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE #NUMBER ALLOCATOR — ONE ROW PER (WORKSPACE, ENTITY TYPE)
-- ---------------------------------------------------------------------------
-- NOT the scaffold's `note_counters (workspace_id, last_note_seq)`, which is one
-- COLUMN per entity type and so needs an ALTER every time the app grows a noun.
-- This app grows four more nouns across phases 1, 4 and 5; with this shape each
-- is a row and the allocator never changes.
--
-- `platform.workspace_counters` cannot be used at all: its columns are
-- `last_issue_seq`, `last_project_seq`, `last_task_seq` — one app's entity
-- types, in a shared table.
--
-- ── THIS IS THE WORKSPACE #number, NOT THE STATUTORY INVOICE NUMBER ─────────
-- Two different numbers, and conflating them would be the worst bug this app
-- could ship. `seq` here is the ADDRESS an agent and a URN use
-- (`bc:billing:acme/invoice/12`), allocated from this table. The statutory
-- invoice number is per COMPANY, gapless, and allocated in phase 1 from
-- `billing.company.next_seq` by a row-locking UPDATE. See
-- docs/billing-app-plan/phase-1-companies-and-invoices.md.
--
-- Bumped with `RETURNING` inside the writing transaction, never read-then-write:
-- two concurrent creates would otherwise read the same value and collide.
CREATE TABLE IF NOT EXISTS billing.counters (
  workspace_id  integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  entity_type   varchar(20) NOT NULL,
  last_value    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, entity_type)
);
