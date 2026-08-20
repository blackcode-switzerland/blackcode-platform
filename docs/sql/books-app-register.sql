-- Register `books` in `platform.apps` — docs/adding-an-app.md step 3.
--
-- **HUMAN STEP, AND THE ORDER IS LOAD-BEARING.** Run part 1, then the
-- migrations, then part 2. Running them together, or part 2 first, stops blob
-- deletion in every deployment until it is undone.
--
-- ---------------------------------------------------------------------------
-- YOU DO NOT HAVE TO SPLIT THIS FILE. RUN THE WHOLE THING, TWICE.
-- ---------------------------------------------------------------------------
--     psql … -f docs/sql/books-app-register.sql     BEFORE the migrations
--     <run the migrations>
--     psql … -f docs/sql/books-app-register.sql     AFTER them
--
-- Part 2 is an UPDATE guarded on `maintains_blob_index = true`, which only
-- migration 0002 sets — so on the first run it matches nothing and the app
-- stays disabled. Part 1's `ON CONFLICT DO UPDATE` touches name, description
-- and base_url only — never `enabled` — so the second run cannot switch the app
-- back off. Both halves are idempotent in both directions. (This is sales'
-- register pattern verbatim; its file documents the 2026-08-07 rehearsal.)
--
-- ── AND FOR THIS APP THE ORDER HAS ALREADY BITTEN ONCE ──────────────────────
-- Books' 0002 sets the flag with `UPDATE … WHERE slug = 'books'` — guarded on
-- this row EXISTING. Migrate before part 1 and the flag is silently never set,
-- re-running the migration will not fix it (Drizzle records it applied), and
-- recovery is a hand-written UPDATE. That exact sequence happened on the dev
-- database on 2026-08-17 with the role grant (0002's header tells the story).
-- Part 1 first. Always.

-- ---------------------------------------------------------------------------
-- PART 1 — BEFORE the books migrations. `enabled = false`.
-- ---------------------------------------------------------------------------
-- The moment an ENABLED row exists here, every deployment's blob-delete gate
-- asks whether `books` references a file. Until 0002 has run and
-- `maintains_blob_index` is true, nobody can answer — so blob deletion is
-- refused platform-wide, including in issues and sales. Disabled first.
--
-- b/books' index will be EMPTY FOREVER, and the flag is still required.
-- Supporting documents are Google Drive references plus a hash
-- (`entry.piece_drive_ref`), never uploads; `AppContext.uploads` throws. An app
-- that answers "I reference nothing" can never make another app's file
-- deletable, and NOT registering coverage would break deletion for everyone
-- (0002's header carries the full argument).
--
-- `base_url` IS LOAD-BEARING SINCE CLI 3.0.0 (D-1). It is what `bk login` and
-- `bk meta` learn this app's address from, and the CLI refuses to guess: with
-- the column NULL, every `bk books …` command fails with "no server known for
-- app books" on every machine. Set it here, not later. `bk app list` is where
-- you check it.
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES (
  'books',
  'b/books',
  'Swiss statutory bookkeeping — books, entries, evidence',
  'https://books.blackcode.ch',
  false
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      base_url = EXCLUDED.base_url;

-- ---------------------------------------------------------------------------
-- NOW RUN THE MIGRATIONS
-- ---------------------------------------------------------------------------
--   0001_books_init               tenancy + the (since removed) placeholder
--   0002_blob_reference_index     the trigger, the purge grant, then the flag
--   0003_statutory_core           the twelve statutory tables
--   0004_statutory_guards         the six triggers and eight constraints
--   0005_app_role_grants          what books_app may do (NEEDS THE ROLE:
--                                 docs/sql/books-app-role.sql first, or 0005
--                                 warns, skips, and must be replayed by hand)
--   0006, 0007                    forward fixes
--
--   By hand: npm run db:migrate --workspace=books   (as the MIGRATOR credential)
--
-- Confirm before continuing — this must return `t`:
--   SELECT maintains_blob_index FROM platform.apps WHERE slug = 'books';
--
-- ── DO NOT SEED PRODUCTION. THERE IS NOTHING TO SEED. ───────────────────────
-- `npm run db:seed:books` loads the DEVELOPMENT fixture and rebuilds the
-- workspace slugged `blackcode` destructively; it refuses non-local hosts
-- outright (lib/db/seed.ts). Production books are created empty and posted to:
--
--   bk books entity create --slug <slug> --name <name> --legal-form SA
--   bk books exercice create --entity <slug> --year 2026
--
-- `entity create` installs the PME chart of accounts itself. Opening balances
-- for a book taken over mid-life are keyed in from the fiduciary's closing —
-- that is data entry, not seeding.

-- ---------------------------------------------------------------------------
-- PART 2 — ONLY AFTER 0002 HAS RUN AND THE FLAG IS TRUE.
-- ---------------------------------------------------------------------------
-- Guarded rather than a bare UPDATE: if the flag is false this changes nothing
-- and the app stays invisible, which is recoverable. Enabling an app that
-- cannot answer for its references is the state that ends in a deleted file.
UPDATE platform.apps
SET enabled = true
WHERE slug = 'books' AND maintains_blob_index = true;

-- Verify. `enabled` and `maintains_blob_index` must BOTH be true:
--   SELECT slug, enabled, maintains_blob_index, base_url
--   FROM platform.apps ORDER BY slug;
--
-- Then, from any machine:  bk app list   -> books must show its base_url.
-- Then the two probes, as books_app — see books-app-role.sql's closing section.
