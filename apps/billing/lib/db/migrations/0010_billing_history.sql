-- b/billing, migration 0010 — imported history: the bills issued before this
-- app existed (phase 5, docs/billing-app-plan/phase-5-imported-history.md).
--
-- ===========================================================================
-- AN ARCHIVE, NOT A SECOND INVOICE TABLE
-- ===========================================================================
-- Roughly seven years of Zoho Books and Invoicely bills. They keep their
-- ORIGINAL number, in their own namespace, and never enter the native sequence
-- (position P6, and DATA-MODEL I13): renumbering a bill a client already holds
-- is a bookkeeping violation, and nothing here joins an imported number to
-- `invoice.number`. It is deliberately not unique against it either — a
-- historical `2024-007` and a native number that happened to render the same
-- are two different documents from two different systems.
--
-- A row is inserted once and read forever. There is no edit route and no
-- delete route, and the guards below make that true of the database rather
-- than of the routes: a trigger that stops the owner, and a revoke that stops
-- the app role before the statement is attempted. Both, deliberately — 0006's
-- header has the argument.
--
-- ===========================================================================
-- `total` IS THE ONE STORED AMOUNT IN THIS APP, AND THAT IS NOT A LAPSE
-- ===========================================================================
-- Every other amount is derived on read from its lines (0004's header). An
-- imported bill HAS no lines here — the exports carry a total and nothing to
-- derive it from — so storing it is the only way to have it. It is the total
-- as the source recorded it. Do not "fix" it by computing it from lines that do
-- not exist.
--
-- ===========================================================================
-- `drive_path` CANNOT HOLD A FILE OF OURS, AND THE CHECK IS WHAT MAKES THAT SO
-- ===========================================================================
-- CLAUDE.md: any column that can hold a file URL needs a
-- `platform.blob_references` trigger in the same migration, because the index
-- is what stops another deployment deleting a blob still in use. This column
-- holds a path or a link on Google Drive — never a blob, and this app has no
-- upload ledger and must not acquire one here. So instead of a trigger that
-- would index nothing, `history_drive_path_shape` REFUSES anything on the blob
-- store's host (`blob.vercel-storage.com`, the host `platform-storage`
-- recognises as its own). A column that cannot hold one of our files needs no
-- entry in the index of our files, and 0002's "complete" flag stays true.

CREATE TABLE IF NOT EXISTS billing.history (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  -- The workspace #number, from `billing.counters` ('history'). The ADDRESS:
  -- `bk billing history show 12`. Never printed as the bill's number.
  seq           integer NOT NULL,

  -- Which system it came from. A closed vocabulary (below and lib/vocabularies.ts).
  source        varchar(16) NOT NULL,
  -- ** THE SOURCE SYSTEM'S OWN ID, VERBATIM. ** `ZB-000178`, `INV-0293`. Never
  -- trimmed, case-folded or reformatted: it is the only handle back to the
  -- system of record, and a normalised id is one that no longer matches it.
  source_ref    varchar(64) NOT NULL,

  -- Which entity issued it. Required — and when the mapper had to infer it
  -- (from a bank account, say), the import flag says so in words.
  company_id    integer NOT NULL REFERENCES billing.company(id),
  -- The historical number AS ISSUED. Never renumbered.
  number        varchar(40) NOT NULL,
  -- Flat text. No b/clients linkage, not even a nullable column: a column
  -- pointing at an app that does not exist is a shape somebody later mistakes
  -- for a feature.
  client_name   varchar(200) NOT NULL,

  issue_date    date NOT NULL,
  -- Any ISO 4217 code, including USD — which is outside QR scope entirely and
  -- offers no payment part anywhere.
  currency      char(3) NOT NULL,
  -- Stored, not derived. See the header.
  total         numeric(14,2) NOT NULL,
  -- The source's status, mapped onto this app's three words.
  status        varchar(10) NOT NULL,

  -- The ambiguity the mapper could not resolve, IN WORDS, in both languages or
  -- neither: a flag that exists in only one language is hidden from every
  -- reader of the other, and a hidden warning is not a warning. NULL means the
  -- row mapped cleanly. **Never cleared** — confirmation resolves a question,
  -- it does not erase that the answer was once inferred.
  import_flag_fr text,
  import_flag_en text,

  -- The archived PDF's path or id on Google Drive. NULL means the export had no
  -- PDF, and that is shown rather than hidden.
  drive_path    text,

  imported_at   timestamptz NOT NULL DEFAULT now(),
  -- Who imported it, and how. On the row rather than in `billing.audit`: the
  -- audit log is a PUBLIC event feed (lib/integration.ts), and an archive import
  -- is not an event an integration polls for. A row that is never edited has no
  -- edit workflow to log.
  imported_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  imported_via  varchar(8) NOT NULL,

  CONSTRAINT uq_history_ws_seq UNIQUE (workspace_id, seq)
);--> statement-breakpoint

-- ** THE DUPLICATE GUARD IS THIS INDEX. ** Not an upsert and not a merge: two
-- exports disagreeing about one bill is something a person has to look at, so
-- the second import of `(source, source_ref)` is refused with the existing
-- row's #number (lib/db/queries/history.ts). Per source, because Invoicely and
-- Zoho ids are separate namespaces — and a bill that appears in BOTH across the
-- migration window is two rows with a flag, exactly as the mockup records it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_source_ref
  ON billing.history (workspace_id, source, source_ref);--> statement-breakpoint
-- The list's order: newest bill first, then #number for a stable tiebreak.
CREATE INDEX IF NOT EXISTS idx_history_ws_issued
  ON billing.history (workspace_id, issue_date DESC, seq DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_history_ws_company
  ON billing.history (workspace_id, company_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G6: the closed vocabularies, mirrored in lib/vocabularies.ts and
-- types/index.ts and checked against both by lib/vocabularies.test.ts
-- ---------------------------------------------------------------------------
ALTER TABLE billing.history
  ADD CONSTRAINT history_source_check
  CHECK (source IN ('zoho', 'invoicely'));--> statement-breakpoint

ALTER TABLE billing.history
  ADD CONSTRAINT history_status_check
  CHECK (status IN ('paid', 'unpaid', 'void'));--> statement-breakpoint

ALTER TABLE billing.history
  ADD CONSTRAINT history_imported_via_check
  CHECK (imported_via IN ('session', 'token'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Shapes
-- ---------------------------------------------------------------------------
ALTER TABLE billing.history
  ADD CONSTRAINT history_currency_shape_check
  CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint

-- Not blank — and deliberately NOT "not padded". A source id with surrounding
-- whitespace is stored with it, because that is what the source holds.
ALTER TABLE billing.history
  ADD CONSTRAINT history_text_not_blank
  CHECK (source_ref ~ '\S' AND number ~ '\S' AND client_name ~ '\S');--> statement-breakpoint

-- The `IS NOT NULL`s in the second branch are load-bearing. Without them a flag
-- in ONE language passed: `NULL ~ '\S'` is NULL, not false, `NULL AND true` is
-- NULL, and a CHECK treats NULL as satisfied. The first version of this
-- constraint was written that way and accepted `('only English', NULL)`; the
-- owner-side test caught it on its first run (2026-09-18).
ALTER TABLE billing.history
  ADD CONSTRAINT history_flag_both_languages
  CHECK (
    (import_flag_fr IS NULL AND import_flag_en IS NULL)
    OR (import_flag_fr IS NOT NULL AND import_flag_en IS NOT NULL
        AND import_flag_fr ~ '\S' AND import_flag_en ~ '\S')
  );--> statement-breakpoint

ALTER TABLE billing.history
  ADD CONSTRAINT history_drive_path_shape
  CHECK (
    drive_path IS NULL
    OR (drive_path ~ '\S' AND position('blob.vercel-storage.com' IN lower(drive_path)) = 0)
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- READ-ONLY, FOR THE OWNER TOO
-- ---------------------------------------------------------------------------
-- One exemption, 0009's: a hard delete of the importing account clears
-- `imported_by` through the foreign key, which Postgres carries out as an
-- UPDATE. That UPDATE, and no other, is permitted — the row compared with the
-- column removed, so a column added later is covered without being listed.
-- Its own function rather than 0009's, so the two tables' rules can part ways
-- without one silently changing the other.
CREATE OR REPLACE FUNCTION billing.history_read_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.imported_by IS NOT NULL
     AND NEW.imported_by IS NULL
     AND (to_jsonb(NEW) - 'imported_by') = (to_jsonb(OLD) - 'imported_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing.history is a read-only archive (% of row % in workspace %)', TG_OP, OLD.seq, OLD.workspace_id
    USING HINT = 'an imported bill is inserted once and read forever; record a resolution beside it, never by editing it';
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_history_read_only ON billing.history;--> statement-breakpoint
CREATE TRIGGER trg_history_read_only
  BEFORE UPDATE OR DELETE ON billing.history
  FOR EACH ROW EXECUTE FUNCTION billing.history_read_only();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The app role: SELECT and INSERT, and nothing else
-- ---------------------------------------------------------------------------
-- 0003's default privileges already grant DML on new tables to `billing_app`,
-- when the table is created by the role that set them. The grant below says it
-- again explicitly, so a migrator other than that role still leaves the app able
-- to read and import; then the revoke takes UPDATE and DELETE away. Guarded on
-- the role like 0003 and 0006: skipped with a WARNING on a database that has not
-- been provisioned yet, and **not fixed by re-running** — replay by hand.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
    RAISE WARNING 'role billing_app does not exist: history grants and revokes SKIPPED. Create the role, then replay 0010''s DO block by hand.';
    RETURN;
  END IF;
  GRANT SELECT, INSERT ON billing.history TO billing_app;
  GRANT USAGE, SELECT ON SEQUENCE billing.history_id_seq TO billing_app;
  REVOKE UPDATE, DELETE ON billing.history FROM billing_app;
  RAISE INFO 'billing_app on billing.history: SELECT and INSERT; UPDATE and DELETE revoked.';
END
$$;
