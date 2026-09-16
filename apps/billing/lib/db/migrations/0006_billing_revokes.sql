-- b/billing, migration 0006 — what the app role may NOT do.
--
-- The privilege half of G5 and of the append-only audit log. 0005 has the
-- triggers; this has the revokes, and **both, deliberately**:
--
--   - the TRIGGER stops anything running as owner — a migration, a console
--     session, a script somebody wrote in a hurry at the end of a long day
--   - the REVOKE stops the app before the statement is attempted, and shows up
--     in `\dp` where a reviewer will see it without reading any plpgsql
--
-- Neither alone is the whole guard, and the pair is what `apps/books`'
-- 0005_app_role_grants.sql argues for at length.
--
-- ===========================================================================
-- WHERE THIS DISAGREES WITH THE OBVIOUS READING, AND WHY
-- ===========================================================================
-- **`UPDATE` is NOT revoked on `invoice` or `invoice_line`.** The tempting
-- version of "an invoice is immutable" revokes both, and it would break the
-- app's main loop: editing a draft is what the product does all day.
--
-- Immutability here is per COLUMN and per STATUS — G1 freezes the number, G2
-- freezes the document once it is sent — and a table-level revoke cannot express
-- either. It cannot tell an amount from a payment message, and only one of those
-- is a legal fact.
--
-- `apps/books` reached the same conclusion against its own plan, which had said
-- to revoke UPDATE on the posted ledger. Its migration 0005 records the reversal
-- and the reason: the app's main loop needed it.
--
-- **`DELETE` is NOT revoked on `invoice_line`.** Removing a line from a draft is
-- half of editing it. `trg_invoice_line_frozen` refuses the DELETE once the
-- invoice is no longer a draft, which is where the retention rule actually
-- applies. Revoking it here would make a draft uneditable.

DO $$
BEGIN
  -- Guarded on the role, like 0003. A revoke against a missing role is an error
  -- that would fail the whole migration; skipping with a WARNING keeps a fresh
  -- database migratable before it is provisioned. **A skipped revoke is not
  -- fixed by re-running** — Drizzle records the migration applied — so if you
  -- provision the role after migrating, replay this file by hand.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
    RAISE WARNING 'role billing_app does not exist: revokes SKIPPED. Create the role, then replay 0006 by hand.';
    RETURN;
  END IF;

  -- ------------------------------------------------------------------------
  -- NOTHING IS EVER DELETED (art. 958f CO, ten-year retention)
  -- ------------------------------------------------------------------------
  -- An invoice is voided with a reason and keeps its number. An audit row is
  -- permanent. A company is retired with `retired_at`, because past invoices
  -- reference it and a statement for a past year has to render.
  REVOKE DELETE ON billing.invoice FROM billing_app;
  REVOKE DELETE ON billing.audit   FROM billing_app;
  REVOKE DELETE ON billing.company FROM billing_app;

  -- ------------------------------------------------------------------------
  -- THE AUDIT LOG IS APPEND-ONLY
  -- ------------------------------------------------------------------------
  -- Rewriting an audit row is worse than deleting one: a deleted row leaves a
  -- gap in the sequence that both `uq_audit_ws_seq` and a reader can notice,
  -- while an edited row leaves a plausible lie.
  REVOKE UPDATE ON billing.audit FROM billing_app;

  -- ------------------------------------------------------------------------
  -- THE ALLOCATOR IS NOT RUNTIME-EDITABLE BY HAND
  -- ------------------------------------------------------------------------
  -- `company.next_seq` is bumped by the allocator's own `UPDATE … RETURNING`,
  -- which is an ordinary UPDATE the app role still holds — so this is not a
  -- revoke, it is a note about why there ISN'T one.
  --
  -- A column-level `REVOKE UPDATE (next_seq)` would break the allocator itself.
  -- What protects the sequence is that nothing else writes the column: the only
  -- statement that touches it is in lib/db/queries/seq.ts, and the write door
  -- refuses `next_seq` in any company PATCH body. A test asserts that refusal,
  -- because it is the one rule here with no database object behind it.

  RAISE INFO 'billing_app revokes applied: no DELETE on invoice/audit/company, no UPDATE on audit.';
END
$$;
