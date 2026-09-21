-- Register `billing` in `platform.apps` — docs/adding-an-app.md step 3.
--
-- **HUMAN STEP, AND THE ORDER IS LOAD-BEARING.** Run part 1, then the
-- migrations, then part 2. Running them together, or part 2 first, stops blob
-- deletion in every deployment until it is undone.
--
-- ---------------------------------------------------------------------------
-- YOU DO NOT HAVE TO SPLIT THIS FILE. RUN THE WHOLE THING, TWICE.
-- ---------------------------------------------------------------------------
--     psql … -f docs/sql/billing-app-register.sql     BEFORE the migrations
--     <run the migrations>
--     psql … -f docs/sql/billing-app-register.sql     AFTER them
--
-- Part 2 is an UPDATE guarded on `maintains_blob_index = true`, which only
-- migration 0002 sets — so on the first run it matches nothing and the app
-- stays disabled. Part 1's `ON CONFLICT DO UPDATE` touches name, description
-- and base_url only — never `enabled` — so the second run cannot switch the app
-- back off. Both halves are idempotent in both directions.
--
-- ── THE ORDER HAS ALREADY BITTEN THE APP BEFORE THIS ONE ────────────────────
-- This app's 0002 sets the flag with `UPDATE … WHERE slug = 'billing'`, guarded
-- on this row EXISTING. Migrate before part 1 and the flag is silently never
-- set, re-running the migration will not fix it (Drizzle records it applied),
-- and recovery is a hand-written UPDATE. That exact sequence happened to b/books
-- on the dev database on 2026-08-17, with the role grant rather than the flag.
-- Part 1 first. Always.

-- ---------------------------------------------------------------------------
-- PART 1 — BEFORE the billing migrations. `enabled = false`.
-- ---------------------------------------------------------------------------
-- The moment an ENABLED row exists here, every deployment's blob-delete gate
-- asks whether `billing` references a file. Until 0002 has run and
-- `maintains_blob_index` is true, nobody can answer — so blob deletion is
-- refused platform-wide, including in issues, sales and books. Disabled first.
--
-- b/billing's index will be EMPTY FOREVER, and the flag is still required. This
-- app stores no files: the company logo is initials plus a colour, and the
-- invoice PDF is regenerated on demand byte-stably rather than archived
-- (position P10). `AppContext.uploads` throws. An app that answers "I reference
-- nothing" can never make another app's file deletable, and NOT registering
-- coverage would break deletion for everyone — 0002's header carries the full
-- argument.
--
-- `base_url` IS LOAD-BEARING SINCE CLI 3.0.0 (D-1). It is what `bk login` and
-- `bk meta` learn this app's address from, and the CLI refuses to guess: with
-- the column NULL, every `bk billing …` command fails with "no server known for
-- app billing" on every machine. Set it here, not later. `bk app list` is where
-- you check it.
--
-- ── SUBSTITUTE `base_url` FOR A STANDALONE DEPLOYMENT ───────────────────────
-- A rebranded copy of this app (docs/billing-app-plan/standalone-deployment.md)
-- runs this same file with that customer's domain and product name. It is the
-- ONE row in their address book, which is what makes the other apps absent
-- there rather than disabled — there is no edition flag anywhere.
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES (
  'billing',
  'b/billing',
  'Swiss QR-bill invoicing — companies, invoices, payment parts',
  'https://billing.blackcode.ch',
  false
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      base_url = EXCLUDED.base_url;

-- ---------------------------------------------------------------------------
-- NOW RUN THE MIGRATIONS
-- ---------------------------------------------------------------------------
--   0001_billing_init             this app's tenancy + the #number counter
--   0002_blob_reference_index     the purge grant, then the coverage flag
--   0003_app_role_grants          what billing_app may do (NEEDS THE ROLE:
--                                 docs/sql/billing-app-role.sql first, or 0003
--                                 warns, skips, and must be replayed by hand)
--
--   From phase 1: 0004 the core tables, 0005 the guards, 0006 the revokes.
--
--   By hand: npm run db:migrate --workspace=billing   (as the MIGRATOR credential)
--
-- Confirm before continuing — this must return `t`:
--   SELECT maintains_blob_index FROM platform.apps WHERE slug = 'billing';
--
-- ── DO NOT SEED PRODUCTION. ────────────────────────────────────────────────
-- From phase 1, `npm run db:seed:billing` loads the DEVELOPMENT fixture built
-- from the mockup and rebuilds its workspace destructively; it refuses non-local
-- hosts outright. A production tenant is created empty and billed into.
--
-- In phase 0 there is nothing to seed at all: sign in at the deployment, which
-- mints a workspace, or create one with `bk billing workspace create`.

-- ---------------------------------------------------------------------------
-- PART 2 — ONLY AFTER 0002 HAS RUN AND THE FLAG IS TRUE.
-- ---------------------------------------------------------------------------
-- Guarded rather than a bare UPDATE: if the flag is false this changes nothing
-- and the app stays invisible, which is recoverable. Enabling an app that cannot
-- answer for its references is the state that ends in a deleted file.
UPDATE platform.apps
SET enabled = true
WHERE slug = 'billing' AND maintains_blob_index = true;

-- Verify. `enabled` and `maintains_blob_index` must BOTH be true:
--   SELECT slug, enabled, maintains_blob_index, base_url
--   FROM platform.apps ORDER BY slug;
--
-- Then, from any machine:  bk app list   -> billing must show its base_url.
-- Then the boundary probe, as billing_app — see billing-app-role.sql's closing
-- section, and read its POSITIVE checks first.
