-- An RI entry can be NEUTRAL: logged, and counted in neither total.
--
-- Andrea, 2026-08-18, answering the phase 2 questions (ticket #59, and
-- docs/books-app-plan/README.md "Andrea's answers"): the RI keeps simple
-- money-in / money-out books, and a transfer between her own accounts — bank 1
-- to bank 2, or a personal expense paid from a business account — must be
-- LOGGED BUT NEUTRAL. Visible in the book, absent from recettes and dépenses
-- both.
--
-- The vocabulary is the right place to hold that: a third `direction` rather
-- than a flag beside the existing two, because "neutral" is not a kind of
-- recette or a kind of dépense — it is the statement that this movement is
-- neither, and a CHECK that admits it is the only representation that cannot
-- be half-applied.
--
-- The arithmetic half lives in `lib/derive` (`riTotals` must SKIP neutrals —
-- its else-branch used to count anything non-recette as a dépense, which for a
-- neutral row would have silently inflated expenses, the exact misstatement
-- this rule exists to prevent). `lib/db/neutral-transfers.test.ts` holds both
-- halves.
ALTER TABLE books.ri_entry DROP CONSTRAINT IF EXISTS ri_entry_direction_check;--> statement-breakpoint
ALTER TABLE books.ri_entry ADD CONSTRAINT ri_entry_direction_check
  CHECK (direction IN ('recette', 'depense', 'neutral'));
