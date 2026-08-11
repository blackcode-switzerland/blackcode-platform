-- Phase 5: drop the two per-app access gates, and the dead transaction log.
--
-- multiAppFinalRefactor PLAN.md §4b and Phase 5.
--
--   platform.workspace_apps   — "this app is turned on for this organisation"
--   platform.app_access       — "this user may open it here"
--   platform.transaction_log  — the undo feature that never had a writer
--
-- The first two were created by 0034 and are meaningless now: they gate an app
-- INSIDE a workspace that several apps share, and since Phase 2 a workspace
-- belongs to exactly one app. Membership is the whole of the answer. Worse than
-- redundant, they had become WRONG — a grant row named a `platform.workspaces`
-- id for an app whose workspaces had moved to its own schema, so `/api/meta`
-- reported a sales workspace that `apps/sales` itself answers 404 for.
--
-- ===========================================================================
-- WHY THERE IS NO ROW-COUNT ASSERTION ON THE TWO DROPS
-- ===========================================================================
-- SAFETY.md requires every DELETE to assert its own row count inside a
-- transaction, because a declaration compares NET change and cannot tell "you
-- deleted what you said" from "you deleted more and the app backfilled it".
--
-- That guard is for a DELETE with a WHERE. These are DROPs of whole tables whose
-- readers are already gone, and the count is not the risk — the counts differ
-- between production (20 / 49) and any other database, so an exact assertion
-- would block the deploy on being run somewhere else, which trains people to
-- delete the guard.
--
-- The real risk is dropping something still depended on. `DROP TABLE` WITHOUT
-- `CASCADE` is exactly that assertion, enforced by Postgres: if any FK, view or
-- constraint still points here, this migration fails and changes nothing. Do not
-- add `CASCADE` to make it pass — a dependency is the signal to stop.
--
-- The counts ARE reported, before the drop, so the deploy log says what was
-- destroyed rather than only how the statement went ("irreversible commands
-- report WHAT they did", CLAUDE.md). They are also declared in
-- multiAppFinalRefactor/baseline.txt so `verify.sh` expects the tables to go.
--
-- ===========================================================================
-- transaction_log IS GATED, AND THE GATE IS `max(created_at)`, NOT `count(*)`
-- ===========================================================================
-- PLAN.md §4b was CORRECTED after agent 1: local dev holds 4 stale rows while
-- production holds 0, so "expect it to be empty" would have stopped this phase
-- on a mis-specified gate rather than a real problem — or, worse, been "fixed"
-- to let the drop through.
--
-- The question is "is anything still WRITING it?". A recent row means a writer
-- this audit did not find, which is far more interesting than the table, so this
-- migration REFUSES rather than dropping. Nothing in the repo writes it, and the
-- only trigger in the whole `platform` schema is `trg_blob_refs on comments` —
-- but a grep of the TypeScript could not have established that, and neither can
-- this file. It asks the database.
--
-- Rollback: docs/sql/0045-drop-app-gates-rollback.sql. Read its header first —
-- it restores the STRUCTURE, and it cannot restore the rows.

-- ===========================================================================
-- IT IS IDEMPOTENT, AND THE FIRST VERSION WAS NOT
-- ===========================================================================
-- Every read and every drop is guarded by `to_regclass(...) IS NOT NULL`. The
-- first draft assumed all three tables existed, which is true exactly once:
-- re-running it after `docs/sql/0045-drop-app-gates-rollback.sql` — which
-- restores the two gates and deliberately leaves `transaction_log` out — died
-- with `relation "platform.transaction_log" does not exist` before reaching any
-- DROP. Found by running the rollback and then re-applying, which is the cycle
-- SAFETY.md asks for and the reason it asks.
--
-- A migration is normally run once by the ledger, so this is not about the happy
-- path. It is about the retry AFTER something went wrong, which is the moment
-- the operator can least afford a second, unrelated error.

DO $$
DECLARE
  wa_count   bigint := NULL;
  aa_count   bigint := NULL;
  tl_count   bigint := NULL;
  tl_newest  timestamptz;
  -- Anything newer than this and we stop. Generous on purpose: the rows this is
  -- expected to find are months old (newest seen: 2026-05-22, from before undo
  -- was retired), so a 30-day window separates "residue" from "a live writer"
  -- without being so tight that a slow deploy pipeline trips it.
  tl_cutoff  interval := interval '30 days';
BEGIN
  IF to_regclass('platform.workspace_apps') IS NOT NULL THEN
    SELECT count(*) INTO wa_count FROM platform.workspace_apps;
  END IF;
  IF to_regclass('platform.app_access') IS NOT NULL THEN
    SELECT count(*) INTO aa_count FROM platform.app_access;
  END IF;
  IF to_regclass('platform.transaction_log') IS NOT NULL THEN
    SELECT count(*), max(created_at) INTO tl_count, tl_newest FROM platform.transaction_log;
  END IF;

  RAISE NOTICE 'Phase 5 drop: workspace_apps=% rows, app_access=% rows, transaction_log=% rows (newest %)',
    COALESCE(wa_count::text, 'already gone'),
    COALESCE(aa_count::text, 'already gone'),
    COALESCE(tl_count::text, 'already gone'),
    COALESCE(tl_newest::text, 'none');

  -- THE GATE. `tl_newest IS NULL` means an empty table (or no table), which is
  -- the production state and is fine — it is not "unknown", it is "nothing was
  -- ever written".
  IF tl_newest IS NOT NULL AND tl_newest > now() - tl_cutoff THEN
    RAISE EXCEPTION
      'REFUSING to drop platform.transaction_log: its newest row is % (within %). '
      'Something is writing this table that the Phase 5 audit did not find. '
      'Find the writer before dropping it — that is more interesting than the table.',
      tl_newest, tl_cutoff;
  END IF;
END $$;

-- No CASCADE, deliberately — see the header. `IF EXISTS` is the idempotency
-- half and does NOT weaken that: a still-referenced table still refuses to drop.
DROP TABLE IF EXISTS platform.app_access;
DROP TABLE IF EXISTS platform.workspace_apps;
DROP TABLE IF EXISTS platform.transaction_log;
