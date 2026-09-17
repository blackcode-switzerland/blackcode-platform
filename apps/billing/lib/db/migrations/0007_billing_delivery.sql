-- b/billing, migration 0007 — delivery: when a bill was sent, by what message,
-- carrying which bytes. Phase 3, docs/billing-app-plan/phase-3-lifecycle-and-delivery.md.
--
-- ===========================================================================
-- THREE COLUMNS, AND WHAT A NULL IN EACH ONE SAYS
-- ===========================================================================
-- | column            | null means                                              |
-- |-------------------|---------------------------------------------------------|
-- | `sent_at`         | never sent. A `sent` or `paid` invoice may not have one  |
-- | `sent_message_id` | not sent BY THIS APP — `mark-sent`, paper, another inbox |
-- | `pdf_sha256`      | no fingerprint, because this app did not attach the PDF  |
--
-- `sent_message_id` being null on a sent invoice is a FACT, not a gap: "sent by
-- us, here is the message" and "sent somehow, we were told" are different
-- statements, and the null is how the second one is made. That is why
-- `mark-sent` is its own route rather than a flag on `send`.
--
-- ===========================================================================
-- G2 IS REPLACED, AND THIS IS WHY A MIGRATION THE PLAN SAID "NEEDS NO CHANGE"
-- CHANGES IT
-- ===========================================================================
-- Phase 3 is the first phase in which an invoice can leave `draft` through the
-- product, so it is the first phase in which G2's column list is load-bearing.
-- Reading it against the columns found two omissions and one new obligation:
--
--   1. `language` was in NEITHER list. 0005's header names the frozen columns
--      and the still-writable ones, and `language` is in neither — yet it
--      decides every literal on the document and on the payment part. A sent
--      bill whose language could still be switched would re-render as a
--      different document from the one the client holds.
--   2. `vat_rate` (the invoice-level prefill) was frozen by the APP's
--      `DOCUMENT_FIELDS` and not by the trigger, while that set's own comment
--      said "Mirrors 0005's trigger". It did not. Harmless in effect — the
--      lines carry the rates and the lines are frozen — but a mirror that does
--      not mirror is a claim about protection, and CLAUDE.md finding #18 is
--      what those turn into. `lib/db/queries/frozen-fields.test.ts` now reads
--      this function and the app's set and fails when they disagree.
--   3. The three delivery columns are facts about something that HAPPENED.
--      Once written they are frozen with the document: a message id that could
--      be edited is not evidence of a message.
--
-- The "still writable" list is unchanged: `message`, `due_date`, `paid_date`,
-- `status`, `void`, `external_ref`, `metadata`, `updated_at`.

ALTER TABLE billing.invoice ADD COLUMN IF NOT EXISTS sent_at timestamptz;--> statement-breakpoint
-- Resend's ids are UUIDs today. 255 because the column records whatever the
-- transport answered, and a transport change must not become a migration.
ALTER TABLE billing.invoice ADD COLUMN IF NOT EXISTS sent_message_id varchar(255);--> statement-breakpoint
-- Of the bytes ACTUALLY ATTACHED, not of a re-render. Position P10: the PDF is
-- regenerated on demand rather than stored, so this is how "is this the bill we
-- sent?" stays answerable without keeping a blob.
ALTER TABLE billing.invoice ADD COLUMN IF NOT EXISTS pdf_sha256 char(64);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL, BEFORE THE CHECKS — AND WHY IT TOUCHES NO REAL DOCUMENT
-- ---------------------------------------------------------------------------
-- The CHECK below refuses a `sent`/`paid` invoice with no `sent_at`. Before this
-- migration nothing set one, so any database that walked the status machine —
-- the dev seed does, by design — holds rows that would fail it.
--
-- b/billing has never been deployed (devops/release.sh refuses until a real
-- Vercel project id exists), so these rows exist only in development
-- databases. `updated_at` is the best available approximation of when the
-- status last moved; it is not a claim about a real delivery, because there has
-- never been one. On a production database this statement updates zero rows.
UPDATE billing.invoice
   SET sent_at = updated_at
 WHERE status IN ('sent', 'paid')
   AND sent_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE DELIVERY CHECKS
-- ---------------------------------------------------------------------------
-- A bill that is sent has a moment it was sent. Without this, a plain
-- `UPDATE … SET status = 'sent'` from a console would produce an invoice the
-- product believes is out the door with no record of when — the exact shape of
-- the seed's old status walk, which this constraint forced into the open.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_sent_requires_sent_at
  CHECK (status NOT IN ('sent', 'paid') OR sent_at IS NOT NULL);--> statement-breakpoint

-- A message this app sent always carried a document, and the fingerprint of that
-- document is the point of recording the message at all.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_message_requires_fingerprint
  CHECK (sent_message_id IS NULL OR pdf_sha256 IS NOT NULL);--> statement-breakpoint

-- Delivery facts do not exist without a delivery moment.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_delivery_requires_sent_at
  CHECK ((sent_message_id IS NULL AND pdf_sha256 IS NULL) OR sent_at IS NOT NULL);--> statement-breakpoint

-- Lowercase hex, 64 characters: what `createHash('sha256').digest('hex')`
-- produces. `char(64)` pads a short value with spaces instead of refusing it,
-- so the length is not evidence of the shape — this is.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_pdf_sha256_shape
  CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G2, REPLACED IN PLACE
-- ---------------------------------------------------------------------------
-- Same function name, so the trigger 0005 created keeps pointing at it and no
-- DROP/CREATE TRIGGER is needed. `CREATE OR REPLACE` is transactional with the
-- rest of this migration.
CREATE OR REPLACE FUNCTION billing.invoice_document_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  frozen text;
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- FROZEN-FIELDS: the list `lib/db/queries/frozen-fields.test.ts` reads. Keep
  -- one `WHEN NEW.<col>` per line; the test extracts them with a pattern.
  frozen := CASE
    WHEN NEW.currency           IS DISTINCT FROM OLD.currency           THEN 'currency'
    WHEN NEW.language           IS DISTINCT FROM OLD.language           THEN 'language'
    WHEN NEW.ref_type           IS DISTINCT FROM OLD.ref_type           THEN 'ref_type'
    WHEN NEW.ref_body           IS DISTINCT FROM OLD.ref_body           THEN 'ref_body'
    WHEN NEW.client             IS DISTINCT FROM OLD.client             THEN 'client'
    WHEN NEW.vat_rate           IS DISTINCT FROM OLD.vat_rate           THEN 'vat_rate'
    WHEN NEW.prices_include_vat IS DISTINCT FROM OLD.prices_include_vat THEN 'prices_include_vat'
    WHEN NEW.issue_date         IS DISTINCT FROM OLD.issue_date         THEN 'issue_date'
    WHEN NEW.sent_at            IS DISTINCT FROM OLD.sent_at            THEN 'sent_at'
    WHEN NEW.sent_message_id    IS DISTINCT FROM OLD.sent_message_id    THEN 'sent_message_id'
    WHEN NEW.pdf_sha256         IS DISTINCT FROM OLD.pdf_sha256         THEN 'pdf_sha256'
    ELSE NULL
  END;

  IF frozen IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % is % and its % is part of the sent document', OLD.number, OLD.status, frozen
      USING HINT = 'void it with a reason and reissue; message, due_date, paid_date and status stay editable';
  END IF;

  RETURN NEW;
END $$;
