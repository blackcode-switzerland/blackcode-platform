-- Phase 3: the sources register's depth, and the pièces pipeline.
--
-- ===========================================================================
-- WHAT ALREADY EXISTED, AND WHAT THIS ADDS
-- ===========================================================================
-- `books.source` shipped in 0003 and is the register's spine. This migration
-- adds what hangs off it: the raw files pulled from each source, the versioned
-- runbook that says how to pull, the inbox of documents an external worker
-- delivers, and the Drive manifest that tracks each file through its states.
--
-- NOTHING HERE TOUCHES A BALANCE. No table in this migration is read by any
-- derivation, so a staged piece cannot reach a statement by construction —
-- which is phase 3's acceptance criterion "balances are unchanged by anything
-- in this phase", made structural rather than promised.
--
-- ===========================================================================
-- FILES ARE REFERENCES, NEVER BLOBS (phase-3-sources-pieces.md, Notes)
-- ===========================================================================
-- Receipts live in Google Drive and, later, a retention-locked archive. This
-- schema stores `drive_ref`/`file_id`/hashes, never bytes, and none of these
-- columns get blob triggers: `platform.blob_references` is for Vercel Blob,
-- which this app does not use and never will (0002's header).

-- ---------------------------------------------------------------------------
-- SOURCE PULL — the raw files pulled, our own copy's whereabouts
-- ---------------------------------------------------------------------------
-- One row per file fetched from a source: the camt.053 XML, the Stripe export.
-- `hash` is of OUR copy, taken at download (the runbook's "hash immédiat"),
-- because the question a gap investigation asks is "is the file we kept the
-- file we pulled".
CREATE TABLE IF NOT EXISTS books.source_pull (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  source_id     integer NOT NULL REFERENCES books.source(id) ON DELETE CASCADE,
  file          varchar(200) NOT NULL,
  /** Human-readable period label, e.g. «01–07.08.2026». Display, not arithmetic. */
  period        varchar(60),
  format        varchar(40),
  hash          varchar(80),
  drive_ref     text,
  pulled        date,

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, file)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_books_source_pull_source ON books.source_pull(source_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RUNBOOK — how to pull this source, versioned, WITHOUT ITS SECRETS
-- ---------------------------------------------------------------------------
-- `credential_ref` is a REFERENCE (vault://…), never a credential. There is no
-- constraint that can tell a secret from a reference, so the rule is enforced
-- where it can be: this comment, the CLI's help, and review.
--
-- One runbook per source, versioned in place: the register answers "how do I
-- pull this TODAY", and history belongs to git, not to this table.
CREATE TABLE IF NOT EXISTS books.runbook (
  id             serial PRIMARY KEY,
  workspace_id   integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  source_id      integer NOT NULL UNIQUE REFERENCES books.source(id) ON DELETE CASCADE,
  version        varchar(20) NOT NULL DEFAULT '1.0',
  updated        date,
  login_url      text,
  credential_ref text,
  steps          jsonb NOT NULL DEFAULT '[]',
  output         varchar(80),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- PIECE INBOX — one row per document the worker delivered. ALWAYS STAGED.
-- ---------------------------------------------------------------------------
-- The external Drive worker POSTs an ExtractionResult and it lands here,
-- staged, whatever the worker claimed about it. `extraction` is the worker's
-- payload VERBATIM (including its own validation block, kept as evidence of
-- what the worker said); `validation` is THE SERVER'S verdict, recomputed from
-- the payload's own arithmetic, and the only one anything trusts. The boundary
-- trusts bytes and arithmetic, not the caller.
--
-- ── IDEMPOTENT ON (workspace, drive_file_id, md5_checksum), NULL-SAFE ──────
-- The worker retries; retries must converge on one row. A plain UNIQUE over a
-- nullable md5 column would not do that (SQL NULLs never equal), so the index
-- is over COALESCE(md5, '') — a re-post with no checksum still lands on the
-- same row rather than beside it.
--
-- WORKSPACE-SCOPED, and that is a boundary, not a detail. Without the
-- workspace column, the same Drive file delivered to two workspaces would
-- collide globally — and the conflict path would hand workspace B a row that
-- belongs to workspace A. Found by this table's own test suite on 2026-08-18:
-- rows persisted from an earlier run's workspace swallowed a later run's
-- inserts, which is exactly the cross-tenant shape in miniature.
--
-- ── DUPLICATES ARE FLAGGED, NEVER DROPPED ──────────────────────────────────
-- Same checksum arriving under a DIFFERENT file id is a re-scan, a refund or a
-- split payment — three things that look identical and mean different money.
-- `duplicate_of_id` says "look at that one too"; deciding is a human's job.
CREATE TABLE IF NOT EXISTS books.piece_inbox (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  /** Attribution. NULLABLE: a scanned receipt does not always say whose it is. */
  entity_id     integer REFERENCES books.entity(id) ON DELETE SET NULL,
  seq           integer NOT NULL,

  status        varchar(20) NOT NULL DEFAULT 'staged'
                CHECK (status IN ('staged', 'matched', 'dismissed')),
  received      date NOT NULL,
  pipeline      varchar(120),

  drive_file_id      varchar(120) NOT NULL,
  file_name          varchar(300),
  mime_type          varchar(120),
  md5_checksum       varchar(64),
  drive_created_time timestamptz,
  web_view_link      text,

  extraction    jsonb NOT NULL,
  validation    jsonb NOT NULL,
  /** Server's routing verdict: failed validation, document_type "other", or a multi-document scan. */
  needs_review  boolean NOT NULL DEFAULT false,

  duplicate_of_id  integer REFERENCES books.piece_inbox(id) ON DELETE SET NULL,
  matched_entry_id integer REFERENCES books.entry(id) ON DELETE SET NULL,
  matched_at       timestamptz,
  note             jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_books_piece_inbox_file_checksum
  ON books.piece_inbox (workspace_id, drive_file_id, COALESCE(md5_checksum, ''));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_books_piece_inbox_ws ON books.piece_inbox(workspace_id, status);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- DRIVE MANIFEST — one row per Drive file, with a state machine
-- ---------------------------------------------------------------------------
-- The worker's ledger of what it has seen in the inbox folder, so "did we
-- miss a file" is a query rather than a feeling. States mirror the mockup's
-- MANIFEST_STATES exactly; `ingested` is terminal, `archived` is orthogonal
-- (a file can be ingested and not yet in the legal archive — `archive_ref`
-- stays honestly empty until the GCS bucket exists).
CREATE TABLE IF NOT EXISTS books.drive_manifest (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  source_id     integer NOT NULL REFERENCES books.source(id) ON DELETE CASCADE,
  file_id       varchar(120) NOT NULL,
  name          varchar(300),
  mime_type     varchar(120),
  drive_created_time timestamptz,
  fetched       date,
  extracted_piece_id integer REFERENCES books.piece_inbox(id) ON DELETE SET NULL,
  state         varchar(20) NOT NULL DEFAULT 'discovered'
                CHECK (state IN ('discovered', 'downloaded', 'extracted', 'validated_staged', 'needs_review', 'ingested')),
  archived      boolean NOT NULL DEFAULT false,
  archive_ref   text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, file_id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_books_drive_manifest_source ON books.drive_manifest(source_id, state);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GRANTS — the same shape 0005 established, applied to what this adds
-- ---------------------------------------------------------------------------
-- 0005's default privileges already hand books_app DML on new tables. Two of
-- these keep their DELETE revoked: a pull record and a delivered piece are
-- records of what happened (art. 958f by analogy — the pièce requirement
-- extends to what proves the books), and "we never received that receipt" must
-- not be makeable true by DELETE. The runbook and the manifest are operational
-- state, not records, and stay fully writable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    REVOKE DELETE ON books.piece_inbox  FROM books_app;
    REVOKE DELETE ON books.source_pull  FROM books_app;
  ELSE
    RAISE WARNING 'role books_app does not exist; DELETE stays granted by default ACLs. Replay this block after provisioning (docs/sql/books-app-role.sql).';
  END IF;
END $$;
