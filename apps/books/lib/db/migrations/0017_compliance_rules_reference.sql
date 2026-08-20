-- b/books, migration 0017 — the nineteen compliance rules become reference data.
--
-- ===========================================================================
-- WHY: THE RULES SHIPPED ONLY IN THE DEV SEED, SO PRODUCTION HAD NONE
-- ===========================================================================
-- Measured 2026-08-20 on a database migrated from empty, with no seed:
--
--   SELECT count(*) FROM books.compliance_rule;  -> 0
--
-- `bk books compliance list` promises "all 19 rules"; `compliance review`
-- signs one off; `bk books verdict` files against one. On a real deployment
-- every one of those addressed an EMPTY TABLE, and the whole compliance
-- surface answered nothing while reporting no error.
--
-- The cause: the only INSERT lived in `lib/db/seed.ts`, reading
-- `fixtures/compliance-rules.json` — and that seed refuses any non-local host
-- by design, because it rebuilds the demo workspace destructively. So the rules
-- could reach a developer machine and could not reach anywhere else. It stayed
-- invisible for as long as every test ran on seeded data; migrating an empty
-- database is what showed it.
--
-- These rows are REFERENCE DATA, not fixtures: law-derived, workspace-less,
-- identical in every deployment. That is a migration's job. The seed keeps its
-- own copy of the loop and both are `ON CONFLICT (rule_id) DO NOTHING`, so
-- whichever runs second changes nothing.
--
-- ── WHAT IS DELIBERATELY NOT SET HERE ──────────────────────────────────────
-- `review_state` defaults to 'draft' and this file never touches it. These
-- rules were researched against Fedlex by an agent and NOT reviewed by a
-- fiduciary — the fixture's own `_meta.status` says exactly that. Installing
-- them as 'approved' would launder that provenance into the one table meant to
-- record it. A fiduciary approves them one at a time through
-- `bk books compliance review`, and DO NOTHING means re-running this migration
-- can never reset that work to draft.
--
-- Rollback: docs/sql/books-0017-rollback.sql — it deletes only rules still in
-- 'draft', so a reviewed rule survives a rollback.

INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'bk-001',
  'art. 957 al. 1 ch. 2 CO',
  'SA',
  'Entity legal form is SA or Sarl, regardless of turnover',
  'IF entity.legal_form IN (''SA'',''Sarl'') AND entity.bookkeeping_regime != ''double_entry'' THEN flag BLOCKER',
  'blocker',
  'SA/Sarl have no simplified-bookkeeping option at any turnover level; single-entry books are not valid statutory accounts.',
  '{"fr":"Une SA/Sàrl n''a JAMAIS d''option simplifiée, quel que soit le chiffre d''affaires.","en":"An SA/Sàrl NEVER has a simplified option, at any turnover."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'bk-002',
  'art. 957 al. 2 CO',
  'RI',
  'RI/partnership with annual revenue < CHF 500,000 in the prior financial year',
  'IF entity.legal_form = ''RI'' AND entity.prior_year_revenue < 500000 THEN allow simplified regime BUT recommend double_entry anyway (per b/books design decision, see BRIEF.md sec 2.1)',
  'info',
  'N/A — this is a permissive floor, not a requirement. b/books runs double-entry for RI anyway.',
  '{"fr":"RI < CHF 500''000 : régime simplifié permis (plancher permissif, pas une obligation).","en":"RI < CHF 500,000: simplified regime allowed (permissive floor, not a duty)."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'ret-001',
  'art. 958f al. 1 CO',
  'both',
  'Any ledger, voucher, or supporting document (pièce justificative) reaches or passes 10 years from creation without confirmed retention',
  'IF document.age_years >= 10 AND document.retention_confirmed = FALSE THEN flag WARNING',
  'warning',
  'Deletion or loss before the 10-year mark breaches the statutory retention duty; documents needed in a later tax audit may be unavailable.',
  '{"fr":"Conservation 10 ans des livres et pièces.","en":"10-year retention of books and documents."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'ret-002',
  'art. 958f al. 3 CO',
  'both',
  'Records stored only in a format/medium that cannot be reliably read back on demand (e.g. proprietary format with no export, or degraded scan)',
  'IF record.readback_verified = FALSE THEN flag BLOCKER at storage time',
  'blocker',
  'If records cannot be reliably linked or read back, the retention obligation is deemed unfulfilled — treated equivalent to non-retention in a tax audit.',
  '{"fr":"Les enregistrements doivent rester lisibles/restituables pendant toute la durée.","en":"Records must stay readable/retrievable for the whole period."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'ret-003',
  'art. 958f al. 2 CO',
  'both',
  'Year-end close event (rapport de gestion approved) with no printed and signed archival copy',
  'IF event = ''annual_accounts_approved'' AND archive.has_signed_printed_copy = FALSE THEN flag WARNING',
  'warning',
  'Weakens evidentiary value of governance documents in disputes; may be challenged by auditors/registrar.',
  '{"fr":"Comptes annuels approuvés : exemplaire signé et imprimé archivé.","en":"Approved annual accounts: signed printed copy archived."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'ret-004',
  'art. 957a al. 2 ch. 1 CO (principe de régularité) + immutability doctrine',
  'both',
  'A posted (closed-period) transaction is edited in place or hard-deleted instead of reversed via correcting entry',
  'IF transaction.status = ''posted'' AND action IN (''edit_in_place'',''hard_delete'') THEN flag BLOCKER',
  'blocker',
  'Undermines traceability and regularity of the books (art. 957a al.2 ch.5); can be treated as falsification of business records in serious cases.',
  '{"fr":"Jamais d''édition/suppression d''une écriture comptabilisée — extourne uniquement.","en":"Never edit/delete a posted entry — reversing entries only."}'::jsonb,
  'doctrine_inferred'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-001',
  'art. 10 al. 2 let. a LTVA',
  'both',
  'Worldwide annual taxable turnover reaches or exceeds CHF 100,000 in 12 months',
  'IF entity.annual_taxable_turnover_worldwide >= 100000 AND entity.vat_registered = FALSE THEN flag BLOCKER',
  'blocker',
  'Retroactive VAT liability, late-registration penalties, default interest on unremitted VAT.',
  '{"fr":"Assujettissement obligatoire dès CHF 100''000 de chiffre d''affaires.","en":"Mandatory VAT registration from CHF 100,000 turnover."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-002',
  'art. 26 al. 2 let. a LTVA',
  'both',
  'VAT invoice missing supplier name/locality or UID number',
  'IF invoice.type = ''VAT_invoice'' AND (invoice.supplier_name IS NULL OR invoice.supplier_uid_number IS NULL) THEN flag BLOCKER',
  'blocker',
  'Input-tax (impôt préalable) deduction may be denied by the AFC.',
  '{"fr":"Facture sans nom/UID fournisseur : impôt préalable en danger.","en":"Invoice without supplier name/UID: input VAT at risk."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-003',
  'art. 26 al. 2 let. b LTVA',
  'both',
  'Invoice missing recipient name/locality',
  'IF invoice.type = ''VAT_invoice'' AND invoice.recipient_name IS NULL THEN flag WARNING ''check art.26 al.3 cash-register exception before treating as blocker''',
  'warning',
  'Can jeopardize input-tax deduction absent a qualifying simplified-receipt exception.',
  '{"fr":"Destinataire manquant — vérifier l''exception ticket de caisse.","en":"Missing recipient — check the cash-register exception."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-004',
  'art. 26 al. 2 let. c LTVA',
  'both',
  'Invoice date differs from supply date/period with no stated supply date/period',
  'IF invoice.supply_date != invoice.invoice_date AND invoice.stated_supply_date_or_period IS NULL THEN flag WARNING',
  'warning',
  'Ambiguity on VAT period can delay/deny input-tax deduction.',
  '{"fr":"Date/période de prestation ambiguë.","en":"Ambiguous supply date/period."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-005',
  'art. 26 al. 2 let. d LTVA',
  'both',
  'Invoice lacks description of nature/object/volume of supply',
  'IF invoice.line_item_description IS NULL OR invoice.line_item_description = '''' THEN flag BLOCKER',
  'blocker',
  'Vague/generic descriptions are a classic reason the AFC denies input-tax deduction on audit.',
  '{"fr":"Description de la prestation manquante/vague.","en":"Missing/vague supply description."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-006',
  'art. 26 al. 2 let. e LTVA',
  'both',
  'Invoice missing consideration amount',
  'IF invoice.consideration_amount IS NULL THEN flag BLOCKER',
  'blocker',
  'Invoice cannot serve as VAT documentation; input-tax deduction refused.',
  '{"fr":"Montant de la contre-prestation manquant.","en":"Missing consideration amount."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-007',
  'art. 26 al. 2 let. f LTVA',
  'both',
  'Invoice missing VAT rate and/or VAT amount',
  'IF invoice.vat_rate IS NULL THEN flag BLOCKER',
  'blocker',
  'Single most common cause of input-tax deduction denial in AFC/ESTV audits.',
  '{"fr":"Taux/montant TVA manquant — cause n°1 de refus d''impôt préalable.","en":"Missing VAT rate/amount — #1 cause of input-tax denial."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'vat-008',
  'art. 28 al. 3 LTVA',
  'both',
  'Input VAT claimed on a transaction where only a bank payment record exists (no art.26-compliant invoice)',
  'IF transaction.evidence_tier IN (''partial'',''bare'') AND transaction.vat_input_claimed = TRUE THEN flag BLOCKER ''proof of payment alone does not satisfy art.26 invoice content requirement — input VAT credit is at high risk of denial''',
  'blocker',
  'Permanent loss of input-VAT credit even if the underlying expense survives for profit-tax purposes.',
  '{"fr":"Une preuve de paiement seule ne remplace JAMAIS la facture art. 26 — crédit TVA perdu.","en":"Proof of payment alone NEVER replaces the art. 26 invoice — VAT credit lost."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'dt-001',
  'art. 58 al. 1 let. a LIFD',
  'SA',
  'Business expense outflow with no invoice/receipt but a bank record exists (evidence_tier = partial or bare)',
  'IF transaction.evidence_tier IN (''partial'',''bare'') THEN require reconstruction_file (attestation, pattern-match to recurring supplier, or third-party confirmation) BEFORE treating as deductible; else flag WARNING ''plausibility (vraisemblance) not established — at risk of reprise fiscale''',
  'warning',
  'Tax authority may add the amount back to taxable profit (reprise) if business purpose cannot be made plausible.',
  '{"fr":"Charge sans pièce : la vraisemblance doit être reconstruite, sinon reprise.","en":"Expense without document: plausibility must be reconstructed, else reprise."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'dt-002',
  'art. 58 al. 1 let. b LIFD — prestation appréciable en argent / distribution dissimulée de bénéfice',
  'SA',
  'Outflow with evidence_tier = bare (no reconstructable business purpose) where beneficiary resolves to the shareholder or a related party',
  'IF transaction.evidence_tier = ''bare'' AND transaction.beneficiary_is_shareholder_or_related = TRUE THEN flag BLOCKER ''disguised profit distribution risk — non-deductible to the SA AND taxable as personal income to the shareholder (double hit); apply Geneva CJ triple-condition test''',
  'blocker',
  'Double tax hit: non-deductible to the company (reprise) and separately taxable as income to the shareholder. High-priority flag for sole-shareholder SAs.',
  '{"fr":"Sortie inexpliquée vers une partie liée : risque de distribution dissimulée (double peine).","en":"Unexplained outflow to a related party: disguised-distribution risk (double hit)."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'audit-001',
  'art. 727 / 727a CO',
  'SA',
  'SA exceeds two of three thresholds for two consecutive years (balance sheet total CHF 20M, revenue CHF 40M, 250 FTE average) OR fails to meet opt-out conditions',
  'IF entity.legal_form = ''SA'' AND entity.exceeds_ordinary_audit_thresholds THEN require contrôle_ordinaire ELSE IF entity.employee_consent_for_optout != TRUE THEN require contrôle_restreint',
  'warning',
  'Operating without the legally required audit level exposes the SA and its board to liability; needs_fiduciary_check for exact opt-out mechanics per entity.',
  '{"fr":"Seuils de contrôle ordinaire / conditions d''opting-out à surveiller.","en":"Ordinary-audit thresholds / opt-out conditions to watch."}'::jsonb,
  'needs_fiduciary_check'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'receipt-001',
  'art. 26 LTVA (simplified receipt threshold)',
  'both',
  'Scanned/photographed receipt total (TTC) exceeds CHF 400 but lacks full art.26 invoice fields',
  'IF receipt.amount_ttc > 400 AND receipt.has_full_invoice_fields = FALSE THEN flag BLOCKER ''above CHF 400 simplified-receipt ceiling — full invoice required for VAT purposes''',
  'blocker',
  'Input VAT deduction denied above the simplified-receipt threshold without a compliant full invoice.',
  '{"fr":"Au-delà de CHF 400 TTC, le ticket simplifié ne suffit plus — facture complète requise.","en":"Above CHF 400 incl. VAT, a simplified receipt is not enough — full invoice required."}'::jsonb,
  'verified_fedlex'
)
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO books.compliance_rule
  (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
   consequence, summary, source_confidence)
VALUES (
  'receipt-002',
  'art. 958f CO integrity/immutability doctrine',
  'both',
  'A captured receipt/bill image is edited or replaced after initial capture without a new hash+audit entry',
  'IF document.captured = TRUE AND document.modified_after_capture = TRUE AND document.new_hash_logged = FALSE THEN flag BLOCKER ''capture integrity broken — raw scans must be immutable, corrections via new linked version only''',
  'blocker',
  'Breaks evidentiary chain for the 10-year retention requirement; scan can no longer be relied on as equivalent to the paper original.',
  '{"fr":"Original scanné immuable : hash à la capture, corrections en version liée.","en":"Scanned original immutable: hash at capture, corrections as linked versions."}'::jsonb,
  'doctrine_inferred'
)
ON CONFLICT (rule_id) DO NOTHING;
