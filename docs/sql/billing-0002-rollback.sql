-- Roll back b/billing migration 0002 — the blob-reference coverage flag.
--
-- ===========================================================================
-- READ THIS BEFORE RUNNING IT. IT BREAKS FILE DELETION FOR EVERY OTHER APP.
-- ===========================================================================
-- Setting `maintains_blob_index = false` while the `platform.apps` row is still
-- ENABLED means no deployment can establish that a file is unreferenced, because
-- one registered app cannot answer. Blob deletion is then refused
-- platform-wide — in issues, in sales, in books — until this is undone.
--
-- That is the SAFE direction of the failure, and it is still an outage. If you
-- are rolling 0002 back as part of removing the app, disable the row first:
--
--   UPDATE platform.apps SET enabled = false WHERE slug = 'billing';
--
-- A disabled app is invisible to the gate, so the refusal stops.
\set ON_ERROR_STOP on

UPDATE platform.apps SET maintains_blob_index = false WHERE slug = 'billing';

-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT UNDO
-- ---------------------------------------------------------------------------
-- The `EXECUTE` grant on `platform.blob_refs_purge`. 0002's DO block grants it
-- to every `<slug>_app` role that exists, so revoking it here would take it away
-- from `issues_app`, `sales_app` and `books_app` as well — apps this rollback
-- has nothing to do with. Revoke it for this app alone if you mean to:
--
--   REVOKE EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint)
--     FROM billing_app;
--
-- And `platform.blob_refs_sync` is NOT dropped. It is platform-owned, created by
-- issues' 0037, and this app never created it. An app's rollback dropping a
-- shared function is the shape of failure the per-app role model exists to make
-- impossible; this file states it because a reader reaching for "undo
-- everything 0002 touched" would otherwise have to work it out.
