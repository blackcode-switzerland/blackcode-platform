-- Roll back b/billing migration 0001 — the whole schema.
--
-- **THIS DESTROYS EVERY ROW THIS APP HAS.** `DROP SCHEMA … CASCADE` takes the
-- tenancy, the memberships, the invitations and the counter with it, and from
-- phase 1 it takes every company, invoice, line and audit row as well.
--
-- There is no scenario in which this is the right thing to run against a
-- database holding real invoices. An invoice is a numbered legal document under
-- a ten-year retention duty (art. 958f CO); losing one is not a data-loss
-- incident, it is a compliance one. This file exists because
-- docs/adding-an-app.md asks for one rollback per migration, and because an
-- UNDOCUMENTED rollback is worse — somebody writes it from memory at the moment
-- they are least able to.
--
-- Run as the MIGRATOR (`neondb_owner`). `billing_app` owns nothing and cannot
-- drop anything, which is the point of the role model.
\set ON_ERROR_STOP on

-- The migration ledger entry goes too, or the next `drizzle-kit migrate` sees a
-- high-water mark above 0001 and skips recreating it — leaving an app whose
-- schema does not exist and whose ledger says it does. That is the same class of
-- failure as omitting the `drizzle` schema from an extraction dump
-- (docs/extracting-an-app.md), and it is the half people forget.
DELETE FROM drizzle.__drizzle_migrations_billing
 WHERE hash IN (
   SELECT hash FROM drizzle.__drizzle_migrations_billing ORDER BY created_at DESC
 );

DROP SCHEMA IF EXISTS billing CASCADE;

-- The `platform.apps` row is NOT dropped here, deliberately. Removing it is
-- `docs/sql/billing-app-unregister.sql`'s job and a separate decision: an
-- enabled row for an app whose schema is gone is harmless (the blob gate asks it
-- nothing, because `maintains_blob_index` describes an index that no longer
-- exists and refusing is the safe answer), whereas deleting the row while the
-- schema survives makes `bk billing` unroutable on every machine.
--
-- If you are removing the app for good, read docs/extracting-an-app.md first —
-- its "what an extraction still owes" section is the list nobody remembers.
