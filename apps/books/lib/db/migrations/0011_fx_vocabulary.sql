-- FX vocabulary: the original currency is EVIDENCE, never arithmetic.
--
-- The book is CHF, and stays CHF (art. 957a al. 4 / 958d al. 3 CO let a
-- business keep its books in its most important currency and show CHF; for
-- these books that currency IS CHF). A card purchase abroad lands on the
-- bank statement already converted by the issuer — the CHF amount is what
-- was actually charged, and THAT is what `amount` holds.
--
-- What was lost until now is the story: "this 4.47 was USD 5.00 at the
-- issuer's rate". `fx` holds that story, display-only, in the shape
--
--   { "original": "USD 5.00", "rate": "0.894", "source": "card statement" }
--
-- Nothing computes with it. No derivation reads it, statements and totals
-- are untouched — same pattern as 0009's neutral direction: new vocabulary,
-- no new arithmetic. Phase 4's bank ingest is the intended writer (the
-- issuer's own label carries the original amount); until then a human or an
-- agent records it the way a fiduciaire annotates a paper book.
ALTER TABLE books.entry ADD COLUMN IF NOT EXISTS fx jsonb;--> statement-breakpoint
ALTER TABLE books.ri_entry ADD COLUMN IF NOT EXISTS fx jsonb;
