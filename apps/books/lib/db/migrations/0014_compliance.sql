-- Phase 5: compliance — the rules, the verdicts, and one enforcement.
--
-- ===========================================================================
-- RULES ARE GLOBAL, DRAFT UNTIL A FIDUCIARY SAYS OTHERWISE, AND NEVER DELETED
-- ===========================================================================
-- The 19 rules come from the mockup's research against Fedlex
-- (bbooks/compliance/rules.json, vendored into fixtures/). They are statutory
-- facts, not workspace data — the same law binds every book — so the table
-- has no workspace column, like the vocabularies in /api/meta.
--
-- Every rule carries `source_confidence` (verified_fedlex, doctrine_inferred,
-- needs_fiduciary_check) and `review_state`. ALL rules load as DRAFT: research
-- is not sign-off, and the review screen renders that state honestly. Review
-- is an UPDATE (approve / edit / reject, recorded with who and when); DELETE
-- is revoked — a verdict may cite a rule forever, so rules retire by
-- `rejected`, never by disappearing.
--
-- ===========================================================================
-- A VERDICT IS AN AGENT'S FLAG ON A RECORD, AND FLAGS ARE FACTS
-- ===========================================================================
-- The Devil's Advocate is an EXTERNAL agent pass (like the analyses' author):
-- it reads, it writes verdicts onto records, it never corrects anything. The
-- verdict column is interpretation — open on posted entries by 0004's design,
-- history-first like resolve. The ONE thing the server enforces: an entry
-- whose verdict says `blocked` refuses to post, in the posting path.
CREATE TABLE IF NOT EXISTS books.compliance_rule (
  id            serial PRIMARY KEY,
  rule_id       varchar(20) NOT NULL UNIQUE,
  citation      text NOT NULL,
  applies_to    varchar(10) NOT NULL CHECK (applies_to IN ('SA', 'RI', 'both')),
  trigger_condition text NOT NULL,
  check_logic   text NOT NULL,
  severity      varchar(10) NOT NULL CHECK (severity IN ('blocker', 'warning', 'info')),
  consequence   text NOT NULL,
  /** The human-sized {fr, en} one-liner, from the mockup's card. */
  summary       jsonb,
  source_confidence varchar(30) NOT NULL
                CHECK (source_confidence IN ('verified_fedlex', 'doctrine_inferred', 'needs_fiduciary_check')),

  review_state  varchar(10) NOT NULL DEFAULT 'draft'
                CHECK (review_state IN ('draft', 'approved', 'edited', 'rejected')),
  /** The fiduciary's corrected wording, when review_state = 'edited'. The original stays. */
  edited_logic  text,
  review_note   text,
  reviewed_by   varchar(120),
  reviewed_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

/** The Devil's Advocate's flag: {verdict, rules, worst_case, resolves, at, by}. NULL = never checked. */
ALTER TABLE books.entry    ADD COLUMN IF NOT EXISTS verdict jsonb;--> statement-breakpoint
ALTER TABLE books.ri_entry ADD COLUMN IF NOT EXISTS verdict jsonb;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GRANTS — 0005's shape, applied to what this adds
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'books_app') THEN
    REVOKE DELETE ON books.compliance_rule FROM books_app;
  ELSE
    RAISE WARNING 'role books_app does not exist; DELETE stays granted by default ACLs. Replay this block after provisioning (docs/sql/books-app-role.sql).';
  END IF;
END $$;
