-- Drop two columns nobody reads: `workspace_invitations.app` and
-- `error_events.workspace_id`.
--
-- multiAppFinalRefactor PLAN.md §9.2 and §9.3, decided by the master in Phase 8.
-- Both were flagged by agent 6 and left open by agent 7, and both are
-- `platform.transaction_log`'s exact shape: a column that no code reads and no
-- code meaningfully writes, sitting in a shared table looking like a fact.
--
-- ---------------------------------------------------------------------------
-- WHY THIS LIVES IN THE ISSUES LEDGER
-- ---------------------------------------------------------------------------
-- `platform.*` is migrated from `apps/issues`, always — see 0044's header. A
-- second app INSTALLS things into platform (sales' 0002 triggers); it does not
-- ALTER a platform table, because the two ledgers have independent high-water
-- marks and "which app's migration ran first" is not a question a shared column
-- should depend on.
--
-- ===========================================================================
-- 1. `workspace_invitations.app` — the app the invitee was invited INTO
-- ===========================================================================
-- It existed to drive `alsoGrantApp`: accepting an invitation carrying an app
-- granted `platform.app_access` for that app even under 'invite_only'. Phase 5
-- (2026-08-10) dropped `app_access` and `workspace_apps` entirely, because a
-- workspace belongs to exactly one app now and membership is the whole gate.
--
-- Since that day the ONE writer hardcodes NULL —
-- `packages/platform-api/src/routes/invitations.ts` passes `app: null`, with a
-- comment saying why — and `apps/issues/lib/db/queries/invitations.ts` says, at
-- the accept site, "`inv.app` … has no reader now; the column keeps its
-- history".
--
-- ** HISTORICAL ROWS DO CARRY VALUES, so "is it all NULL?" is the WRONG gate. **
-- Asking it would refuse this migration on correct data. The question that
-- actually matters is 0045's question — *is anything still WRITING it?* — and
-- for a column with a legitimate past, that is: has anything written a non-NULL
-- `app` SINCE the day the writer was changed. Hence the cutoff below. It is a
-- real check, not a formality: reverting that `app: null` would make this
-- refuse.
--
-- ===========================================================================
-- 2. `error_events.workspace_id` — 0 of 328 rows, ever
-- ===========================================================================
-- Agent 6 found this, and found that it retires the stated justification for
-- the `app` column beside it. 0044's header argues that after the split
-- `workspace_id = 1` names a different row depending on which deployment wrote
-- it, so `app` is needed to disambiguate it. True — and moot, because nothing
-- has ever written `workspace_id`. Both `safeLog` call sites in
-- `packages/platform-api/src/handler.ts` omit it, and the client-error beacon
-- (`routes/telemetry.ts`) passes an explicit `workspace_id: null`.
--
-- ** `app` STAYS. ** It is not made redundant by this: it answers "what has app
-- X been throwing lately?", which is what the super-admin Errors tab asks and
-- what `idx_error_events_app_occurred` exists for. What goes is the column that
-- was only ever ambiguous because it was never populated.
--
-- Its gate is absolute — ANY non-NULL value refuses — because unlike the
-- invitations column this one has no legitimate history to preserve. A row with
-- a value means a writer this audit did not find, and that is more interesting
-- than the column.
--
-- ===========================================================================
-- WHAT `verify.sh` CANNOT SEE HERE, AND SAY IT OUT LOUD
-- ===========================================================================
-- The "nothing lost" ledger counts ROWS and tracks min/max(id). **A dropped
-- column changes no count, no min(id) and no max(id), so verify.sh will report
-- a clean PASS across this migration no matter what it destroys.** SAFETY.md
-- already says the ledger "cannot see content corruption — an UPDATE that
-- blanks a column changes no count"; a DROP COLUMN is the same blind spot with
-- a bigger blast radius. Do not read a green verify.sh as evidence that this
-- migration did the right thing.
--
-- The instruments that CAN see it are the two NOTICEs below (which say how many
-- values are about to be destroyed, before destroying them — CLAUDE.md's
-- "irreversible commands report WHAT they did, not just how many") and
-- `information_schema.columns` afterwards. **Check the catalog, not the repo**
-- — CLAUDE.md finding #20.
--
-- ===========================================================================
-- IDEMPOTENT, AND THE READS ARE DYNAMIC FOR THAT REASON
-- ===========================================================================
-- Every read is `EXECUTE`d rather than written as static SQL. A static
-- `SELECT count(workspace_id) FROM platform.error_events` inside an untaken
-- IF branch is still a statement PL/pgSQL will try to plan the moment it is
-- reached, and after the column is gone it cannot be planned. Dynamic SQL is
-- never planned until it runs, so a re-run after a successful run — or after
-- the rollback script, which restores the STRUCTURE and not the values — walks
-- through and does nothing. 0045's header records why that matters: the retry
-- after something went wrong is the moment an operator can least afford a
-- second, unrelated error.
--
-- Rollback: docs/sql/0046-drop-dead-columns-rollback.sql. **It restores two
-- empty columns. The values are gone.** Read its header before running it.

DO $$
DECLARE
  -- The day Phase 5 landed and `routes/invitations.ts` started passing
  -- `app: null`. A row created after this carrying a non-NULL `app` means the
  -- writer came back, which is the thing worth stopping for.
  phase5_deployed_on date := DATE '2026-08-10';

  inv_total      bigint;
  inv_with_app   bigint;
  inv_since      bigint;
  ee_total       bigint;
  ee_with_ws     bigint;
BEGIN
  -- -------------------------------------------------------------------------
  -- workspace_invitations.app
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name   = 'workspace_invitations'
      AND column_name  = 'app'
  ) THEN
    EXECUTE format(
      'SELECT count(*), count(app), count(*) FILTER (WHERE app IS NOT NULL AND created_at >= %L)
         FROM platform.workspace_invitations', phase5_deployed_on)
      INTO inv_total, inv_with_app, inv_since;

    RAISE NOTICE
      'DROPPING platform.workspace_invitations.app: % of % rows carry a value and will lose it (% written on or after %)',
      inv_with_app, inv_total, inv_since, phase5_deployed_on;

    IF inv_since > 0 THEN
      RAISE EXCEPTION
        'REFUSING to drop platform.workspace_invitations.app: % invitation(s) created on or after % carry a non-NULL app. '
        'Phase 5 made routes/invitations.ts pass app:null, so something has started writing this column again. '
        'Find that writer before dropping the column — it is more interesting than the column.',
        inv_since, phase5_deployed_on;
    END IF;
  ELSE
    RAISE NOTICE 'platform.workspace_invitations.app: already gone, nothing to do';
  END IF;

  -- -------------------------------------------------------------------------
  -- error_events.workspace_id
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name   = 'error_events'
      AND column_name  = 'workspace_id'
  ) THEN
    EXECUTE 'SELECT count(*), count(workspace_id) FROM platform.error_events'
      INTO ee_total, ee_with_ws;

    RAISE NOTICE
      'DROPPING platform.error_events.workspace_id: % of % rows carry a value and will lose it',
      ee_with_ws, ee_total;

    IF ee_with_ws > 0 THEN
      RAISE EXCEPTION
        'REFUSING to drop platform.error_events.workspace_id: % of % rows carry a value. '
        'The audit behind PLAN.md §9.3 measured 0 of 328, ever — so something writes this '
        'that neither the grep nor the two safeLog call sites accounted for. Find it first.',
        ee_with_ws, ee_total;
    END IF;
  ELSE
    RAISE NOTICE 'platform.error_events.workspace_id: already gone, nothing to do';
  END IF;
END $$;--> statement-breakpoint

-- No CASCADE, deliberately, and it is the same assertion 0045 relies on: if any
-- view, index, constraint or generated column still depends on either of these,
-- Postgres refuses and this migration changes nothing. A dependency is the
-- signal to stop, not a reason to add CASCADE.
--
-- The FK `workspace_invitations.app -> platform.apps.slug` is a dependency OF
-- the column, not ON it, and goes with it. That is intended: it is the last
-- reference to `apps.slug` from the invitation table, and `platform.apps` keeps
-- its role as the CLI address book.
ALTER TABLE platform.workspace_invitations DROP COLUMN IF EXISTS app;--> statement-breakpoint

ALTER TABLE platform.error_events DROP COLUMN IF EXISTS workspace_id;
