-- b/sales, migration 0014 — the company's own phone and email, and a strategy
-- on a template (sales #60 and #62), plus the indexes the combinable prospect
-- filters (#98) read.
--
-- ===========================================================================
-- #60 — THE COMPANY HAS A RECEPTION LINE, AND IT IS NOT A CONTACT
-- ===========================================================================
-- Migration 0008 declined to add `phone`/`email` to `prospects`, on the argument
-- that `sales.contacts` already carried both and "two homes for a phone number is
-- how you get two phone numbers". That was right about PEOPLE and wrong about the
-- COMPANY: a watch boutique's main line and its info@ address belong to nobody in
-- particular, and the only place to put them was a fake "general" contact (sales
-- #60 names contact 16 on prospect #8), which then shows up in every list of
-- decision makers. So the company gets its own pair, and `contacts.phone`/
-- `contacts.email` stay what they were: a PERSON's.
--
-- Both nullable, both plain columns:
--
--   phone   varchar(40)   the company's main line, free text within a strict
--                         character set (digits and `+ - ( ) . /` and spaces) —
--                         enforced in the route, see `requirePhone`.
--   email   varchar(255)  the company's general address (info@…) — one address,
--                         no slashes or colons, see `requireEmail`.
--
-- NO BLOB TRIGGER, AND THIS IS THE ONE EXCLUSION IN THE FILE. 0002's rule is
-- "a column needs a trigger if a legitimate write can put an uploaded-file URL
-- in it", and 0008 excluded `contacts.decision_power` on the same ground stated
-- here: the routes REFUSE any value outside the shape, so no URL can reach the
-- column. A blob URL contains `:` and `/` and letters; the email shape forbids
-- the first two and the phone shape all three. That is a refusal by validation
-- (lib/http-input.ts), and `lib/http-input.test.ts` is what watches it.
--
-- ===========================================================================
-- #62 — A TEMPLATE CAN BE TAGGED WITH THE STRATEGY THAT JUSTIFIED IT
-- ===========================================================================
-- `prospects.strategy_id` has existed since 0010; templates had nothing, so the
-- chain "strategy -> its prospects + its templates" could only be walked one way.
-- `templates.strategy_id` is the mirror of it and deliberately the SAME shape:
-- nullable, `ON DELETE SET NULL` — retiring a segment must not take the messages
-- written for it, which are still usable words.
--
-- Nullable and it stays nullable: most templates are strategy-agnostic (a generic
-- "thanks for your time" recap), and a NOT NULL would refuse the cheap write.
--
-- ===========================================================================
-- INDEXES
-- ===========================================================================
-- `templates(strategy_id)` for the strategy -> templates read. The prospect
-- facets and the city/sector/source filters group and match on the LOWERCASED
-- value (a workspace with "Lausanne" and "lausanne" has one city, not two), so
-- the indexes are expression indexes on `lower(col)`, scoped by workspace.
--
-- Re-runnable: `IF NOT EXISTS` throughout.

ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "email" varchar(255);--> statement-breakpoint

ALTER TABLE "sales"."templates" ADD COLUMN IF NOT EXISTS "strategy_id" integer
  REFERENCES sales.strategies(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_templates_strategy ON sales.templates (strategy_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_prospects_ws_city   ON sales.prospects (workspace_id, lower(city));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_sector ON sales.prospects (workspace_id, lower(sector));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_source ON sales.prospects (workspace_id, lower(source));
