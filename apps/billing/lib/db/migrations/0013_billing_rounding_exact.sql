-- b/billing, migration 0013 — a fourth rounding policy, `exact_0_05`.
--
-- ===========================================================================
-- WHY A MIGRATION FOR ONE VOCABULARY VALUE
-- ===========================================================================
-- `company.rounding` is held to its vocabulary by a CHECK (0005), so the
-- DATABASE refuses a policy the app does not know — against a console session
-- or a second deployment as much as against a route. That is the point of the
-- CHECK, and it means a new policy is a migration, not a deploy.
-- `lib/vocabularies.test.ts` holds this list, the served list and the TS union
-- to one another; add a value to one and it goes red until all three agree.
--
-- ── THE POLICY ─────────────────────────────────────────────────────────────
-- The first external customer keeps each line's qty × unit_price UNROUNDED,
-- sums, and rounds the payable total ONCE to five rappen. `total_0_05` rounds
-- every line to the rappen before summing, and on a fractional quantity the two
-- disagree on the total. Nothing here stores a total (invariant I5): the value
-- is read at derivation time by `lib/derive/totals.ts`, and an invoice that has
-- left draft carries its own copy of the policy in `invoice.issuer` (0011), so
-- a company switching to it re-totals its drafts and nothing else.
--
-- Same shape as 0008: drop by name, re-add. `varchar(12)` holds the value.

ALTER TABLE billing.company DROP CONSTRAINT IF EXISTS company_rounding_check;--> statement-breakpoint
ALTER TABLE billing.company
  ADD CONSTRAINT company_rounding_check
  CHECK (rounding IN ('line_0_05', 'total_0_05', 'exact_0_05', 'none'));
