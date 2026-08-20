-- b/books, migration 0019 — how to READ a source's file, beside how to fetch it.
--
-- ===========================================================================
-- THE SECOND FORMAT THE SPEC NAMED AND NOBODY BUILT
-- ===========================================================================
-- `HOWTO-BUILD.md` lists three bank-file formats. camt.053 was built; "Yapeal
-- CSV (camt.054 to confirm)" was not, and cards do not issue camt.053. The
-- mockup's two Yapeal sources carry `.csv` pulls that the SEED wrote directly,
-- so every screen showed a working card feed while the import door could only
-- read XML.
--
-- ── WHY A MAPPING COLUMN AND NOT A PARSER PER ISSUER ───────────────────────
-- There is no "CSV format" — every issuer names its columns differently, and
-- the spec's own "(camt.054 to confirm)" says nobody yet knew what Yapeal
-- emits. Hard-coding a guess would be inventing a bank's file format, and the
-- next issuer would need a release.
--
-- `books.runbook` already holds how to FETCH a file, versioned, per source.
-- This is the other half of the same fact: how to READ what comes back. Both
-- are established once by a human looking at a real export.
--
-- Shape is `lib/import/delimited.ts` `DelimitedMapping`. NULL means this source
-- delivers camt.053, which needs no mapping because ISO 20022 is the mapping.
ALTER TABLE books.source
  ADD COLUMN IF NOT EXISTS import_mapping jsonb;--> statement-breakpoint

COMMENT ON COLUMN books.source.import_mapping IS
  'How to read this source''s delimited export (DelimitedMapping). NULL = camt.053, which needs none.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AND THE EDGE THE DATA MODEL ALWAYS SPECIFIED
-- ---------------------------------------------------------------------------
-- `draws_from` has existed since 0008 and DATA-MODEL §10 describes it as "the
-- chain: Yapeal 6474 → WIR; GitHub → card 6474". Nothing has ever written it
-- but the seed, and `publicSource` does not serve it — `lib/types.ts` says so
-- in as many words, and calls it a backend request.
--
-- It stops being decorative the moment a card feed can be imported, because a
-- card and the bank that settles it describe THE SAME MONEY TWICE: four
-- merchant lines on the card, one settlement debit on the bank. Post both
-- against the bank account and the spend is counted twice, with a balanced
-- bilan either way — the failure nothing downstream can see.
--
-- The accounting answer is a card LIABILITY account: purchases credit it, the
-- settlement debits it, and it nets to what is outstanding. That makes the
-- rule enforceable in `lib/db/queries/imports.ts` — a source that draws from
-- another may not name that source's ledger account — and this index is what
-- lets the door look the parent up cheaply.
--
-- No foreign key is added here: `draws_from` has none since 0008 and adding one
-- now would refuse the seeded rows this migration must not touch. The door
-- resolves it and refuses a dangling reference in words.
CREATE INDEX IF NOT EXISTS idx_books_source_draws_from
  ON books.source (draws_from) WHERE draws_from IS NOT NULL;
