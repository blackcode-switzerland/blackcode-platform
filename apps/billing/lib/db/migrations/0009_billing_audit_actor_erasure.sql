-- b/billing, migration 0009 — an account that wrote to the audit log can be
-- hard-deleted, as its foreign key always said.
--
-- ===========================================================================
-- THE BUG: 0005'S APPEND-ONLY TRIGGER REFUSED ITS OWN FOREIGN KEY
-- ===========================================================================
-- `billing.audit.actor_user_id` is `REFERENCES platform.users ON DELETE SET
-- NULL` (0004): a removed account leaves its audit rows in place with no actor,
-- and `listAudit`'s LEFT JOIN exists for exactly those rows. But the SET NULL is carried out as an UPDATE
-- on `billing.audit`, and 0005's `trg_audit_append_only` refuses every UPDATE.
--
-- So a hard DELETE of any person who had ever written a billing audit row
-- failed:
--
--   ERROR:  billing.audit is append-only (row 999999 of workspace 16)
--   CONTEXT: … UPDATE ONLY "billing"."audit" SET "actor_user_id" = NULL …
--
-- Measured 2026-09-18 against the local database, inside a transaction that was
-- rolled back.
--
-- ── HOW MUCH THIS MATTERED: LITTLE, TODAY ──────────────────────────────────
-- **Closing an account does not hard-delete it.** `softDeleteUser`
-- (packages/platform-db/src/account.ts) is an UPDATE setting `deleted_at`, which
-- fires no delete rule, and no code path in the repo issues
-- `DELETE FROM platform.users`. So no account close through the product was ever
-- refused. What was refused is the one case the foreign key exists for — a
-- genuine hard delete, run by a person with the owner credential, such as an
-- erasure request — and it was refused on b/billing's account even when the
-- request started from another app, because `platform.users` is shared.
--
-- It is fixed rather than documented because the column's declared behaviour
-- and the database's actual behaviour disagreed, and the next person to read
-- `ON DELETE SET NULL` would believe the declaration.
--
-- `invoice.created_by` is the same shape and was probed the same way: its
-- triggers guard named columns, not the row, so the SET NULL goes through.
-- `company.created_by` has no UPDATE trigger at all (catalog read, same day).
--
-- ===========================================================================
-- THE FIX: EXACTLY ONE UPDATE IS PERMITTED
-- ===========================================================================
-- The one that turns a non-null `actor_user_id` into NULL **and changes nothing
-- else**. Compared as whole rows with that column removed, so a column added to
-- the table later is covered without anybody remembering to list it here.
--
-- It is not a way to rewrite an entry. It cannot change what was done, when, to
-- what, or with which values — only forget who, which is what closing an account
-- means. `billing_app` still cannot issue it at all: 0006 revokes UPDATE on this
-- table from the app role, and a foreign-key action runs as the table's owner.
--
-- `billing.history` (0010) needs the same exemption for the same reason, and
-- has its own copy of it rather than sharing this function: the two tables'
-- rules may part ways, and a shared trigger function is a change to one that
-- silently changes the other.
CREATE OR REPLACE FUNCTION billing.audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.actor_user_id IS NOT NULL
     AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing.audit is append-only (row % of workspace %)', OLD.seq, OLD.workspace_id
    USING HINT = 'the log IS the edit workflow; correct a record by appending, never by rewriting';
END $$;
