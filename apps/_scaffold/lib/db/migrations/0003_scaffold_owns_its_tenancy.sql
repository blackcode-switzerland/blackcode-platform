-- The scaffold app, migration 0003 — this app's own workspaces, membership and
-- invitations, and the two foreign keys that stop pointing at another app's.
--
-- multiAppFinalRefactor Phase 7 (PLAN.md §5). The refactor's whole thesis,
-- applied to the file people COPY: identity is shared, everything else is the
-- app's, and the CLI is the connector.
--
-- ===========================================================================
-- WHY A SCAFFOLD NEEDED THIS AT ALL
-- ===========================================================================
-- Until 2026-08-11 `apps/_scaffold` had no tenancy of its own. `lib/api.ts`
-- supplied `platformWorkspaceSource(getDb())` and said so in its own header —
-- "`platform.workspaces`, for now" — with a note naming this phase as where it
-- changed. It was right, and the cost of leaving it was specific rather than
-- theoretical: an app copied from this directory would have been born needing
-- somebody to grant it a workspace in ANOTHER app before it could serve a single
-- request, which is exactly the add-on shape `apps/sales` spent Phases 2 and 3
-- leaving behind. App #3 would have inherited, from the scaffold, the coupling
-- six phases had just finished removing.
--
-- ===========================================================================
-- THE FK REPOINT IS A PLAIN SWAP HERE, AND IT IS NOT ONE IN A REAL APP
-- ===========================================================================
-- `apps/sales` migration 0004 had to MIRROR rows — copy the `platform.workspaces`
-- it used into `sales.workspaces` preserving the id, copy the memberships,
-- advance the sequence, then swap twelve constraints — because it had live rows
-- whose ids were referenced. **This app has none and is never deployed**, so the
-- swap below is a constraint change over empty tables.
--
-- If you are copying this migration into an app that already has data, READ
-- `apps/sales/lib/db/migrations/0004_sales_owns_its_workspaces.sql` instead.
-- Two things there are load-bearing and absent here:
--
--   1. **Mirroring preserves ids**, so the swap moves no data and "where did the
--      row go?" stays answerable.
--   2. **The sequence is advanced past the platform maximum** (`+1000`). Without
--      it the two id spaces overlap, and a write that still names a platform
--      table lands SILENTLY against another tenant's workspace instead of
--      failing. Agent 3 measured both outcomes; the silent one was also the
--      likely one.
--
-- ===========================================================================
-- WHAT IS NOT HERE
-- ===========================================================================
-- **No `scaffold.uploads`, `labels`, `events` or `comments`.** This app serves
-- no upload, label or activity route, and agent 2's rule applies: a table with
-- no writer is a shape somebody later mistakes for a feature. When you add the
-- route, add the table with it — `apps/sales` migration 0003 is the worked
-- example for all four.
--
-- **No `app` column anywhere.** The platform copies carry one because they are
-- shared. Here the schema name is the answer.
--
-- **No `scaffold.users`.** Identity stays shared. Every `*_id` below is a
-- cross-schema FK into `platform.users`, and those FKs are the boundary this
-- refactor keeps rather than a breach of it.
--
-- GRANTS: `scaffold_app` gets DML on these tables with no re-grant, because
-- `docs/sql/app-role.sql` step 5 runs `ALTER DEFAULT PRIVILEGES` as the migrator
-- and the migrator creates them. That is a claim about a script somebody ran by
-- hand, so `docs/adding-an-app.md` step 3 tells you to PROVE it with a bounded
-- probe role rather than assume it (finding #15).
--
-- Re-runnable: every CREATE is IF NOT EXISTS and every constraint swap is
-- guarded. Rollback: docs/sql/scaffold-0003-rollback.sql.

CREATE SCHEMA IF NOT EXISTS scaffold;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspaces — this app's tenancy root
-- ---------------------------------------------------------------------------
-- Five columns, and the omissions are the same ones `apps/sales` made for the
-- same reasons: no `logo_url` (no workspace chrome to put one in), no
-- `storage_limit_bytes` (never enforced by anything, and a quota over one shared
-- Blob store is not a per-app fact), no `deleted_at` (no writer in any app —
-- carrying an unwritten column forward is how it acquires two meanings).
--
-- `updated_at` stays because the listing orders by it; `slug` stays because
-- routes are `/api/workspaces/{ws}` and `{ws}` is the slug.
CREATE TABLE IF NOT EXISTS scaffold.workspaces (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  slug        varchar(40) NOT NULL,
  owner_id    integer NOT NULL REFERENCES platform.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_scaffold_workspaces_slug
  ON scaffold.workspaces (slug);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scaffold_workspaces_owner
  ON scaffold.workspaces (owner_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspace_members — and this table IS the access gate
-- ---------------------------------------------------------------------------
-- There is no per-app grant to check beside it. `platform.workspace_apps` and
-- `platform.app_access` were dropped on 2026-08-10 (Phase 5) along with
-- `requireAppAccess`: each app owns its workspaces, so a workspace belongs to
-- exactly one app and membership is the whole question.
CREATE TABLE IF NOT EXISTS scaffold.workspace_members (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES scaffold.workspaces(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scaffold_workspace_members_role_check CHECK (role IN ('owner', 'member'))
);--> statement-breakpoint

-- The unique index is not decoration: `addMember` relies on it to settle the
-- race between two clicks on one accept link. A SELECT-then-INSERT cannot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scaffold_workspace_members_ws_user
  ON scaffold.workspace_members (workspace_id, user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scaffold_workspace_members_user
  ON scaffold.workspace_members (user_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
-- Named short, like sales': the schema already says which app, and there is one
-- kind of invitation here. No `app` column — that one selected an app WITHIN a
-- shared workspace, under gates that no longer exist.
--
-- `status` omits 'declined' deliberately: no code path writes it. An accepted
-- value is a promise that something produces it; add the value with the route.
CREATE TABLE IF NOT EXISTS scaffold.invitations (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES scaffold.workspaces(id) ON DELETE CASCADE,
  email         varchar(255) NOT NULL,
  invited_by    integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  token         varchar(64) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scaffold_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_scaffold_invitations_token
  ON scaffold.invitations (token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scaffold_invitations_ws
  ON scaffold.invitations (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scaffold_invitations_email
  ON scaffold.invitations (email);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE SWAP: this app's two tables stop referencing another app's workspaces
-- ---------------------------------------------------------------------------
-- `notes.workspace_id` and `note_counters.workspace_id` were created in 0001
-- against `platform.workspaces`. A note filed against an issues workspace is
-- precisely the coupling this refactor removes.
--
-- ON DELETE CASCADE is preserved on both, and that matters more than it looks:
-- deleting a workspace is a bare `DELETE FROM workspaces` in every app on this
-- platform, and the cascades are the ONLY mechanism that cleans up what hung off
-- it. **Do not "fix" a foreign-key violation by dropping the foreign key** — it
-- is the obvious cheap fix and it is the expensive one.
--
-- ===========================================================================
-- THE DROP FINDS THE CONSTRAINT BY WHAT IT POINTS AT, NOT BY ITS NAME
-- ===========================================================================
-- The first version of this migration named the constraints it expected —
-- `notes_workspace_id_workspaces_id_fk`, Drizzle's spelling. **Postgres had
-- called them `notes_workspace_id_fkey`**, because 0001 is hand-written SQL with
-- an inline `REFERENCES` clause and the server names those itself.
--
-- So the DROP matched nothing, the ADD succeeded, and the table ended up
-- carrying BOTH foreign keys: a note then had to satisfy `platform.workspaces`
-- AND `scaffold.workspaces` at once, which is strictly worse than the coupling
-- this migration exists to remove. It exited 0 and every CREATE looked right.
--
-- Found by running it and reading `pg_constraint`, not by review — the fourth
-- time on this project that the catalog contradicted the code (agent 1's
-- trigger, agent 3's twelve FKs, agent 4's cascade ordering). **Check the
-- catalog, not the repo.**
--
-- Matching on `confrelid` is also what makes this correct for a copy of this app
-- whose 0001 was generated by drizzle-kit rather than hand-written: the name
-- differs, the target does not.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('scaffold.notes'::regclass, 'scaffold.note_counters'::regclass)
      AND confrelid = 'platform.workspaces'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    RAISE NOTICE 'dropped % on % (it referenced platform.workspaces)', c.conname, c.tbl;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notes_workspace_id_scaffold_workspaces_id_fk'
      AND conrelid = 'scaffold.notes'::regclass
  ) THEN
    ALTER TABLE scaffold.notes
      ADD CONSTRAINT notes_workspace_id_scaffold_workspaces_id_fk
      FOREIGN KEY (workspace_id) REFERENCES scaffold.workspaces(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'note_counters_workspace_id_scaffold_workspaces_id_fk'
      AND conrelid = 'scaffold.note_counters'::regclass
  ) THEN
    ALTER TABLE scaffold.note_counters
      ADD CONSTRAINT note_counters_workspace_id_scaffold_workspaces_id_fk
      FOREIGN KEY (workspace_id) REFERENCES scaffold.workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;
