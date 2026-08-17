-- b/sales, migration 0009 — the research log (sales #39).
--
-- ===========================================================================
-- WHAT WAS BROKEN, AND IT WAS NOT A MISSING FIELD
-- ===========================================================================
-- `prospects.summary` is the only free-text field on a prospect, and PATCH
-- OVERWRITES it. So the only way to record a second research finding was to
-- destroy the first. #39 was filed from a real session: researching Pierre
-- d'lune (#11), the site audit findings (broken Wix, console errors) went into
-- `summary` on top of whatever had been there.
--
-- That is not a field this app lacks — it is an operation. A summary is a
-- STATEMENT OF THE CURRENT POSITION and overwriting it is correct: "where this
-- deal stands" has exactly one answer at a time. A research log is the opposite
-- shape, a sequence of observations each true when it was written, and no
-- amount of widening `summary` produces one.
--
-- ===========================================================================
-- APPEND-ONLY, AND WHAT THAT MEANS HERE
-- ===========================================================================
-- There is **no `updated_at` and no PATCH route.** A note cannot be edited,
-- because an editable log is a summary with extra steps — the moment a row can
-- be rewritten, the guarantee the log exists for (what did we know, and when)
-- is gone, and nothing on the screen would say so.
--
-- A note CAN be deleted, and that is a deliberate exception rather than an
-- oversight: a note pasted onto the wrong prospect is otherwise permanent
-- clutter on a customer record. `DELETE` is guarded by a confirmation the caller
-- has to repeat back, checked BEFORE the row is destroyed — the shape
-- `lib/api/objection-delete-guard.test.ts` exists because it was once the other
-- way round here.
--
-- No `deleted_at` and no trash, matching `sales.objections`: the recycle bin is
-- for addressable records with a #number, and this has neither. The delete is
-- hard, which is exactly why the confirmation is not optional.
--
-- ===========================================================================
-- NO `seq`, FOR `contacts`' REASON
-- ===========================================================================
-- A note is never addressed on its own — it is always reached through its
-- prospect — so a #number would advertise an identity `bk` cannot resolve.
-- `id` is the address, the same way it is for contacts and objections, and the
-- listing prints it. `sales.counters` is untouched by this file.
--
-- ===========================================================================
-- THE ACTOR PAIR, NOT A BARE FK
-- ===========================================================================
-- `author_user_id` + `author_label`, the shape `stage_entries.actor_*` and
-- `communications.logged_by_*` already use. An AGENT writes most of these — that
-- is the whole point of the issue, which was filed by one — and a plain user FK
-- could not represent "Companion". The label is populated from the TOKEN's name
-- when the write comes from a token, so agent-written research stays visibly
-- agent-written. A log you cannot attribute is a log you cannot weigh.
--
-- ===========================================================================
-- THE TRIGGER
-- ===========================================================================
-- `body` is authored prose that an agent writes, which is the single most
-- likely place in this schema for an uploaded screenshot's blob url to end up —
-- a site audit with a screenshot attached is the literal example in the issue.
-- `scan` mode, and it is not a borderline call.
--
-- Order, as in 0002/0007/0008: TRIGGER first, then BACKFILL. No flag section —
-- `platform.apps.maintains_blob_index` is already true for this app.
--
-- Re-runnable: `IF NOT EXISTS` throughout, the drop precedes the create, and the
-- backfill converges (it is a no-op on a fresh table).
-- Mirrored in `apps/sales/lib/storage/scanner.ts` (`SURFACES`, `RETRIGGER_SQL`,
-- `scanWorkspace`, `isUrlReferenced`); `lib/storage/scanner.test.ts` reads every
-- migration in this directory and fails if the two disagree.

CREATE TABLE IF NOT EXISTS sales.prospect_notes (
  id              serial PRIMARY KEY,
  workspace_id    integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  prospect_id     integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  -- NOT NULL: an empty research note is not a thing anybody meant to write, and
  -- the route refuses one with a 400 rather than storing a blank row.
  body            text NOT NULL,
  -- A short free-text bucket — "site audit", "competitor", "timing". Free text
  -- rather than a vocabulary on purpose: what is worth categorising about a
  -- prospect is not settled, and a closed list would refuse the first note that
  -- did not fit. `sales.documents.tags` took the same decision.
  kind            varchar(40),
  author_user_id  integer REFERENCES platform.users(id) ON DELETE SET NULL,
  author_label    varchar(80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(kind, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospect_notes_prospect ON sales.prospect_notes (prospect_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospect_notes_ws       ON sales.prospect_notes (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospect_notes_search   ON sales.prospect_notes USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGER
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_blob_refs ON sales.prospect_notes;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON sales.prospect_notes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'prospect_note', 'workspace_id', 'scan', 'body');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- A no-op the day this lands, because the table was created three statements
-- ago. It is here because a re-run against a database that already has notes in
-- it must rebuild their entries, which is what a rollback-and-reapply does.
UPDATE sales.prospect_notes SET body = body;
