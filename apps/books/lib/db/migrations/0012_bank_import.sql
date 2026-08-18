-- Phase 4A: the bank import door — line-level idempotency.
--
-- Write path #1 of the spec's "deliberately few" (dev-handoff
-- ARCHITECTURE.md): bank files land as STAGED entries, parsed from camt.053.
-- The Companion retries and statements overlap (a monthly file re-covers a
-- weekly one), so every imported line must carry the bank's own reference and
-- converge on itself: same (source, reference) = same entry, forever.
--
-- `bank_ref` is the bank's identifier for the movement (AcctSvcrRef, falling
-- back to NtryRef/EndToEndId). NULL on rows that did not arrive through the
-- door (seeded history, declared cash), so the unique index is partial. Two
-- genuinely identical coffees on one day survive because the bank's refs
-- differ; the same coffee arriving in two overlapping statements lands once.
--
-- ri_entry also gains `source_id`: until now RI rows had no register linkage
-- (phase 2's worklist matches them on sourceless rules), but an IMPORTED RI
-- line knows exactly which source delivered it, and the idempotency key
-- needs it. Existing rows keep NULL, honestly: nobody knows their feed.
ALTER TABLE books.entry    ADD COLUMN IF NOT EXISTS bank_ref varchar(64);--> statement-breakpoint
ALTER TABLE books.ri_entry ADD COLUMN IF NOT EXISTS bank_ref varchar(64);--> statement-breakpoint
ALTER TABLE books.ri_entry ADD COLUMN IF NOT EXISTS source_id integer REFERENCES books.source(id) ON DELETE SET NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_books_entry_bank_ref
  ON books.entry (source_id, bank_ref) WHERE bank_ref IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_ri_entry_bank_ref
  ON books.ri_entry (source_id, bank_ref) WHERE bank_ref IS NOT NULL;
