-- Phase 4B: management — recorded analyses, cost categories, tax parameters.
--
-- ===========================================================================
-- THE ANALYSIS TABLE IS APPEND-ONLY, AND THAT IS ITS WHOLE MEANING
-- ===========================================================================
-- An analysis is a question somebody asked, the verdict an agent gave, and a
-- `based_on` snapshot of exactly what that agent READ at answer time. The
-- snapshot is permanent: a stored answer that silently changes is worse than a
-- stale one (phase-4-management.md). Freshness is a NEW row filed by re-asking
-- the agent, never an edit — so UPDATE and DELETE are revoked from the app
-- role below, and no route will ever offer either.
--
-- Everything DERIVED stays underived: monthly flows, cost breakdowns, the VAT
-- position and both PM taxes are computed at read time from postings and the
-- parameters here. No figure lands in a column. (`runway_after_months` on an
-- analysis is not a derivation — it is part of what the agent SAID, restated
-- numerically so charts need no prose parsing.)
CREATE TABLE IF NOT EXISTS books.analysis (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  seq           integer NOT NULL,

  /** When the answer was FILED — the server's clock, not the caller's claim. */
  asked         timestamptz NOT NULL DEFAULT now(),
  /** Who asked and which agent answered: caller-supplied provenance, kept verbatim. */
  asked_by      varchar(120) NOT NULL,
  agent         varchar(120) NOT NULL,

  /** Optional what-if label ({fr,en}) and its numeric restatement for charts. */
  scenario_label       jsonb,
  runway_after_months  numeric(8,2),

  question   jsonb NOT NULL,
  verdict    jsonb NOT NULL,
  figures    jsonb NOT NULL DEFAULT '[]',
  /** What the agent read: [{label, value, href}]. Permanent. NEVER recomputed. */
  based_on   jsonb NOT NULL DEFAULT '[]',

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_books_analysis_entity ON books.analysis(entity_id, asked DESC);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ANALYTIQUE CATEGORIES — a mapping, per book, and writable
-- ---------------------------------------------------------------------------
-- Maps ledger accounts to management cost categories. Per ENTITY, because the
-- mapping names accounts and the chart is the entity's. Seeded with the
-- mockup's five; custom ones are created from the UI and the CLI (decided
-- with Mustneer, 2026-08-19). Never deleted — a past analysis may cite a
-- breakdown that used one — so `retired` is the exit, like a source's.
CREATE TABLE IF NOT EXISTS books.analytique_category (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  seq           integer NOT NULL,

  key       varchar(40) NOT NULL,
  label     jsonb NOT NULL,
  /** Account numbers, as a jsonb string array. Validated against the chart at write time. */
  accounts  jsonb NOT NULL DEFAULT '[]',
  retired   boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq),
  UNIQUE (entity_id, key)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- TAX PARAMETERS — the entity's, not the app's
-- ---------------------------------------------------------------------------
-- The mockup hardcodes Vaud/Renens because all three seeded books sit there.
-- Books can now be created anywhere, and cantonal rates and communal
-- coefficients differ — so the parameters are a per-entity record keyed on
-- canton and commune, seeded with the Vaud/Renens values and their citations.
-- A book with no row here shows an honest "not configured" state rather than
-- someone else's rates. One row per entity: a snapshot's parameters are the
-- entity's CURRENT ones; historical positions over time are b/tax, not here.
CREATE TABLE IF NOT EXISTS books.tax_params (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL UNIQUE REFERENCES books.entity(id) ON DELETE CASCADE,

  canton   varchar(2)  NOT NULL,
  commune  varchar(80) NOT NULL,
  /** The TAX_INFO shape: {ifd, cantonal, communal, capital_tax}, each with citation + confirmed. */
  params   jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GRANTS — 0005's shape, applied to what this adds
-- ---------------------------------------------------------------------------
-- 0005's default privileges hand books_app DML on new tables. The analysis
-- table gives back UPDATE and DELETE: a filed answer is a record, and neither
-- "the answer changed" nor "nobody asked that" must be makeable true by SQL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    REVOKE UPDATE, DELETE ON books.analysis FROM books_app;
  ELSE
    RAISE WARNING 'role books_app does not exist; UPDATE/DELETE stay granted by default ACLs. Replay this block after provisioning (docs/sql/books-app-role.sql).';
  END IF;
END $$;
