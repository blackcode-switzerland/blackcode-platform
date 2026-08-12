-- b/sales, migration 0007 — the online-meeting link.
--
-- ===========================================================================
-- WHY `meeting_url` AND NOT `link`
-- ===========================================================================
-- `link` is the wrong word in this repo three times over: `bk link` was a
-- command (removed in multiAppFinalRefactor Phase 4), `link` is a value of the
-- `document_kinds` vocabulary, and `sales.document_prospects` et al are "the
-- link tables". A column called `link` on `meetings` would collide with all
-- three in every grep. `meeting_url` says what it holds.
--
-- ===========================================================================
-- `text`, NOT `varchar(n)`
-- ===========================================================================
-- It is a URL an attendee opens. A Teams link carrying a tenant id, a thread id
-- and a base64 context blob runs past 400 characters routinely, and a Zoom link
-- with an embedded passcode is not much shorter. Any `varchar(n)` here is a
-- guess that truncates somebody's meeting, and Postgres charges nothing for
-- `text`. The app enforces MEETING_URL_MAX (lib/limits.ts) so a caller gets a
-- 400 naming the limit rather than a driver error; that number is a sanity
-- bound against paste accidents, not a schema fact.
--
-- Nullable, and it stays nullable: most rows in this ledger are phone calls and
-- in-person meetings, which have no link and must not be made to invent one.
--
-- ===========================================================================
-- THE SECOND TRIGGER, AND WHY A CONFERENCING LINK NEEDS ONE
-- ===========================================================================
-- CLAUDE.md: "Any new content column that can hold a file URL needs a
-- `platform.blob_references` trigger, in the same migration."
--
-- The instinct is that this column is exempt — it is for Teams and Meet, not
-- for uploads. That is exactly the argument 0002 records for
-- `documents.external_url` and then REFUSES, and the asymmetry it refuses on is
-- unchanged here (`lib/storage/scanner.ts`, header):
--
--   a wrongly-INCLUDED column costs one no-op scan per row.
--   a wrongly-EXCLUDED column costs a file somebody is still using, no undo.
--
-- And the concrete write is easy to name: somebody uploads a recording or a
-- dial-in card with `bk sales upload` and pastes its blob url here, because the
-- field is called "link" on the screen. `exact` mode runs
-- `platform.is_uploaded_asset` on the value, so a genuine Teams URL produces no
-- index row at all — the cost of being wrong in the safe direction is zero.
--
-- `meetings` already carries `trg_blob_refs` in `scan` mode over title/agenda/
-- outcome, and a table can hold only one trigger of a given name, so this is
-- `trg_blob_refs_url` — the same (table, mode) pairing `documents` uses.
--
-- ORDER, as in 0002: TRIGGER first, then BACKFILL. There is no third section
-- here — `platform.apps.maintains_blob_index` is already true for this app, and
-- re-asserting it would be the one statement whose position can lose bytes.
-- Adding the trigger BEFORE the backfill is what keeps that flag honest across
-- this migration: for the instant between them the index is merely incomplete
-- for a column that, today, holds no rows at all.
--
-- Re-runnable: `ADD COLUMN IF NOT EXISTS`, the drop precedes the create, and
-- the backfill converges.
-- Mirrored in `apps/sales/lib/storage/scanner.ts` (`SURFACES`, `RETRIGGER_SQL`,
-- `scanWorkspace`, `isUrlReferenced`); `lib/storage/scanner.test.ts` reads every
-- migration in this directory and fails if the two disagree.

ALTER TABLE "sales"."meetings" ADD COLUMN IF NOT EXISTS "meeting_url" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGER
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.meetings;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_url
  AFTER INSERT OR DELETE OR UPDATE OF meeting_url ON sales.meetings
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'meeting_url', 'workspace_id', 'exact', 'meeting_url');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- `UPDATE t SET col = col` fires an `UPDATE OF col` trigger: it fires on the
-- column being ASSIGNED, not on the value changing. A no-op on the day this
-- lands (every value is NULL) and correct when the file is re-run against a
-- database that already has links in it, which is what a rollback-and-reapply
-- does. 0002 states the same reasoning at length.
UPDATE sales.meetings SET meeting_url = meeting_url;
