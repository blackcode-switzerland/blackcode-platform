-- b/sales, migration 0008 — the identity card (sales #34, #33).
--
-- ===========================================================================
-- WHAT WAS ACTUALLY MISSING, WHICH IS LESS THAN THE ISSUES SAY
-- ===========================================================================
-- #34 reads "a prospect is just a name + company + stage — reps can't call,
-- email, or look up their own contact". #33 reads "there is no place to capture
-- intelligence on a prospect as a PERSON".
--
-- Both were written from the PROSPECT record, and both are half wrong:
-- `sales.contacts` has carried `name`, `role`, `email`, `phone` and `notes`
-- since 0001, served by `bk sales contact add/edit/list/rm`. The person fields
-- existed; nobody found them, because a prospect is where you look and the
-- contact is one level down.
--
-- That is a discoverability defect, and it is fixed on the SURFACES (the
-- prospect detail page grew a contacts block, `bk sales prospect show` prints
-- them) rather than by adding a second copy of `phone` and `email` to the
-- prospect. Two homes for a phone number is how you get two phone numbers.
--
-- So this migration adds only what genuinely had nowhere to go:
--
--   prospects.website        the COMPANY's site. Not a contact's — a prospect
--                            has one and its people share it.
--   prospects.address        the company's postal address, one line.
--   contacts.linkedin        the person's profile. #34 names it explicitly and
--                            it is the one identity field with no home.
--   contacts.decision_power  #33's structured half. `notes` was already the
--                            freeform half and stays it.
--
-- ===========================================================================
-- `decision_power` IS VALIDATED IN THE ROUTE, NOT BY A CHECK
-- ===========================================================================
-- Same reason `prospects.stage` is (schema.ts, at the column): the vocabulary is
-- served live by `bk meta`, and a CHECK constraint would need a migration every
-- time a value is added. `lib/pipeline.ts` owns the list;
-- `lib/cli-vocabulary.test.ts` is what keeps the CLI's copy honest.
--
-- Nullable, and it stays nullable. Most contacts are logged from a call with a
-- name and nothing else, and a NOT NULL here would make the cheap write — the
-- one that actually happens — impossible.
--
-- ===========================================================================
-- THE TRIGGERS
-- ===========================================================================
-- CLAUDE.md: "Any new content column that can hold a file URL needs a
-- `platform.blob_references` trigger, in the same migration." Four new columns,
-- and the asymmetry from 0002's header decides each one the same way — a
-- wrongly-INCLUDED column costs one no-op scan per write, a wrongly-EXCLUDED one
-- costs a file somebody is still using, with no undo:
--
--   website, linkedin   URL columns → `exact`, the shape `documents.external_url`
--                       and `meetings.meeting_url` already use. `exact` runs
--                       `platform.is_uploaded_asset` on the value, so a real
--                       linkedin.com/in/… produces no index row at all.
--   address             prose → folded into the existing `scan` trigger on
--                       `prospects`, beside `summary`.
--   decision_power      a 24-character vocabulary value. NOT covered, and this
--                       is the one exclusion in the file: the route refuses
--                       anything outside `DECISION_POWERS`, so no URL can reach
--                       it. That is a refusal by validation, not by belief.
--
-- `prospects` and `contacts` already carry `trg_blob_refs` in `scan` mode, and a
-- table holds only one trigger of a given name — so the url columns go on
-- `trg_blob_refs_url`, the same (table, mode) pairing 0007 used for meetings.
-- The `scan` trigger is REPLACED rather than added to, because `UPDATE OF` lists
-- the columns that fire it and `address` has to be in that list.
--
-- ORDER, as in 0002 and 0007: TRIGGER first, then BACKFILL. There is no flag
-- section — `platform.apps.maintains_blob_index` is already true for this app,
-- and re-asserting it is the one statement whose position can lose bytes.
--
-- Re-runnable: `ADD COLUMN IF NOT EXISTS`, every drop precedes its create, and
-- the backfill converges.
-- Mirrored in `apps/sales/lib/storage/scanner.ts` (`SURFACES`, `RETRIGGER_SQL`,
-- `scanWorkspace`); `lib/storage/scanner.test.ts` reads every migration in this
-- directory and fails if the two disagree.

ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "address" varchar(200);--> statement-breakpoint
ALTER TABLE "sales"."contacts" ADD COLUMN IF NOT EXISTS "linkedin" text;--> statement-breakpoint
ALTER TABLE "sales"."contacts" ADD COLUMN IF NOT EXISTS "decision_power" varchar(24);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGERS
-- ---------------------------------------------------------------------------
-- `prospects.trg_blob_refs` — recreated to add `address` to both the fire list
-- and the scan list. Dropping and recreating is not a no-op window worth
-- worrying about inside a single migration transaction, and there is no
-- ALTER TRIGGER that can change the `UPDATE OF` column list.
DROP TRIGGER IF EXISTS trg_blob_refs ON sales.prospects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF summary, next_action_note, closed_reason, address ON sales.prospects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'prospect', 'workspace_id', 'scan', 'summary', 'next_action_note', 'closed_reason', 'address');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.prospects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_url
  AFTER INSERT OR DELETE OR UPDATE OF website ON sales.prospects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'prospect_url', 'workspace_id', 'exact', 'website');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.contacts;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_url
  AFTER INSERT OR DELETE OR UPDATE OF linkedin ON sales.contacts
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'contact_url', 'workspace_id', 'exact', 'linkedin');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- `UPDATE t SET col = col` fires an `UPDATE OF col` trigger: it fires on the
-- column being ASSIGNED, not on the value changing. The url columns are NULL on
-- every row the day this lands, so those two are no-ops; the `prospects` scan
-- is NOT, because that trigger was just recreated and every existing row's
-- entries have to be recomputed under the new column list. 0002 states the same
-- reasoning at length.
UPDATE sales.prospects SET summary = summary, next_action_note = next_action_note, closed_reason = closed_reason, address = address;--> statement-breakpoint
UPDATE sales.prospects SET website = website;--> statement-breakpoint
UPDATE sales.contacts SET linkedin = linkedin;
