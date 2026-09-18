-- b/billing, migration 0011 — an issued invoice carries its own copy of who
-- issued it. Phase 2, ticket #86; DATA-MODEL invariant I12.
--
-- ===========================================================================
-- THE GAP THIS CLOSES
-- ===========================================================================
-- I12: "Sent documents render from their own snapshot; changes in borrowed
-- sources (client address, VAT rate, bank account) affect FUTURE invoices only."
--
-- G2 (0005, 0007) froze the half of that which lives ON the invoice: the client
-- block, the lines, the currency, the reference. It could not freeze the other
-- half, because the other half was not on the invoice at all — the issuer's
-- legal name, address and ACCOUNT were read from `billing.company` on every
-- render. So editing a company's IBAN changed the account every unpaid bill it
-- had ever sent pointed at, and editing its `rounding` policy changed their
-- totals. `lib/invariants.test.ts` asserted that gap by name from 2026-09-18
-- until this migration.
--
-- ===========================================================================
-- THE SHAPE: ONE jsonb COLUMN, NULL EXACTLY WHILE THE INVOICE IS A DRAFT
-- ===========================================================================
-- | status        | issuer   | the document renders from        |
-- |---------------|----------|----------------------------------|
-- | draft         | NULL     | the company, as it is NOW        |
-- | anything else | an object| that object, forever             |
--
-- A draft has no snapshot ON PURPOSE: a draft is not a document yet, and a
-- company correction made before it goes out must reach it. The copy is taken
-- at the moment it leaves `draft` — send, mark-sent, or a void from draft — by
-- the write that moves the status, from the company row it rendered from. The
-- app writes it (not a trigger reading `billing.company`) so that the bytes that
-- were mailed and the snapshot that is stored come from ONE read of the company:
-- a trigger would read the row a second time, later, and a company edit landing
-- between the two would store a snapshot that is not what the client received.
--
-- What the database enforces is that the write cannot FORGET and nobody can
-- REVISE: the iff-CHECK below, the shape CHECK, and `issuer` in G2's list.
--
-- jsonb and not seventeen columns: it is read whole, written once and never
-- queried by field. The keys are `ISSUER_FIELDS` in lib/issuer.ts, and
-- `lib/issuer.test.ts` holds that list, this migration's backfill and the shape
-- CHECK to one another.

ALTER TABLE billing.invoice ADD COLUMN IF NOT EXISTS issuer jsonb;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL, BEFORE G2 LEARNS THE COLUMN — AND WHAT IT HONESTLY IS
-- ---------------------------------------------------------------------------
-- Every invoice that already left `draft` gets the company AS IT IS TODAY, not
-- as it was when the bill went out: that moment's values were never recorded,
-- which is the gap. Each such row says so — `"backfilled": true` — so nobody
-- reads it later as evidence of what a client was sent.
--
-- b/billing has never been deployed, so these rows exist only in development
-- databases. On a production database this statement updates zero rows.
--
-- It must run BEFORE the function below is replaced: once `issuer` is in G2's
-- list, setting it on a non-draft row is refused.
-- ISSUER-BACKFILL: the key list `lib/issuer.test.ts` reads.
UPDATE billing.invoice i
   SET issuer = jsonb_build_object(
         'name', c.name,
         'legal_name', c.legal_name,
         'street', c.street,
         'building', c.building,
         'postal_code', c.postal_code,
         'city', c.city,
         'country', c.country,
         'email', c.email,
         'logo_initials', c.logo_initials,
         'logo_color', c.logo_color,
         'iban', c.iban,
         'qr_iban', c.qr_iban,
         'vat_registered', c.vat_registered,
         'uid', c.uid,
         'vat_number', c.vat_number,
         'rounding', c.rounding,
         'footer_fr', c.footer_fr,
         'footer_en', c.footer_en,
         'captured_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'backfilled', true
       )
  FROM billing.company c
 WHERE c.id = i.company_id
   AND i.status <> 'draft'
   AND i.issuer IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE CHECKS
-- ---------------------------------------------------------------------------
-- IFF, not "issued ⇒ snapshot". The other direction matters as much: a draft
-- carrying a snapshot would render from a company as it WAS, and the correction
-- somebody made before sending would silently not apply.
--
-- `IS NULL` yields true or false, never NULL, so this comparison cannot fall
-- into the trap 0010's flag CHECK did (`NULL AND true` is NULL, and a CHECK
-- treats NULL as satisfied).
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_issuer_iff_issued
  CHECK ((status = 'draft') = (issuer IS NULL));--> statement-breakpoint

-- An object, with every key present. Presence, not non-null: `qr_iban` is null
-- for a company that has none, and that null is part of the snapshot. `?&` is
-- "has ALL of these keys".
-- ISSUER-SHAPE: the key list `lib/issuer.test.ts` reads.
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_issuer_shape
  CHECK (
    issuer IS NULL OR (
      jsonb_typeof(issuer) = 'object'
      AND issuer ?& ARRAY[
        'name', 'legal_name', 'street', 'building', 'postal_code', 'city', 'country',
        'email', 'logo_initials', 'logo_color', 'iban', 'qr_iban',
        'vat_registered', 'uid', 'vat_number', 'rounding', 'footer_fr', 'footer_en',
        'captured_at'
      ]
      AND jsonb_typeof(issuer -> 'legal_name') = 'string'
      AND jsonb_typeof(issuer -> 'rounding') = 'string'
    )
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- G2, REPLACED IN PLACE — `issuer` JOINS THE FROZEN LIST
-- ---------------------------------------------------------------------------
-- Same function name, so 0005's trigger keeps pointing at it. A draft's UPDATE
-- returns early, which is what lets the leaving-draft write set the column; from
-- then on it is part of the sent document like the client block beside it.
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
    WHEN NEW.issuer             IS DISTINCT FROM OLD.issuer             THEN 'issuer'
    ELSE NULL
  END;

  IF frozen IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % is % and its % is part of the sent document', OLD.number, OLD.status, frozen
      USING HINT = 'void it with a reason and reissue; message, due_date, paid_date and status stay editable';
  END IF;

  RETURN NEW;
END $$;
