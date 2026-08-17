-- b/sales, migration 0010 — segment strategies and per-prospect game plans
-- (sales #37 and #35).
--
-- ===========================================================================
-- TWO ISSUES, TWO SHAPES, AND THEY ARE NOT THE SAME SHAPE
-- ===========================================================================
-- #37 wants a place to record why a SEGMENT was chosen: "watch/jewelry
-- boutiques in Lausanne, pitched with the AP configurator demo plus the
-- consciencegems.ch e-commerce case study". That reasoning is REUSABLE — it
-- applies to ten prospects at once and it is worth browsing on its own.
--
-- #35 wants a PRE-MEETING game plan for ONE prospect: the upsell angle, the
-- talking points, the language to use, the objections to expect. On the day it
-- was filed that was done by hand — French talking points drafted ad hoc and
-- pasted into chat for a rep to read live.
--
-- Collapsing them into one field would have been the cheap move and it would
-- have been wrong in a way that shows up immediately: a shared rationale copied
-- onto ten prospects goes stale nine times, and a per-prospect angle stored on a
-- shared record is wrong for the other nine. So:
--
--   sales.strategies          the reusable segment reasoning. Addressable —
--                             it has a `seq`, so it has a #number and a URN,
--                             which is what "browsable independent of individual
--                             prospects" means in this app.
--   prospects.strategy_id     which segment this prospect belongs to. Nullable,
--                             ON DELETE SET NULL: retiring a strategy must not
--                             take ten live deals with it.
--   prospects.game_plan       the angle for THIS prospect, on top of the shared
--                             one. #35's action layer.
--
-- ===========================================================================
-- `seq`, AND THEREFORE `sales.counters` GAINS A ROW TYPE
-- ===========================================================================
-- A strategy is independently addressable — you browse the list, you cite one,
-- you link prospects to it — so it gets a workspace #number like prospects,
-- meetings, communications, products, templates and documents. That is the test
-- `lib/dashboard-paths.ts` states: a type with no independent identity (contact,
-- objection, match, and now prospect_note) must NOT be projected, because a URN
-- that resolves to nothing is worse than not being findable.
--
-- No backfill of `sales.counters` is needed and none is written: `allocateSeq`
-- upserts the counter row on first use, so a workspace that never creates a
-- strategy never grows one. Adding a seeded row here would be a second
-- implementation of the same rule.
--
-- ===========================================================================
-- strategy_products: A JOIN TABLE, NOT AN ARRAY COLUMN
-- ===========================================================================
-- #37 says "product(s) used" — plural. A `text[]` of names would be unjoinable
-- and would rot the first time a product is renamed; an `integer[]` of ids would
-- carry no foreign key, so deleting a product would leave a dangling reference
-- nothing could see. The join table gets `ON DELETE CASCADE` on both sides,
-- which is the behaviour that needs no maintenance.
--
-- ===========================================================================
-- THE TRIGGERS
-- ===========================================================================
-- Three new prose columns, all agent-authored, all `scan`:
--
--   strategies.rationale     why this segment, pitched how
--   strategies.case_studies  what we point at — the single likeliest place in
--                            this migration for an uploaded deck's blob url
--   prospects.game_plan      the talking points
--
-- `prospects` already carries `trg_blob_refs`, and a table holds only one
-- trigger of a given name, so that trigger is REPLACED to add `game_plan` to
-- both its fire list and its scan list. Migration 0008 did the same thing for
-- `address` and the same warning applies: `UPDATE OF` names the columns that
-- fire it, so a column added to the function's argument list and not to the
-- `UPDATE OF` list would be scanned on insert and never again.
--
-- Order, as in 0002/0007/0008/0009: TRIGGER first, then BACKFILL.
--
-- Re-runnable: `IF NOT EXISTS` throughout, every drop precedes its create, and
-- the backfill converges.
-- Mirrored in `apps/sales/lib/storage/scanner.ts`; `lib/storage/scanner.test.ts`
-- reads every migration in this directory and fails if the two disagree.

CREATE TABLE IF NOT EXISTS sales.strategies (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES sales.workspaces(id) ON DELETE CASCADE,
  seq           integer NOT NULL,

  name          varchar(120) NOT NULL,
  -- "watch & jewellery boutiques". Free text, not a vocabulary: the segments
  -- worth naming are discovered by selling, and a closed list would refuse the
  -- first one somebody found.
  vertical      varchar(120),
  -- "Lausanne", "Romandie", "DACH". Also free text, and deliberately not a
  -- structured geography — nothing in this app does spatial queries, and the
  -- moment it is split into country/canton/city somebody has to decide what a
  -- cross-border segment is.
  area          varchar(120),

  -- BLOB-REF (scan). Why this segment, and how we pitch it.
  rationale     text,
  -- BLOB-REF (scan). What we point at — "consciencegems.ch e-commerce build".
  case_studies  text,

  created_by    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete, so a retired segment lands in `bk sales trash` and can come
  -- back. Unlike objections and notes, a strategy HAS a #number, which is
  -- exactly what the recycle bin lists things under.
  deleted_at    timestamptz,

  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(vertical, '') || ' ' || coalesce(area, '') || ' ' ||
      coalesce(rationale, '') || ' ' || coalesce(case_studies, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategies_ws_seq  ON sales.strategies (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_strategies_ws_updated    ON sales.strategies (workspace_id, updated_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_strategies_search        ON sales.strategies USING gin (search);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales.strategy_products (
  strategy_id integer NOT NULL REFERENCES sales.strategies(id) ON DELETE CASCADE,
  product_id  integer NOT NULL REFERENCES sales.products(id)   ON DELETE CASCADE,
  PRIMARY KEY (strategy_id, product_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_strategy_products_product ON sales.strategy_products (product_id);--> statement-breakpoint

-- ON DELETE SET NULL, not CASCADE: retiring a segment must not take the deals
-- that belonged to it. The prospect keeps its own `game_plan` either way.
ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "strategy_id" integer
  REFERENCES sales.strategies(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sales"."prospects" ADD COLUMN IF NOT EXISTS "game_plan" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_strategy ON sales.prospects (strategy_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGERS
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_blob_refs ON sales.strategies;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF rationale, case_studies ON sales.strategies
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'strategy', 'workspace_id', 'scan', 'rationale', 'case_studies');--> statement-breakpoint

-- REPLACED, to add `game_plan`. Migration 0008 added `address` the same way and
-- the same hazard applies: the `UPDATE OF` list and the function's argument list
-- must gain the column together.
DROP TRIGGER IF EXISTS trg_blob_refs ON sales.prospects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF summary, next_action_note, closed_reason, address, game_plan ON sales.prospects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'prospect', 'workspace_id', 'scan', 'summary', 'next_action_note', 'closed_reason', 'address', 'game_plan');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- The `strategies` half is a no-op today (the table was created above). The
-- `prospects` half is NOT: that trigger was just recreated under a wider column
-- list and every existing row's entries have to be recomputed under it.
UPDATE sales.strategies SET rationale = rationale, case_studies = case_studies;--> statement-breakpoint
UPDATE sales.prospects SET summary = summary, next_action_note = next_action_note, closed_reason = closed_reason, address = address, game_plan = game_plan;
