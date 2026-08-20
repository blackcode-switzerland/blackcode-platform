-- Rollback for apps/books migration 0017 — remove the reference compliance rules.
--
-- Rollbacks run in REVERSE: this file FIRST, then 0016, 0015 … down to 0001.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DESTROYS, AND WHAT IT REFUSES TO
-- ---------------------------------------------------------------------------
-- 0017 inserts nineteen law-derived rules that every deployment holds
-- identically. This file deletes them again — but ONLY the ones still in
-- `review_state = 'draft'`.
--
-- A rule a fiduciary has approved, edited or rejected is no longer reference
-- data: it carries `reviewed_by`, `reviewed_at`, and possibly `edited_logic`
-- with corrected wording. That is human work, this table is its only record,
-- and a rollback of a data-only migration is not a reason to lose it. So the
-- WHERE clause keeps it, and the count below tells you how many stayed.
--
-- Verdicts already filed against a rule are untouched either way: `books.entry`
-- carries them in its own `verdict` column and does not reference this table.
\set ON_ERROR_STOP on
BEGIN;

DELETE FROM books.compliance_rule
 WHERE review_state = 'draft';

-- What survived, and why. Zero rows here is the ordinary case.
SELECT rule_id, review_state, reviewed_by
  FROM books.compliance_rule
 ORDER BY rule_id;

DELETE FROM drizzle.__drizzle_migrations_books
 WHERE hash LIKE '%0017_compliance_rules_reference%';

COMMIT;
