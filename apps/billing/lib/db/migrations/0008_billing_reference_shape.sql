-- b/billing, migration 0008 — the reference body, in the shape a bank accepts.
-- Ticket #84, docs/billing-app-plan/phase-2-references-qr-and-pdf.md.
--
-- ===========================================================================
-- 0005 ALLOWED A SCOR BODY OF 25 CHARACTERS. ISO 11649 ALLOWS 21.
-- ===========================================================================
-- A creditor reference is at most 25 characters IN TOTAL: `RF`, two check
-- digits, and the body. 0005's `invoice_scor_matrix_check` put the 25 on the
-- body, so a 22-to-25-character body passed the database and produced a
-- reference of 26 to 29 characters that no bank will take. It also accepted a
-- body containing punctuation, which ISO 11649 does not allow at all.
--
-- The phase-1 seed was carrying exactly such a row (a 24-digit SCOR body) and
-- nothing noticed, because nothing computed the reference until
-- `lib/qr/reference.ts` existed. The write door refuses both cases now
-- (`referenceBodyProblem`); this is the half that holds for every writer.
--
-- The QRR CHECK gains the one rule it was missing: a QR reference may not
-- consist only of zeros (§2.12.1). A body of 26 zeros derives check digit 0,
-- and the resulting reference is all zeros.
--
-- ===========================================================================
-- IT REFUSES, WITH NAMES, RATHER THAN REWRITING A ROW
-- ===========================================================================
-- A sent invoice's reference is frozen by G2 and is printed on a document a
-- client holds; changing it here would change a bill after the fact. So if any
-- row violates the new rules, this migration stops and lists them. b/billing
-- has never been deployed, so on production this finds nothing; on a
-- development database, re-run `npm run db:seed:billing` first.

DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('%s (%s %s)', number, ref_type, ref_body), ', ' ORDER BY id)
    INTO offenders
    FROM billing.invoice
   WHERE (ref_type = 'SCOR' AND (ref_body IS NULL OR ref_body !~ '^[A-Za-z0-9]{1,21}$'))
      OR (ref_type = 'QRR' AND ref_body ~ '^0+$');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'invoices carry a payment reference no bank accepts: %', offenders
      USING HINT = 'a SCOR body is 1–21 letters or digits and a QRR body is not all zeros; on a development database, re-seed before migrating';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE billing.invoice DROP CONSTRAINT IF EXISTS invoice_scor_matrix_check;--> statement-breakpoint
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_scor_matrix_check
  CHECK (
    ref_type <> 'SCOR'
    OR (ref_body IS NOT NULL AND ref_body ~ '^[A-Za-z0-9]{1,21}$')
  );--> statement-breakpoint

ALTER TABLE billing.invoice DROP CONSTRAINT IF EXISTS invoice_qrr_matrix_check;--> statement-breakpoint
ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_qrr_matrix_check
  CHECK (
    ref_type <> 'QRR'
    OR (currency = 'CHF' AND ref_body IS NOT NULL AND ref_body ~ '^[0-9]{26}$' AND ref_body !~ '^0+$')
  );
