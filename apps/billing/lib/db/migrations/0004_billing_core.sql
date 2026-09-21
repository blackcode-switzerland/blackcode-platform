-- b/billing, migration 0004 — the core tables: companies, invoices, lines, the
-- audit log, and the idempotency ledger.
--
-- Hand-written, like every migration here. `npm run db:generate` emits
-- `CREATE TABLE platform.users` for this app because lib/db/schema.ts re-exports
-- the platform schema; 0001's header has the full argument.
--
-- ===========================================================================
-- WHAT THIS PHASE FIXES IN PLACE FOREVER
-- ===========================================================================
-- The number allocator and the audit contract. Neither can be changed later
-- without touching every row, so the shapes below are the ones to argue about
-- now rather than after the first real invoice exists.
--
-- ── EVERY TABLE IS WORKSPACE-SCOPED EXCEPT `invoice_line` ──────────────────
-- Which is reached through `invoice_id`. Leave `workspace_id` off any of the
-- others and the app has no tenancy, which is close to unfixable once there are
-- invoices in it.
--
-- ── AND NOTHING DERIVED IS STORED ──────────────────────────────────────────
-- No `subtotal`, no `vat`, no `total`, no `line_total` column anywhere. They are
-- computed by lib/derive/totals.ts on every read, from the lines, the price mode
-- and the company's rounding policy. A stored total is a total that disagrees
-- with its lines the first time somebody edits one — and because the rounding
-- policy is a COMPANY setting (D-B7), a stored total would also have to be
-- rewritten across history when that setting changed.

-- ---------------------------------------------------------------------------
-- 1. THE ISSUING COMPANY
-- ---------------------------------------------------------------------------
-- Multi-entity by design: a new company is a ROW, never a code change. A
-- workspace is a tenant and this is what it bills from, so "one more entity" is
-- an insert here rather than a second workspace.
CREATE TABLE IF NOT EXISTS billing.company (
  id              serial PRIMARY KEY,
  workspace_id    integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  -- The workspace #number: the address a surface prints. `id` is never printed.
  seq             integer NOT NULL,
  -- The URL and CLI handle. Immutable after create, enforced at the write door
  -- rather than by a trigger: it is not a legal fact, it is a name, and the
  -- reason it cannot move is that it appears in URLs people have bookmarked.
  slug            varchar(40) NOT NULL,

  name            varchar(70) NOT NULL,
  -- ON THE PAYMENT PART, AND IT MUST MATCH THE ACCOUNT HOLDER of the credit
  -- account (spec §4 line 6). A mismatch is a bill a bank may refuse. 70 is the
  -- payload's own limit, so the column enforces it: a 71-character name does
  -- not produce a slightly wide PDF, it produces a payload that is invalid.
  legal_name      varchar(70) NOT NULL,

  -- STRUCTURED ADDRESS ONLY. The standard's combined-address option is gone
  -- (in force since 21 Nov 2025), and every width here is the payload's.
  street          varchar(70),
  building        varchar(16),
  postal_code     varchar(16),
  city            varchar(35),
  country         char(2),

  email           varchar(255),
  logo_initials   varchar(4),
  logo_color      varchar(9),

  -- ⇠ BORROWED FROM b/books. Nullable because a company can exist before its
  -- bank details are known, and an invoice cannot be sent until they are.
  --
  -- `iban` carries SCOR and NON, in CHF and EUR. `qr_iban` is a QR-IBAN
  -- (IID 30000–31999) and NULL means QRR is impossible for this company — which
  -- G4's write-door half checks, because a CHECK constraint on `invoice` cannot
  -- see this row.
  iban            varchar(21),
  qr_iban         varchar(21),

  -- `false` means VAT is OMITTED ENTIRELY from its invoices: no rate, no 0%, no
  -- block. Not the same as a rate of zero — see `invoice_line.vat_rate`.
  vat_registered  boolean NOT NULL DEFAULT false,
  uid             varchar(32),
  vat_number      varchar(32),

  -- PREFILLS for new invoices and their lines. **Never read at render time.**
  -- An invoice carries its own currency, language, reference type and price
  -- mode; reading a default when rendering an old document would make that
  -- document change when somebody edited a setting.
  default_currency            char(3) NOT NULL DEFAULT 'CHF',
  default_language            varchar(2) NOT NULL DEFAULT 'fr',
  default_ref_type            varchar(4) NOT NULL DEFAULT 'NON',
  default_vat_rate            numeric(5,2),
  default_prices_include_vat  boolean NOT NULL DEFAULT false,
  payment_terms_days          integer NOT NULL DEFAULT 30,

  -- READ AT DERIVATION TIME, unlike the defaults above — decision D-B7.
  -- Changing it changes every total this company has ever derived, which is what
  -- deriving them is for. The vocabulary is in lib/vocabularies.ts and the CHECK
  -- is in 0005.
  rounding        varchar(12) NOT NULL DEFAULT 'line_0_05',

  -- Two tokens, both optional: `{YYYY}` and `{SEQ4}`. `BC-{YYYY}-{SEQ4}`,
  -- `AL-{SEQ4}`. An unknown token is an error at render time, not a passthrough.
  number_format   varchar(40) NOT NULL DEFAULT 'BC-{YYYY}-{SEQ4}',

  -- ** THE GAPLESS ALLOCATOR. ** Read the allocator section of
  -- docs/billing-app-plan/phase-1-companies-and-invoices.md before touching
  -- anything near this column. It is bumped by
  -- `UPDATE … SET next_seq = next_seq + 1 … RETURNING next_seq - 1` inside the
  -- invoice insert's transaction, and the row lock that takes is the entire
  -- mechanism. Never a Postgres SEQUENCE: a sequence is explicitly
  -- non-transactional, so a rollback consumes the value and leaves a hole.
  next_seq        integer NOT NULL DEFAULT 1,

  footer_fr       text,
  footer_en       text,

  -- A retired company issues no NEW invoices and still renders its old ones.
  -- **Never deleted** — 0006 revokes DELETE — because past invoices reference it
  -- and a statement for a past year has to render.
  retired_at      timestamptz,

  -- The caller's own identifier, for an outside system correlating by its own
  -- ids (integration-surface.md §3). A flat string→string map beside it.
  external_ref    varchar(80),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by      integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_company_ws_seq  UNIQUE (workspace_id, seq),
  CONSTRAINT uq_company_ws_slug UNIQUE (workspace_id, slug)
);--> statement-breakpoint
-- Partial, because NULL is the common case and two companies with no external
-- reference are not a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_ws_external_ref
  ON billing.company (workspace_id, external_ref)
  WHERE external_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_ws_live
  ON billing.company (workspace_id) WHERE retired_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. THE INVOICE
-- ---------------------------------------------------------------------------
-- A numbered legal document. Three identifiers, and conflating any two of them
-- would be the worst bug this app could ship:
--
--   id       the row. No surface prints it.
--   seq      the workspace #number — the ADDRESS. `bk billing invoice show 7`,
--            the URN `bc:billing:blackcode/invoice/7`, the route path.
--   seq_no   the per-company STATUTORY sequence value, gapless, printed on the
--            document as `number` and embedded in the payment reference.
CREATE TABLE IF NOT EXISTS billing.invoice (
  id              serial PRIMARY KEY,
  workspace_id    integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  seq             integer NOT NULL,

  -- Frozen after insert by G1. An invoice that changed issuer would be a
  -- different document with the same number.
  company_id      integer NOT NULL REFERENCES billing.company(id) ON DELETE RESTRICT,
  seq_no          integer NOT NULL,
  number          varchar(40) NOT NULL,

  status          varchar(10) NOT NULL DEFAULT 'draft',
  issue_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date        date,
  paid_date       date,

  currency        char(3) NOT NULL,
  -- The DOCUMENT's language, not the operator's. It drives the Annex C literals
  -- on the payment part and the content of the page.
  language        varchar(2) NOT NULL,

  ref_type        varchar(4) NOT NULL,
  -- The reference WITHOUT its check digit, which is derived on every render
  -- (invariant I6). Storing a check digit would be storing a value that can
  -- disagree with the body it checks.
  ref_body        varchar(26),

  -- ONE SELF-CONTAINED BLOCK. Nothing else on the invoice may depend on its
  -- internals, and that is what makes the later swap to a b/clients lookup a
  -- data-source change rather than a rewrite. It is jsonb rather than columns
  -- for exactly that reason — and it holds no money, so the float64 objection to
  -- jsonb (decision D-B4) does not apply.
  client          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- THE RATE PREFILLED ONTO NEW LINES, AND NOTHING ELSE. Every line carries its
  -- own rate and the totals read the lines. Kept here so the wire shape the
  -- mockup serves survives, and because a new line needs a default from
  -- somewhere the operator has already chosen.
  vat_rate        numeric(5,2),
  -- `true` means each line's `unit_price` ALREADY CONTAINS its VAT, the block
  -- reads `dont TVA`, and the total is the sum of the lines with nothing added.
  -- Part of the document: frozen by G2. Decision D-B7.
  prices_include_vat boolean NOT NULL DEFAULT false,

  -- The unstructured payment message. 140 characters is the QR-bill's own
  -- budget, SHARED with the structured billing information this app does not
  -- emit (position P5) — enforced from day one so emitting it later is additive.
  message         varchar(140),

  -- A VOID IS A RECORD, NEVER A DELETION. `{ts, by, reason: {fr, en}}`. The
  -- number stays consumed forever; a correction is a void plus a reissue.
  void            jsonb,

  external_ref    varchar(80),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by      integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_invoice_ws_seq UNIQUE (workspace_id, seq),
  -- THE BACKSTOP, NOT THE MECHANISM. The row lock on `company.next_seq` is what
  -- makes the sequence gapless. If this ever fires, the allocator has been
  -- changed to read-then-write and the gaplessness guarantee is already gone.
  CONSTRAINT uq_invoice_company_seq_no UNIQUE (company_id, seq_no)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_ws_external_ref
  ON billing.invoice (workspace_id, external_ref)
  WHERE external_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoice_ws_company ON billing.invoice (workspace_id, company_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoice_ws_status  ON billing.invoice (workspace_id, status);--> statement-breakpoint
-- The list's default order, and the overview's "recent" read.
CREATE INDEX IF NOT EXISTS idx_invoice_ws_issued  ON billing.invoice (workspace_id, issue_date DESC, seq DESC);--> statement-breakpoint
-- `{ref}` resolves as #seq then `number`, so the second spelling needs an index.
CREATE INDEX IF NOT EXISTS idx_invoice_ws_number  ON billing.invoice (workspace_id, number);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. THE LINES — A TABLE, NOT A jsonb COLUMN (decision D-B4)
-- ---------------------------------------------------------------------------
-- The mockup embeds them as an array, and for a static JS file that is right. In
-- Postgres it is not: **a money value inside jsonb is a JSON number, therefore a
-- float64**, and this repo's money rule is `numeric(14,2)` in the column and a
-- string on the wire.
--
-- The wire shape does not change — `items: [...]`, exactly as the mockup serves
-- it — because the shaping function assembles it. What changes is that the
-- amounts survive.
--
-- It is also what made a per-line `vat_rate` a COLUMN on 2026-09-16 rather than
-- a rewrite of every row: decision D-B7, from the first external customer's
-- invoices, which put a VAT-exempt medical act and a taxable product on one
-- document.
CREATE TABLE IF NOT EXISTS billing.invoice_line (
  id            serial PRIMARY KEY,
  -- Reached through the invoice, so no `workspace_id`. CASCADE because a line
  -- has no meaning without its invoice — and note that 0006 revokes DELETE on
  -- BOTH tables, so the cascade is reachable only by the migrator.
  invoice_id    integer NOT NULL REFERENCES billing.invoice(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,

  description   text NOT NULL,
  -- Three decimal places: 12 days, 0.5 hours, 48 pieces. Not money, so not
  -- (14,2) — a half hour is a real quantity and rounding it to the rappen would
  -- be rounding the wrong thing.
  qty           numeric(12,3) NOT NULL DEFAULT 1,
  -- DISPLAY-ONLY TEXT, and deliberately not a vocabulary. "days", "hours",
  -- "pcs", "forfait" — a closed list here would mean a migration every time
  -- somebody bills something new.
  unit          varchar(24),
  unit_price    numeric(14,2) NOT NULL,

  -- ** NULL MEANS THIS LINE CARRIES NO VAT. ** A VAT-exempt medical act, or a
  -- company that is not registered at all. `0` is a VALID RATE — export,
  -- reverse charge — and prints `TVA 0%`.
  --
  -- The null-versus-zero distinction (invariant I3) lives HERE, per line, since
  -- D-B7. The test is `vat_rate IS NOT NULL` and must never be written as
  -- `> 0`: that spelling silently merges "exempt" into "zero-rated", which are
  -- different facts with different consequences on a VAT return.
  --
  -- The write door also refuses a non-null rate on any line of a company whose
  -- `vat_registered` is false, which is a cross-table rule a CHECK cannot see.
  vat_rate      numeric(5,2),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_invoice_line_no UNIQUE (invoice_id, line_no)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoice_line_invoice ON billing.invoice_line (invoice_id, line_no);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. THE AUDIT LOG — APPEND-ONLY, AND IT IS THE EDIT WORKFLOW
-- ---------------------------------------------------------------------------
-- There is no separate history feature and no `updated_by` column anywhere.
-- Every write appends here in the SAME TRANSACTION as the change, so a change
-- with no audit row is impossible rather than merely discouraged.
--
-- 0005 adds the no-delete trigger and 0006 revokes UPDATE and DELETE. Both,
-- deliberately: the trigger stops anything running as owner including a console
-- session, and the revoke stops the app before the statement is attempted and
-- shows up in `\dp` where a reviewer will see it.
--
-- ── IT DOUBLES AS THIS APP'S EVENT FEED ────────────────────────────────────
-- `GET …/audit?since=<seq>` returns rows ascending from a cursor, which is how
-- an outside system learns a bill was sent or paid by somebody in a browser
-- (integration-surface.md §4). That works because `seq` comes from the counter
-- upsert, which takes a row lock — so sequence order IS commit order and no row
-- can appear behind a cursor a poller has already passed.
CREATE TABLE IF NOT EXISTS billing.audit (
  id            bigserial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  -- Monotonic per workspace, from `billing.counters`. The feed's cursor.
  seq           integer NOT NULL,

  subject_type  varchar(16) NOT NULL,
  -- The subject's `id`. DELIBERATELY NOT A FOREIGN KEY: a typed FK per subject
  -- type would mean three nullable columns and a CHECK to say exactly one is
  -- set, for no gain — nothing here cascades, because nothing here is deleted.
  subject_id    integer NOT NULL,

  ts            timestamptz NOT NULL DEFAULT now(),

  -- HUMANS AND AGENTS LAND IN THE SAME LOG. An agent write is a user's token, so
  -- the user is always known; `via` is the only structural difference between
  -- the two, and it is the same spelling `/api/meta` uses for `user.via`.
  actor_user_id integer REFERENCES platform.users(id) ON DELETE SET NULL,
  via           varchar(8) NOT NULL,

  action        varchar(20) NOT NULL,
  -- `items[2].unit_price`, `metadata.order_id`. Null for whole-record actions.
  field         varchar(64),
  from_value    text,
  to_value      text,
  detail_fr     text,
  detail_en     text,

  CONSTRAINT uq_audit_ws_seq UNIQUE (workspace_id, seq)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_subject ON billing.audit (workspace_id, subject_type, subject_id, seq DESC);--> statement-breakpoint
-- The feed's read: ascending from a cursor.
CREATE INDEX IF NOT EXISTS idx_audit_ws_seq ON billing.audit (workspace_id, seq);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. THE IDEMPOTENCY LEDGER
-- ---------------------------------------------------------------------------
-- ** WHY THIS APP CANNOT SKIP IT. ** The invoice number is gapless and the row
-- is never deleted, so a client that retries a timed-out `POST …/invoices`
-- mints a SECOND REAL INVOICE that can only be voided. A network timeout
-- between our commit and the client's receipt is indistinguishable, to the
-- client, from a failure — and every HTTP client retries.
--
-- The events spine carries an idempotency key for the same reason, and states
-- it: "the cost of the column is one nullable varchar against the cost of
-- discovering you need it after the table has rows"
-- (apps/sales/lib/db/schema.ts).
--
-- Applied to every POST that allocates a number. Semantics in
-- integration-surface.md §2; the wrapper is lib/api/idempotency.ts and is
-- deliberately NOT in packages/platform-api until a second app asks.
CREATE TABLE IF NOT EXISTS billing.idempotency_keys (
  id              bigserial PRIMARY KEY,
  workspace_id    integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  -- The `Idempotency-Key` header. 80 characters, matching the events spine's
  -- column so the two cannot disagree about what a key may be.
  key             varchar(80) NOT NULL,

  -- sha256 of method + path + canonical body. The same key with a DIFFERENT
  -- hash is refused (422), never replayed: replaying would answer a question
  -- the caller did not ask.
  request_hash    char(64) NOT NULL,

  status          varchar(8) NOT NULL DEFAULT 'pending',
  response_status integer,
  response_body   jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- ** THE INDEX IS THE MECHANISM, NOT A BACKSTOP. ** The wrapper never checks
  -- first: a check-then-insert is a race, and a concurrent double-submit is
  -- exactly the case that matters. The second INSERT violates this and becomes a
  -- 409 `idempotency_in_progress`.
  CONSTRAINT uq_idempotency_ws_key UNIQUE (workspace_id, key)
);--> statement-breakpoint
-- Rows older than 24 hours are treated as new, and a maintenance command sweeps
-- them. **The app schedules nothing** — same rule as recurrence in phase 4.
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON billing.idempotency_keys (created_at);
