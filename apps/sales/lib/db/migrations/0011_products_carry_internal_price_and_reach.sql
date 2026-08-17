-- b/sales, migration 0011 — internal price guidance and internal/external reach
-- (sales #27 part 1, and #29).
--
-- ===========================================================================
-- WHAT IS HERE, AND WHAT IS DELIBERATELY NOT
-- ===========================================================================
-- #27 asks for two things. This migration does ONE of them:
--
--   DONE   internal-only price guidance. The reporter's words: "without it,
--          every rep negotiates blind or has to ask Andrea directly every
--          time". That is a live cost on every quote, and it is two columns.
--
--   NOT DONE   product families / bundles (b/suite as a parent of seven child
--          products). It is a real modelling change — a self-referencing
--          parent, roll-up pricing, and a decision about whether a child can
--          belong to two families — and it is entangled with #26's public
--          pages, which are not being built. Left open on #27 with this note
--          rather than half-built, because a `parent_id` column with no
--          roll-up and no UI is the shape that gets found later and mistaken
--          for a finished feature.
--
-- #29 asks for a flag distinguishing products whose full page belongs on our
-- domain from products that have their own site (AIOS Companion →
-- aioscompanion.com). The PAGE TEMPLATES that flag is for are #26 and are not
-- being built — but the DATA is worth having now and is cheap, and the
-- alternative is what is happening today: `aioscompanion.com` is sitting in
-- `refs`, which is the reference-customers array. That is a wrong home that
-- silently corrupts a different field's meaning, and it is worth fixing whether
-- or not a page ever renders it.
--
-- ===========================================================================
-- WHY `internal_price_*` IS NOT JUST "ANOTHER PRICE COLUMN"
-- ===========================================================================
-- `price_label` / `price_from` / `price_to` are CUSTOMER-facing: they are what
-- the catalogue says and what a public page would print. These two are the
-- opposite — "what do I quote if someone asks", visible to workspace members
-- and to nothing else.
--
-- **Nothing enforces that at the database level and nothing can.** A column is
-- not a permission. What makes it internal is that no public renderer exists yet
-- and, when one does (#26), it must select columns explicitly rather than
-- `SELECT *`. That is a rule a person keeps, so it is written here, at the
-- columns, where somebody building that page will be standing.
--
-- Two columns rather than one so a RANGE is expressible ("CHF 8-12k depending
-- on scope"), which is what a rep actually holds in their head. A single
-- `internal_price` would force a false precision on the common case.
--
-- ===========================================================================
-- `reach`, NOT `kind` OR `type`
-- ===========================================================================
-- `kind` is taken (`document_kinds`), `type` is taken twice (`meeting_types`,
-- `objection_types`), and `category` is already a column on this very table. A
-- fourth word meaning "which sort of thing is this" would be unreadable in a
-- grep and ambiguous in a code review. `reach` says what it distinguishes: how
-- far our own site carries the product.
--
--   internal   the full page belongs on our domain (b/suite, mockups,
--              ecosystems, configurators)
--   external   a teaser on our domain plus an outbound link — the product has
--              its own brand and site, and duplicating their copy goes stale
--              the moment they update it
--
-- Validated in the route, not by a CHECK, for the reason `prospects.stage`
-- states: the vocabulary is served live by `bk meta` and a CHECK would need a
-- migration to add a value.
--
-- DEFAULT 'internal' and NOT NULL: every existing row is a blackcode product
-- until somebody says otherwise, and a nullable tri-state ("internal",
-- "external", "nobody has said") is a third case every consumer would have to
-- handle to no benefit.
--
-- ===========================================================================
-- THE TRIGGER
-- ===========================================================================
-- `external_url` IS a url column → `exact`, the shape `documents.external_url`
-- and `meetings.meeting_url` already use, for the reason 0002's header gives:
-- nothing stops somebody pasting an uploaded asset's blob url into it, and
-- `is_uploaded_asset` makes a genuine https://aioscompanion.com cost nothing.
--
-- `internal_price_note` is prose → it joins the existing `scan` trigger on
-- `products`, which is therefore REPLACED (a table holds one trigger of a given
-- name). 0008 and 0010 did the same to `prospects`; the same hazard applies —
-- the `UPDATE OF` list and the function's argument list gain the column
-- together, or it is scanned on insert and never again.
--
-- The numeric price columns get NO trigger and need none: they are `numeric`,
-- and a URL cannot be stored in one.
--
-- Order, as always: TRIGGER first, then BACKFILL.
-- Re-runnable throughout. Mirrored in `apps/sales/lib/storage/scanner.ts`.

ALTER TABLE "sales"."products" ADD COLUMN IF NOT EXISTS "internal_price_min" numeric(14,2);--> statement-breakpoint
ALTER TABLE "sales"."products" ADD COLUMN IF NOT EXISTS "internal_price_max" numeric(14,2);--> statement-breakpoint
-- BLOB-REF (scan). The negotiating context a number cannot carry — "hold at 12k
-- unless they commit to the maintenance retainer".
ALTER TABLE "sales"."products" ADD COLUMN IF NOT EXISTS "internal_price_note" text;--> statement-breakpoint
ALTER TABLE "sales"."products" ADD COLUMN IF NOT EXISTS "reach" varchar(16) NOT NULL DEFAULT 'internal';--> statement-breakpoint
-- BLOB-REF (exact). Where an `external` product actually lives.
ALTER TABLE "sales"."products" ADD COLUMN IF NOT EXISTS "external_url" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGERS
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_blob_refs ON sales.products;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF description, pitch, internal_price_note ON sales.products
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'product', 'workspace_id', 'scan', 'description', 'pitch', 'internal_price_note');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.products;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_url
  AFTER INSERT OR DELETE OR UPDATE OF external_url ON sales.products
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'product_url', 'workspace_id', 'exact', 'external_url');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- The `scan` half is NOT a no-op: that trigger was just recreated under a wider
-- column list, so every existing row's entries are recomputed under it. The url
-- half is a no-op today (the column is NULL everywhere) and is here for a
-- rollback-and-reapply against a database that already has values.
UPDATE sales.products SET description = description, pitch = pitch, internal_price_note = internal_price_note;--> statement-breakpoint
UPDATE sales.products SET external_url = external_url;
