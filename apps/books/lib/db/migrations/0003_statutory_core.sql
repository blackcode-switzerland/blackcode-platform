-- b/books, migration 0003 — the statutory core.
--
-- Books, their fiscal years, their chart of accounts, their opening balances,
-- their money sources, their recognition rules, and the entries themselves in
-- both ledger models. Phase 1 of docs/books-app-plan/phase-1-statutory-core.md.
--
-- Hand-written, for the reason 0001's header sets out at length: `db:generate`
-- sees the `platform.*` re-export in lib/db/schema.ts and would have this app
-- owning the shared schema. Do not run it and commit the output.
--
-- This migration is PURELY ADDITIVE. `books.notes` and its blob trigger stay
-- exactly where 0001 and 0002 left them. Dropping the placeholder means also
-- removing its route and its two `bk books note` commands, and doing that here
-- would put schema work and CLI work in one diff. It goes when the real entities
-- have routes to replace it.
--
-- ===========================================================================
-- `entry`, NOT `transaction`
-- ===========================================================================
-- phase-1-statutory-core.md's table list says `transaction` / `transaction_line`.
-- Everything else already says entry: the routes it specifies
-- (`/api/workspaces/{ws}/entries`), the commands (`bk books entry list`), and
-- lib/types.ts, which shipped in phase 0 and which the frontend is building
-- against right now. The table list is the outlier, so `entry` wins.
--
-- ===========================================================================
-- MONEY IS `numeric(14,2)`, AND IT GOES NEGATIVE
-- ===========================================================================
-- Never float. A bilan balances to the rappen and binary floating point cannot
-- represent 0.10. It crosses the wire as a STRING (lib/types.ts `Money`), which
-- diverges from the mockup's raw JSON numbers deliberately and is written down in
-- apps/books/docs/frontend.md.
--
-- No `CHECK (amount >= 0)` anywhere. The mockup's own opening balances carry
-- `2970 = -6000` and `2970 = -46400` — account 2970 is `résultat reporté`, and a
-- carried-forward loss is negative. A positivity check here would have rejected
-- the seed data on day one.

-- ---------------------------------------------------------------------------
-- ONE COUNTER TABLE, KEYED ON THE ENTITY TYPE
-- ---------------------------------------------------------------------------
-- `books.note_counters` (0001, from the scaffold) has a FIXED column,
-- `last_note_seq`. That shape is exactly what its own comment criticises about
-- `platform.workspace_counters`: adding an entity type means ALTERing a table.
-- This app has six addressable types, so it takes the generalised shape the
-- scaffold's comment records as the wanted follow-up.
--
-- `note_counters` is left alone; it goes with `notes`.
CREATE TABLE IF NOT EXISTS books.counters (
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_type   varchar(32) NOT NULL,
  last_value    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, entity_type)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- STATEMENT POSITIONS — A LOOKUP TABLE, SEEDED FROM CODE
-- ---------------------------------------------------------------------------
-- The plan asks for two things that sound incompatible: `statement_position` as a
-- NOT NULL FOREIGN KEY, and "statement structures are code, not tables, nobody
-- edits them at runtime".
--
-- Both are satisfiable, because they are about different halves. The ORDER, the
-- French labels, the signs and the related-party marks stay in lib/statements.ts,
-- reviewed as code citing the article. What lives here is only the SET of legal
-- position keys, so the database can refuse an account that maps to nothing.
--
-- That refusal has to be a real constraint. An account pointing at a position
-- that does not exist contributes to no statement line at all: its money simply
-- does not appear, and the bilan still balances. A silent hole in a balance sheet
-- is the worst failure this schema can have, so it is a foreign key and not a
-- convention.
--
-- There is deliberately NO fallback `autre` bucket. An unmapped account must be
-- an error, not a row in a miscellaneous line.
--
-- Seeded below from lib/statements.ts. lib/statements.test.ts already proves
-- those constants match fixtures/mockup.json line for line, and a further test
-- asserts this table matches them too, so three copies cannot drift apart
-- silently.
CREATE TABLE IF NOT EXISTS books.statement_position (
  pos        varchar(40) PRIMARY KEY,
  statement  varchar(10) NOT NULL CHECK (statement IN ('bilan', 'cr'))
);--> statement-breakpoint

INSERT INTO books.statement_position (pos, statement) VALUES
  ('tresorerie', 'bilan'),
  ('creances_clients', 'bilan'),
  ('autres_creances_ct', 'bilan'),
  ('autres_creances_ct_liees', 'bilan'),
  ('stocks', 'bilan'),
  ('regularisation_actif', 'bilan'),
  ('immo_financieres', 'bilan'),
  ('participations', 'bilan'),
  ('immo_corporelles', 'bilan'),
  ('immo_incorporelles', 'bilan'),
  ('capital_non_libere', 'bilan'),
  ('dettes_fournisseurs', 'bilan'),
  ('dettes_ct_interet', 'bilan'),
  ('autres_dettes_ct', 'bilan'),
  ('autres_dettes_ct_liees', 'bilan'),
  ('regularisation_passif', 'bilan'),
  ('dettes_lt_interet', 'bilan'),
  ('autres_dettes_lt', 'bilan'),
  ('provisions', 'bilan'),
  ('capital_actions', 'bilan'),
  ('reserve_capital', 'bilan'),
  ('reserve_benefice', 'bilan'),
  ('reserves_facultatives', 'bilan'),
  ('resultat_reporte', 'bilan'),
  ('resultat_exercice', 'bilan'),
  ('produits_nets', 'cr'),
  ('variation_stocks', 'cr'),
  ('charges_materiel', 'cr'),
  ('charges_personnel', 'cr'),
  ('autres_charges_exploitation', 'cr'),
  ('amortissements', 'cr'),
  ('financier', 'cr'),
  ('hors_exploitation', 'cr'),
  ('exceptionnel', 'cr'),
  ('impots', 'cr')
ON CONFLICT (pos) DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ENTITY — one row per BOOK
-- ---------------------------------------------------------------------------
-- The user creates these and may have ANY NUMBER. Three are seeded from the
-- mockup and nothing anywhere may assume three.
--
-- A book is not a workspace (D1, argued in full in the plan's README). The
-- deciding case is the Yapeal card: one physical card on blackcode SA whose
-- individual spends are attributed to different entities at import. Workspace per
-- legal entity would either duplicate that card or read across workspaces.
--
-- ── THE TAX PARAMETERS LIVE HERE, NOT IN A CONSTANT ──────────────────────────
-- `vat_registered`, `vat_method`, `vat_filing`, `audit_status` differ per book in
-- the mockup already: blackcode SA is registered and files quarterly, AIOS SA is
-- under the CHF 100,000 threshold and is not registered at all. Any-number-of-
-- books makes a per-book column the only workable shape.
--
-- `legal_form` drives everything downstream, and it is the one field a CHECK in
-- 0004 makes impossible to get illegally wrong.
CREATE TABLE IF NOT EXISTS books.entity (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  /** Workspace-scoped #number, from books.counters. Never expose `id`. */
  seq           integer NOT NULL,
  /** URL-safe handle. The mockup switches books with `?entity=blackcode`. */
  slug          varchar(40) NOT NULL,
  name          varchar(200) NOT NULL,
  legal_form    varchar(20) NOT NULL,
  seat          text,

  -- `double_entry` | `simplified`. Art. 957 CO: an SA is always the former.
  bookkeeping_regime  varchar(20) NOT NULL,
  /**
   * The art. 957 al. 2 election, recorded rather than assumed.
   *
   * An RI under CHF 500,000 turnover MAY keep full double entry by choice, per
   * fiscal year. Recording the election as data means the simplified path can be
   * added, or dropped, without a migration — and means nobody reads the current
   * value as a permanent design decision.
   */
  regime_election     varchar(40),
  regime_note         jsonb,

  fiscal_year   varchar(20) NOT NULL DEFAULT 'calendar',

  vat_registered  boolean NOT NULL DEFAULT false,
  vat_method      varchar(20),
  vat_filing      varchar(20),
  vat_note        jsonb,

  audit_status  varchar(20),
  fte_count     numeric(6,2),
  /** Per-book accent colour. Books are shown together, so they need telling apart. */
  accent        varchar(16),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  UNIQUE (workspace_id, seq),
  UNIQUE (workspace_id, slug)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- EXERCICE — the fiscal year
-- ---------------------------------------------------------------------------
-- The one thing in this migration that is genuinely expensive to retrofit, and
-- the reason it is here in full rather than deferred.
--
-- The mockup HAS NO FISCAL YEAR. Its derivations sum every posting with no
-- boundary and `OPENING` is a hardcoded constant carrying a magic brought-forward
-- figure. Every derivation this app writes takes `(entityId, exerciceId)` from its
-- first line, because adding the boundary afterwards means rewriting the whole
-- derivation layer and every query above it.
--
-- Past years must be representable and closable: a closed exercice is what makes
-- an opening balance a fact rather than a guess.
CREATE TABLE IF NOT EXISTS books.exercice (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  year          integer NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  /** `open` | `closed`. Closing is what freezes the year's opening balances. */
  status        varchar(20) NOT NULL DEFAULT 'open',
  closed_at     timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, year),
  CHECK (ends_on > starts_on)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ACCOUNT — the Swiss PME chart, per book
-- ---------------------------------------------------------------------------
-- Per entity, not global: two books may keep different accounts, and AIOS SA's
-- chart in the mockup is a subset of blackcode SA's.
--
-- `label` is jsonb and holds the mockup's own `{ fr, enSuffix }` shape verbatim,
-- including the unusual key name. The frontend codes against that JSON, so
-- normalising it here would mean the API either lies about its source or has to
-- translate on every read.
--
-- `statement_position` is the ONLY mapping anybody may touch, and it is a
-- NOT NULL foreign key. See the lookup table above for why that is a constraint
-- rather than a convention.
CREATE TABLE IF NOT EXISTS books.account (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  no            varchar(10) NOT NULL,
  class         smallint NOT NULL CHECK (class BETWEEN 1 AND 9),
  label         jsonb NOT NULL,
  statement     varchar(10) NOT NULL CHECK (statement IN ('bilan', 'cr')),
  statement_position  varchar(40) NOT NULL
                      REFERENCES books.statement_position(pos) ON DELETE RESTRICT,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, no)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- OPENING BALANCE — a table, not a constant
-- ---------------------------------------------------------------------------
-- Per book, per year, per account. The mockup's `OPENING` is a hardcoded object
-- keyed by entity SLUG, and it covers only `blackcode` and `aios`: THE RI HAS NO
-- OPENING BALANCES AT ALL. So rows here are legitimately absent for a book, and
-- the derivations must treat a missing row as zero rather than as an error.
CREATE TABLE IF NOT EXISTS books.opening_balance (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  exercice_id   integer NOT NULL REFERENCES books.exercice(id) ON DELETE CASCADE,
  account_no    varchar(10) NOT NULL,
  amount        numeric(14,2) NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, exercice_id, account_no)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- SOURCE — where money moved
-- ---------------------------------------------------------------------------
-- Phase 1 needs the flat lookup only, because recognition rules key on the PAIR
-- (source, counterparty) and a rule cannot resolve without it. The layer
-- hierarchy's `draws_from`, the pull history and the runbook belong to phase 3
-- and are not modelled here; `draws_from` is kept because it is one column and
-- dropping it would lose the WIR-to-Yapeal relationship the mockup states.
--
-- ── `entity_id` IS NULLABLE, AND THAT IS DATA RATHER THAN LAXITY ─────────────
-- Source 509, PostFinance, carries `entity_id: null` with the note "UNCONFIRMED
-- — Andrea to confirm whether any entity holds an account". An unattributed
-- source is a real state this app has to be able to hold and show.
CREATE TABLE IF NOT EXISTS books.source (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  /** NULL is legitimate. See above. */
  entity_id     integer REFERENCES books.entity(id) ON DELETE SET NULL,
  seq           integer NOT NULL,
  name          varchar(200) NOT NULL,
  type          varchar(20) NOT NULL,
  layer         varchar(20) NOT NULL,
  /** The source this one draws on, e.g. a card against a bank account. */
  draws_from    integer REFERENCES books.source(id) ON DELETE SET NULL,
  /** Ledger accounts this source posts to. An array: a source can touch several. */
  ledger_accounts  text[] NOT NULL DEFAULT '{}',
  method        text,
  expected      varchar(20),
  last_import   date,
  retired       boolean NOT NULL DEFAULT false,
  notes_freeform  jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RULE — the legibility engine
-- ---------------------------------------------------------------------------
-- A rule keys on the PAIR (source_id, counterparty), never on the counterparty
-- alone. The mockup's own rule 101 is the reason and says so: the rent was taught
-- by a UBS entry, then moved to WIR, so "IMMOREGIE" alone would match across two
-- sources and mean two different things.
--
-- `learned_from` is the mockup's `source` field, RENAMED. Its values are
-- provenance ('contract', and so on), and a column called `source` sitting beside
-- `source_id` reads as the same fact twice. The API serves it as `source`,
-- because the frontend codes against the mockup's JSON.
CREATE TABLE IF NOT EXISTS books.rule (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  source_id     integer REFERENCES books.source(id) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  /** Provenance: how this rule came to be known. The mockup calls it `source`. */
  learned_from  varchar(40),
  /** `{ counterparty, amount_chf, tolerance_chf, interval }`. */
  pattern       jsonb NOT NULL,
  explanation   jsonb,
  /** The account a match posts to. */
  account_no    varchar(10),
  /** The entry that taught this rule. Provenance, kept permanently. */
  created_from_entry_id  integer,
  created_on    date,
  note          jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ENTRY — one row per écriture. The double-entry ledger.
-- ---------------------------------------------------------------------------
-- ── TWO NUMBERS, AND BOTH ARE NEEDED ────────────────────────────────────────
-- `seq` is the platform's workspace-scoped #number, what `bk books entry show 42`
-- addresses and what a URN carries. `entry_no` is the STATUTORY journal number:
-- gapless, scoped to (entity, exercice), which is what a tax authority reads. One
-- cannot serve as the other, because `seq` is per workspace and spans books and
-- years, and gaplessness per year is a legal property.
--
-- ── EVIDENCE: TWO CONSEQUENCES, NEVER MERGED ────────────────────────────────
-- `evidence_tier` is `full` | `partial` | `bare`, and `tva_input_claimed` is its
-- own column which is NEVER derived from it. A bank record can support a profit
-- tax deduction and can never support an input VAT claim (art. 26 LTVA), so the
-- two answers are independent and collapsing them would silently overclaim VAT.
--
-- ── `piece` IS LEGALLY REQUIRED AND STILL NULLABLE ──────────────────────────
-- Art. 957a al. 2 CO requires a pièce comptable behind every booking. The columns
-- are nullable anyway, because six of the mockup's seventeen entries have none —
-- notably the frozen UBS history this app exists to handle. That gap is what
-- `evidence_tier` EXPRESSES. Making it NOT NULL would make the real books
-- unrepresentable.
--
-- Documents are always Google Drive links. Nothing is ever uploaded into this
-- app, so there is no blob here and no reference for the platform index.
--
-- ── `raw_label` IS NEVER OVERWRITTEN ────────────────────────────────────────
-- The bank's own text, kept forever, even after somebody explains what it meant.
-- `explanation` is added beside it. Overwriting it destroys the only independent
-- record of what actually arrived.
CREATE TABLE IF NOT EXISTS books.entry (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  exercice_id   integer NOT NULL REFERENCES books.exercice(id) ON DELETE RESTRICT,
  /** Workspace #number. Addresses the row. */
  seq           integer NOT NULL,
  /** Statutory journal number, gapless per (entity, exercice). */
  entry_no      integer NOT NULL,

  date          date NOT NULL,
  /** `posted` | `staged`. 0004 makes a posted row immutable. */
  status        varchar(20) NOT NULL DEFAULT 'staged',
  source_id     integer REFERENCES books.source(id) ON DELETE SET NULL,
  /** The bank's own text. Never overwritten. */
  raw_label     text NOT NULL,
  counterparty  varchar(200),
  explanation   jsonb,

  recognition       varchar(30) NOT NULL DEFAULT 'unrecognized',
  matched_rule_id   integer REFERENCES books.rule(id) ON DELETE SET NULL,

  evidence_tier   varchar(10) NOT NULL DEFAULT 'bare',
  evidence_note   jsonb,

  tva_rate           numeric(5,2),
  tva_amount         numeric(14,2),
  /** NEVER derived from evidence_tier. See above. */
  tva_input_claimed  boolean NOT NULL DEFAULT false,
  tva_note           jsonb,

  /**
   * Art. 959a al. 4 separate presentation.
   * `{ counterpart, kind, justification, mirror_entry_id }` — and the mirror
   * points at the entry in the OTHER book, which is only expressible because a
   * workspace holds every book (D1).
   */
  related_party  jsonb,

  piece_drive_ref  text,
  piece_hash       varchar(80),
  piece_captured   date,

  /** The only correction path. A posted entry is never edited. */
  reverses_entry_id  integer REFERENCES books.entry(id) ON DELETE RESTRICT,
  /** Provenance prose, kept permanently. Resolving does not erase arrival. */
  history        jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  UNIQUE (workspace_id, seq),
  UNIQUE (entity_id, exercice_id, entry_no)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ENTRY LINE — the debit and credit sides
-- ---------------------------------------------------------------------------
-- ── `account_no` IS NULLABLE, AND THIS IS THE WHOLE REASON THE BALANCE ──────
-- ── TRIGGER FIRES ON POSTED ROWS ONLY ──────────────────────────────────────
-- Mockup entries 1012, 1013 and 2004 are `staged` and carry `account: null` on
-- the debit side: the money moved, and nobody has yet said what it was for. That
-- is the normal arrival state and the thing the Reconnaissance screen exists to
-- resolve.
--
-- So a staged line may have no account, and 0004's guard requires an account and
-- a balance only once `status = 'posted'`.
CREATE TABLE IF NOT EXISTS books.entry_line (
  id         serial PRIMARY KEY,
  entry_id   integer NOT NULL REFERENCES books.entry(id) ON DELETE CASCADE,
  /** NULL while staged. Required once posted — see 0004. */
  account_no varchar(10),
  debit      numeric(14,2) NOT NULL DEFAULT 0,
  credit     numeric(14,2) NOT NULL DEFAULT 0,
  /** Presentation order within the entry. */
  position   smallint NOT NULL DEFAULT 0,

  /**
   * A line is one side or the other, never both.
   *
   * Without this, a line carrying both a debit and a credit still lets the entry
   * "balance" while meaning nothing, and the error is invisible in every total.
   */
  CHECK (debit = 0 OR credit = 0)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_books_entry_line_entry ON books.entry_line(entry_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RI ENTRY — the single-entry book
-- ---------------------------------------------------------------------------
-- Art. 957 al. 2 CO: below CHF 500,000 turnover a sole proprietorship keeps
-- recettes/dépenses plus a net-worth statement, not double entry. This is NOT a
-- small transaction with one line missing, and modelling it as one would import
-- a debit/credit balance requirement that does not legally apply.
--
-- week-one.md elects voluntary double entry to avoid building this at all, which
-- is right for a seven-day build. This is the full phase 1, and the mockup ships
-- six RI entries and a patrimoine snapshot that the frontend renders, so the
-- second ledger model is built. `entity.regime_election` keeps the other path
-- open without a migration.
--
-- `evidence_tier` is here for the same reason it is on `entry`: art. 957 al. 3
-- extends the pièce comptable requirement to this book by analogy.
CREATE TABLE IF NOT EXISTS books.ri_entry (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  exercice_id   integer NOT NULL REFERENCES books.exercice(id) ON DELETE RESTRICT,
  seq           integer NOT NULL,

  date          date NOT NULL,
  /** `recette` | `depense`. The single-entry equivalent of a side. */
  direction     varchar(10) NOT NULL CHECK (direction IN ('recette', 'depense')),
  amount        numeric(14,2) NOT NULL,
  category      jsonb,
  raw_label     text NOT NULL,
  counterparty  varchar(200),
  explanation   jsonb,

  recognition      varchar(30) NOT NULL DEFAULT 'unrecognized',
  matched_rule_id  integer REFERENCES books.rule(id) ON DELETE SET NULL,

  evidence_tier  varchar(10) NOT NULL DEFAULT 'bare',
  evidence_note  jsonb,

  piece_drive_ref  text,
  piece_hash       varchar(80),
  piece_captured   date,
  history          jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- PATRIMOINE — the RI net-worth statement
-- ---------------------------------------------------------------------------
-- The second half of what art. 957 al. 2 requires. Compiled on demand rather
-- than accumulated, which is why `compiled` is a separate date from `as_of`: the
-- statement describes one moment and was produced at another, and a reader needs
-- both to judge it.
--
-- `items` is jsonb, matching the mockup: a list of `{ label, amount }`. It is not
-- a chart of accounts and must not become one — an RI has no accounts.
--
-- `entity_id` is required here even though the mockup omits it, because the
-- mockup has exactly one RI and this app may have any number of books.
CREATE TABLE IF NOT EXISTS books.patrimoine (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES books.workspaces(id) ON DELETE CASCADE,
  entity_id     integer NOT NULL REFERENCES books.entity(id) ON DELETE CASCADE,
  exercice_id   integer REFERENCES books.exercice(id) ON DELETE SET NULL,
  seq           integer NOT NULL,
  /** The date the statement describes. */
  as_of         date NOT NULL,
  /** The date it was produced. Deliberately not the same field. */
  compiled      date,
  items         jsonb NOT NULL DEFAULT '[]',
  note          jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, seq)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- INDEXES for the reads phase 1 actually performs
-- ---------------------------------------------------------------------------
-- The derivations all sum postings for one (entity, exercice), and the ledger
-- screen filters by account. Everything else is small enough not to guess at.
CREATE INDEX IF NOT EXISTS idx_books_entry_entity_exercice
  ON books.entry(entity_id, exercice_id) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_entry_status
  ON books.entry(workspace_id, status) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_entry_recognition
  ON books.entry(workspace_id, recognition) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_ri_entry_entity_exercice
  ON books.ri_entry(entity_id, exercice_id) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_account_entity ON books.account(entity_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_rule_lookup ON books.rule(source_id, active);
