-- Backfill the analytique's default cost buckets into books that already exist.
--
-- **HUMAN STEP, RUN ONCE AT CUTOVER.** Deliberately not a migration.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SEPARATE ARTIFACT AND NOT 0019
-- ---------------------------------------------------------------------------
-- `lib/categories.ts` fixes the FUTURE: `createEntity` now installs these five
-- buckets with the chart, so every book made from 2026-08-20 starts with them.
-- Nothing fixes the PAST, and the past is why this file exists — a book created
-- before that date has none, and `bk books analytique` reports an empty cost
-- breakdown for it forever.
--
-- 0017 could put the compliance rules in a migration because they are GLOBAL:
-- one row set for the whole deployment, identical everywhere, owned by nobody.
-- These are not. A category belongs to ONE book, `bk books category create`
-- exists so a company can group its costs its own way, and `category retire`
-- exists so it can stop using one. Which means a migration cannot tell these
-- two situations apart:
--
--   a book that has no categories because it predates the fix
--   a book that has no categories because somebody retired them all
--
-- Writing rows into the second case would be the app overruling a decision a
-- person made, on deploy, silently. Retro-fitting into live books is a call
-- somebody makes on purpose — so it is a command you run, not a consequence of
-- shipping.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES, AND WHAT IT REFUSES TO TOUCH
-- ---------------------------------------------------------------------------
-- For every double-entry book that has NO analytique_category row at all, it
-- inserts the five in `lib/categories.ts`, numbered from that workspace's own
-- `category` counter so the #numbers continue rather than collide.
--
--   * a book with even ONE category is skipped entirely — including one whose
--     only category is retired, because that is a state a person chose
--   * a SIMPLIFIED book is skipped: an RI carries its category on the entry as
--     free text, and `createCategory` refuses it an account mapping outright
--     (`ri_no_categories`). The test is the REGIME, never the legal form — an
--     RI may elect double entry (art. 957 al. 2) and then it does get them
--   * an account the book's own chart does not carry is dropped from the
--     bucket rather than inserted: a category may only name accounts that
--     exist for that entity, which is `createCategory`'s `unknown_account`
--     rule, and a book that customised its chart is exactly the book this
--     would otherwise corrupt. A bucket left with no accounts is not inserted
--
-- Idempotent: run it twice and the second run inserts nothing, because every
-- book it touched now has categories. Safe to run before or after the app is
-- live; it takes no locks a reader would notice.
--
-- ---------------------------------------------------------------------------
-- AFTERWARDS
-- ---------------------------------------------------------------------------
--   SELECT e.slug, count(c.id) AS buckets
--     FROM books.entity e
--     LEFT JOIN books.analytique_category c ON c.entity_id = e.id
--    WHERE e.deleted_at IS NULL AND e.bookkeeping_regime <> 'simplified'
--    GROUP BY e.slug ORDER BY buckets, e.slug;
--
-- A double-entry book still showing 0 has a chart carrying none of the template
-- accounts, which is a real answer and wants a human: build its buckets with
-- `bk books category create`.
--
-- There is no rollback file. The inverse is `bk books category retire`, per
-- book, by someone who knows why.
\set ON_ERROR_STOP on
BEGIN;

WITH template(key, label, accounts) AS (
  VALUES
    ('personnel', '{"fr":"Personnel","en":"People"}'::jsonb,
     ARRAY['5000','5700']),
    ('bureau',    '{"fr":"Bureau & loyer","en":"Office & rent"}'::jsonb,
     ARRAY['6000']),
    ('it_ai',     '{"fr":"IT & outils (incl. IA)","en":"IT & tooling (incl. AI)"}'::jsonb,
     ARRAY['6570']),
    ('admin',     '{"fr":"Admin & fiduciaire","en":"Admin & fiduciary"}'::jsonb,
     ARRAY['6500']),
    ('autres',    '{"fr":"Autres charges","en":"Other charges"}'::jsonb,
     ARRAY['4400','6800','6900','8500','8900'])
),
-- The books in scope: double-entry, not soft-deleted, and holding no category
-- of any kind. `NOT EXISTS` rather than a join, so one retired row is enough to
-- exclude a book — see the header.
target AS (
  SELECT e.id, e.workspace_id
    FROM books.entity e
   WHERE e.deleted_at IS NULL
     AND e.bookkeeping_regime <> 'simplified'
     AND NOT EXISTS (
       SELECT 1 FROM books.analytique_category c WHERE c.entity_id = e.id
     )
),
-- Each bucket narrowed to the accounts THIS book's chart actually carries.
resolved AS (
  SELECT t.id AS entity_id,
         t.workspace_id,
         tpl.key,
         tpl.label,
         ARRAY(
           SELECT a.no FROM books.account a
            WHERE a.entity_id = t.id
              AND a.no = ANY(tpl.accounts)
            ORDER BY a.no
         ) AS accounts
    FROM target t CROSS JOIN template tpl
),
-- A bucket that would collect nothing is not a bucket.
keep AS (
  SELECT * FROM resolved WHERE cardinality(accounts) > 0
),
-- #numbers continue the workspace's own `category` counter. `row_number()` is
-- over the WORKSPACE, because that is the scope `(workspace_id, seq)` is unique
-- on, and the counter row may not exist yet.
numbered AS (
  SELECT k.*,
         COALESCE(
           (SELECT c.last_value FROM books.counters c
             WHERE c.workspace_id = k.workspace_id AND c.entity_type = 'category'), 0
         ) + row_number() OVER (PARTITION BY k.workspace_id ORDER BY k.entity_id, k.key)
         AS seq
    FROM keep k
),
inserted AS (
  INSERT INTO books.analytique_category
    (workspace_id, entity_id, seq, key, label, accounts)
  SELECT workspace_id, entity_id, seq, key, label, to_jsonb(accounts)
    FROM numbered
  RETURNING workspace_id
)
-- Leave the counter where the inserts left it, or the next
-- `bk books category create` collides on (workspace_id, seq).
INSERT INTO books.counters (workspace_id, entity_type, last_value)
SELECT workspace_id, 'category', count(*)
  FROM inserted GROUP BY workspace_id
ON CONFLICT (workspace_id, entity_type)
  DO UPDATE SET last_value = books.counters.last_value + EXCLUDED.last_value;

COMMIT;
