-- b/sales, migration 0012 — where a document's bytes live (sales #40).
--
-- ===========================================================================
-- WHAT THIS IS FOR
-- ===========================================================================
-- A document is either OURS — uploaded through `bk sales upload`, stored in
-- Vercel Blob, counted by `platform.blob_references` — or it points at somebody
-- else's system, a Google Drive link today. Until now the two were
-- indistinguishable: `upload_url` vs `external_url` recorded the difference in
-- the schema and every surface rendered them as the same grey row.
--
-- That mattered more than it looked. The two differ in ways a reader needs:
-- we can delete one and must never delete the other; one renders for anyone who
-- can see the record and the other only for someone already granted access in a
-- system we do not run.
--
-- ===========================================================================
-- WE STORE THE DECISION, NOT THE DERIVATION
-- ===========================================================================
-- `packages/platform-file-providers` derives the media kind, the embed url and
-- the thumbnail from the url on every read. Those are NOT columns here, on
-- purpose: improving the recogniser then improves every existing row with no
-- backfill, and a stored copy is a second fact that drifts.
--
-- What IS stored is what cannot be recomputed:
--
--   storage_provider    the decision made at write time. Makes
--                       `bk sales doc list --provider google_drive` a query
--                       rather than a scan, and survives a change to parsing.
--   external_id         the provider's own handle — a Drive file id. Durable
--                       even if the url shape changes.
--   preview_status      a PROBE RESULT. Cannot be recomputed without a network
--                       call, which is the whole reason it is a column.
--   preview_checked_at  when we last asked.
--
-- ===========================================================================
-- THE BACKFILL REUSES `platform.is_uploaded_asset` RATHER THAN RE-IMPLEMENTING
-- ===========================================================================
-- The one question SQL must answer here is "is this ours?", because that is the
-- delete-gate-relevant half — and Postgres already has the authority for it:
-- `platform.is_uploaded_asset`, the same function the blob triggers consult.
-- Using it means there is no second copy of that rule and no way for the two to
-- disagree.
--
-- The OTHER question — *which* external provider — is deliberately left NULL.
-- Recognising a Drive url is implemented once, in TypeScript, and transcribing
-- that regex into SQL is exactly the two-hand-maintained-lists failure this repo
-- keeps finding. So external rows are classified by the app: on the next write,
-- or in one pass with `bk sales doc recheck --all`.
--
-- **NULL therefore means "not yet classified", not "unknown kind of file".** The
-- API never depends on it — `publicDocument` derives the provider from the url
-- on every read, so the screen is right even while the column lags. Only the
-- `--provider` FILTER sees the lag, which is why the recheck command exists and
-- why the changelog says to run it once.
--
-- ===========================================================================
-- NO NEW TRIGGERS, AND THAT IS THE CORRECT ANSWER
-- ===========================================================================
-- Not an oversight — the reasoning is worth writing down because "a migration
-- that adds columns and no trigger" is the shape CLAUDE.md warns about.
--
--   storage_provider, external_id, preview_status   vocabulary/id/enum values,
--       none of which can hold a url. The route validates all three.
--   preview_checked_at                              a timestamp.
--
-- And `external_url` — the column that actually holds the Drive link — is
-- ALREADY covered by `trg_blob_refs_url` in `exact` mode from migration 0002.
-- A Drive url passed to `platform.is_uploaded_asset` returns false, so it
-- produces no index row, which is exactly right: **we must never let the delete
-- gate think it is responsible for a file in somebody else's Drive.**
-- `lib/storage/scanner.ts` is therefore unchanged by this migration, and
-- `scanner.test.ts` staying green is the assertion of that.
--
-- Re-runnable: `IF NOT EXISTS` throughout; the backfill is idempotent.

ALTER TABLE "sales"."documents" ADD COLUMN IF NOT EXISTS "storage_provider" varchar(32);--> statement-breakpoint
ALTER TABLE "sales"."documents" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);--> statement-breakpoint
-- `public | restricted | unknown`. NULL means never probed, or not applicable
-- (our own files are always viewable by anyone who can see the record).
ALTER TABLE "sales"."documents" ADD COLUMN IF NOT EXISTS "preview_status" varchar(16);--> statement-breakpoint
ALTER TABLE "sales"."documents" ADD COLUMN IF NOT EXISTS "preview_checked_at" timestamptz;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_ws_provider ON sales.documents (workspace_id, storage_provider);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- document_strategies — the fourth thing a document can hang off
-- ---------------------------------------------------------------------------
-- #40 asks for one item attached to "a prospect, a product, a strategy doc, a
-- template". Three of those four already worked (0001's link tables); strategies
-- only came into existence in migration 0010, so this is the one that was
-- genuinely missing.
CREATE TABLE IF NOT EXISTS sales.document_strategies (
  document_id integer NOT NULL REFERENCES sales.documents(id) ON DELETE CASCADE,
  strategy_id integer NOT NULL REFERENCES sales.strategies(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, strategy_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_document_strategies_strategy ON sales.document_strategies (strategy_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL — only the half SQL is the authority for. See the header.
-- ---------------------------------------------------------------------------
-- Guarded on NULL so a re-run does not overwrite a value the app has since
-- classified. `coalesce` because exactly one of the two url columns is set (the
-- `documents_one_location` CHECK from 0001 enforces it).
UPDATE sales.documents
   SET storage_provider = 'blob'
 WHERE storage_provider IS NULL
   AND platform.is_uploaded_asset(coalesce(upload_url, external_url));
