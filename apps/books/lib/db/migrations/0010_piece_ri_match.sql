-- A pièce can prove an RI entry too.
--
-- Found by the first real RI use (2026-08-18): a personal book's coffee
-- expense and its receipt. `ri_entry` has carried the piece_* interpretation
-- columns from the start — the seed fills them for aios — but the MATCH path
-- only reached `books.entry`, so an RI book's documents could be ingested and
-- never attached. The mockup never hit this because its piece fixtures all
-- belong to blackcode SA (double-entry).
--
-- `matched_ri_entry_id` mirrors `matched_entry_id` for the other journal. A
-- piece documents ONE entry in ONE journal: the CHECK refuses a row that
-- claims both. Which journal a match targets is decided by the piece's book —
-- a simplified book's entries are ri_entry rows, a double-entry book's are the
-- grand livre's — so the two columns can never race for the same piece.
ALTER TABLE books.piece_inbox
  ADD COLUMN IF NOT EXISTS matched_ri_entry_id integer REFERENCES books.ri_entry(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE books.piece_inbox DROP CONSTRAINT IF EXISTS piece_inbox_one_journal_check;--> statement-breakpoint
ALTER TABLE books.piece_inbox ADD CONSTRAINT piece_inbox_one_journal_check
  CHECK (matched_entry_id IS NULL OR matched_ri_entry_id IS NULL);
