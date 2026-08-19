// This app's database schema: the shared platform tables plus its own.
//
// THE BOUNDARY RULE: this app's tables live in ITS OWN Postgres schema, and it
// may not read or write another app's. That is enforced by grants, not by
// review — `books_app` simply has no SELECT on `issues.*`. See
// docs/platform-architecture.md §4.3 and docs/sql/app-role.sql.
//
// Deciding where a new table goes is one question: "would a second app need this
// unchanged?" Yes → `packages/platform-db` (workspaces, members, comments,
// labels, uploads, events). No → here.
import {
  pgSchema,
  serial,
  varchar,
  text,
  integer,
  smallint,
  timestamp,
  numeric,
  date,
  boolean,
  jsonb,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/pg-core'
import { users } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const booksSchema = pgSchema('books')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RE-EXPORT IS WHY EVERY TABLE BELOW IS PREFIXED. DO NOT "TIDY" THE NAMES.
// ═══════════════════════════════════════════════════════════════════════════
// The line above exports `workspaces`, `workspaceMembers` and
// `workspaceInvitations` — the PLATFORM ones. A local `export const workspaces`
// would shadow `platform.workspaces` at every import site in this app,
// SILENTLY: no error, no warning, and the switch-over would have happened by
// name resolution instead of in a diff a reviewer can read.
//
// So the TypeScript names carry the app (`booksWorkspaces`) and the Postgres
// names do not (`books.workspaces` — the schema already says which app).
// Agent 2 found this in `apps/sales` Phase 1; agents 3 and 4 both relied on it,
// and agent 4 credited it as the reason a 35-call-site move stayed readable.
export * from '@blackcode/platform-db/schema'

/**
 * THIS APP'S WORKSPACES (Phase 7, 2026-08-11).
 *
 * Before this the scaffold read `platform.workspaces` through the shared route
 * factories, so a copy of it could not serve a request until somebody granted it
 * a workspace inside ANOTHER app. That is the add-on shape the multi-app
 * refactor exists to remove, and shipping it in the directory people copy would
 * have handed it to app #3.
 *
 * One workspace per person is a UI decision, not a schema one: every table here
 * carries a `workspace_id`, so growing a switcher later is a UI change rather
 * than a migration.
 */
export const booksWorkspaces = booksSchema.table('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 40 }).notNull(),
  owner_id: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Membership — and this table IS the access gate for this app.
 *
 * There is no per-app grant to check beside it: `platform.workspace_apps` and
 * `platform.app_access` were dropped on 2026-08-10 with `requireAppAccess`.
 * A member of this app's workspace is a user of this app, full stop.
 */
export const booksWorkspaceMembers = booksSchema.table('workspace_members', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Pending invitations into one of this app's workspaces. */
export const booksInvitations = booksSchema.table('invitations', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  invited_by: integer('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  token: varchar('token', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  accepted_at: timestamp('accepted_at', { withTimezone: true }),
  accepted_by: integer('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type BooksWorkspace = typeof booksWorkspaces.$inferSelect
export type BooksInvitation = typeof booksInvitations.$inferSelect


// ===========================================================================
// THE STATUTORY CORE (migration 0003)
// ===========================================================================
// The TypeScript mirror of the hand-written migrations. It is a MIRROR and not a
// source: `db:generate` cannot be used on this app (see 0001's header), so these
// declarations follow the SQL rather than producing it. When they disagree, the
// SQL is right and this file is the bug.
//
// `lib/db/schema-parity.test.ts` compares the two against the live database, so a
// column added in one place and not the other fails a test instead of failing a
// query at runtime.
//
// ── MONEY IS `numeric(14,2)` AND DRIZZLE HANDS IT BACK AS A STRING ──────────
// That is correct and deliberate: a bilan balances to the rappen and a float
// cannot hold 0.10. `lib/types.ts` types it as `Money = string` all the way to the
// browser. Never `Number()` it except for view arithmetic (`lib/format.ts`).

/**
 * One counter row per (workspace, entity type).
 *
 * Replaces the fixed-column shape of `note_counters` above, which needs an ALTER
 * for every new entity type. That is the generalisation the scaffold's own
 * comment records as the wanted follow-up.
 */
export const booksCounters = booksSchema.table(
  'counters',
  {
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_type: varchar('entity_type', { length: 32 }).notNull(),
    last_value: integer('last_value').default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace_id, t.entity_type] })]
)

/**
 * The art. 959a / 959b line keys, seeded from `lib/statements.ts` by migration.
 *
 * A lookup table so `account.statement_position` can be a real foreign key. The
 * ORDER, the French labels and the signs stay in code; only the SET of legal keys
 * lives here. Nothing writes it at runtime and `books_app` has SELECT only.
 */
export const booksStatementPosition = booksSchema.table('statement_position', {
  pos: varchar('pos', { length: 40 }).primaryKey(),
  statement: varchar('statement', { length: 10 }).notNull(),
})

/**
 * ONE ROW PER BOOK. The user creates these and may have any number.
 *
 * A book is not a workspace (D1). The tax parameters live here rather than in a
 * constant because they already differ per book in the seed: blackcode SA is VAT
 * registered and files quarterly, AIOS SA is under the threshold and is not
 * registered at all.
 */
export const booksEntity = booksSchema.table(
  'entity',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    /** Workspace-scoped #number. Never expose `id`. */
    seq: integer('seq').notNull(),
    /** The mockup switches books with `?entity=blackcode`. */
    slug: varchar('slug', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** `SA` | `RI`. A CHECK in 0004 makes an SA with simplified books impossible. */
    legal_form: varchar('legal_form', { length: 20 }).notNull(),
    seat: text('seat'),
    bookkeeping_regime: varchar('bookkeeping_regime', { length: 20 }).notNull(),
    /** The art. 957 al. 2 election, recorded rather than assumed. */
    regime_election: varchar('regime_election', { length: 40 }),
    regime_note: jsonb('regime_note'),
    fiscal_year: varchar('fiscal_year', { length: 20 }).default('calendar').notNull(),
    vat_registered: boolean('vat_registered').default(false).notNull(),
    vat_method: varchar('vat_method', { length: 20 }),
    vat_filing: varchar('vat_filing', { length: 20 }),
    vat_note: jsonb('vat_note'),
    audit_status: varchar('audit_status', { length: 20 }),
    fte_count: numeric('fte_count', { precision: 6, scale: 2 }),
    accent: varchar('accent', { length: 16 }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('entity_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    unique('entity_workspace_id_slug_unique').on(t.workspace_id, t.slug),
  ]
)

/**
 * The fiscal year. The one thing here that is genuinely expensive to retrofit.
 *
 * The mockup has no fiscal year at all: its derivations sum every posting with no
 * boundary. Every derivation in this app takes `(entityId, exerciceId)` from its
 * first line so that multi-year is additive rather than a rewrite.
 */
export const booksExercice = booksSchema.table(
  'exercice',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    starts_on: date('starts_on').notNull(),
    ends_on: date('ends_on').notNull(),
    /** `open` | `closed`. Closing is what freezes the next year's openings. */
    status: varchar('status', { length: 20 }).default('open').notNull(),
    closed_at: timestamp('closed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('exercice_entity_id_year_unique').on(t.entity_id, t.year)]
)

/**
 * The Swiss PME chart, per book.
 *
 * `label` holds the mockup's own `{ fr, enSuffix }` shape verbatim, including the
 * unusual key name, because the frontend codes against that JSON.
 */
export const booksAccount = booksSchema.table(
  'account',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    no: varchar('no', { length: 10 }).notNull(),
    class: smallint('class').notNull(),
    label: jsonb('label').notNull(),
    statement: varchar('statement', { length: 10 }).notNull(),
    /** NOT NULL FK. An unmapped account is a load error, never an "autre" bucket. */
    statement_position: varchar('statement_position', { length: 40 })
      .notNull()
      .references(() => booksStatementPosition.pos, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('account_entity_id_no_unique').on(t.entity_id, t.no),
    index('idx_books_account_entity').on(t.entity_id),
  ]
)

/**
 * Opening balances. A table, not a constant.
 *
 * **A missing row means zero, not an error.** The mockup's `OPENING` covers only
 * `blackcode` and `aios`: the RI has none at all. And amounts go NEGATIVE —
 * account 2970 is `résultat reporté` and a carried-forward loss is below zero.
 */
export const booksOpeningBalance = booksSchema.table(
  'opening_balance',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    exercice_id: integer('exercice_id')
      .notNull()
      .references(() => booksExercice.id, { onDelete: 'cascade' }),
    account_no: varchar('account_no', { length: 10 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('opening_balance_entity_exercice_account_unique').on(
      t.entity_id,
      t.exercice_id,
      t.account_no
    ),
  ]
)

/**
 * Where money moved. Phase 1 keeps the flat lookup only.
 *
 * `entity_id` IS NULLABLE and that is data rather than laxity: source 509 is
 * PostFinance, carrying "UNCONFIRMED, Andrea to confirm whether any entity holds
 * an account". An unattributed source is a real state to hold and to show.
 */
export const booksSource = booksSchema.table(
  'source',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    /** NULL is legitimate. See above. */
    entity_id: integer('entity_id').references(() => booksEntity.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    /** NULLABLE: the three-tier hierarchy is phase 3's, and four sources have no tier. */
    layer: varchar('layer', { length: 20 }),
    /** Self-reference: a card draws on a bank account. */
    draws_from: integer('draws_from'),
    ledger_accounts: text('ledger_accounts').array().default([]).notNull(),
    method: text('method'),
    expected: varchar('expected', { length: 20 }),
    last_import: date('last_import'),
    retired: boolean('retired').default(false).notNull(),
    notes_freeform: jsonb('notes_freeform'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('source_workspace_id_seq_unique').on(t.workspace_id, t.seq)]
)

/**
 * A recognition rule. Keyed on the PAIR (source, counterparty), never the
 * counterparty alone.
 *
 * The mockup's rule 101 is the reason and says so: the rent was taught by a UBS
 * entry then moved to WIR, so "IMMOREGIE" alone would match two sources and mean
 * two different things.
 *
 * `learned_from` is the mockup's `source` field renamed, because a column called
 * `source` beside `source_id` reads as the same fact twice. The API serves it as
 * `source`.
 */
export const booksRule = booksSchema.table(
  'rule',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    source_id: integer('source_id').references(() => booksSource.id, { onDelete: 'set null' }),
    active: boolean('active').default(true).notNull(),
    learned_from: varchar('learned_from', { length: 40 }),
    /** `{ counterparty, amount_chf, tolerance_chf, interval }`. */
    pattern: jsonb('pattern').notNull(),
    explanation: jsonb('explanation'),
    account_no: varchar('account_no', { length: 10 }),
    /**
     * The entry that taught this rule. **Deliberately not a foreign key**:
     * `entry.matched_rule_id` already points the other way, so this edge would be
     * circular and need an ALTER after both tables exist. See docs/backend.md §2.
     */
    created_from_entry_id: integer('created_from_entry_id'),
    created_on: date('created_on'),
    note: jsonb('note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('rule_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    index('idx_books_rule_lookup').on(t.source_id, t.active),
  ]
)

/**
 * One row per écriture. The double-entry ledger.
 *
 * ── POSTING IS A TRANSITION ─────────────────────────────────────────────────
 * You cannot insert this with `status: 'posted'` and then add lines: 0004's
 * trigger refuses them. Insert `staged`, add lines, then UPDATE to `posted`.
 *
 * ── WHAT FREEZES AND WHAT DOES NOT ──────────────────────────────────────────
 * Once posted: entity, exercice, entry_no, date, seq, the lines, the VAT rate and
 * amount, and any delete. Still open: counterparty, explanation, recognition,
 * matched rule, evidence tier and note, related party, the pièce, history, and
 * `tva_input_claimed`. Entry 1009 in the mockup is posted, unrecognized, and meant
 * to be resolved later, which is why the freeze is per column.
 */
export const booksEntry = booksSchema.table(
  'entry',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    exercice_id: integer('exercice_id')
      .notNull()
      .references(() => booksExercice.id, { onDelete: 'restrict' }),
    /** Workspace #number. Addresses the row. */
    seq: integer('seq').notNull(),
    /** Statutory journal number, gapless per (entity, exercice). Not the same job as `seq`. */
    entry_no: integer('entry_no').notNull(),
    date: date('date').notNull(),
    status: varchar('status', { length: 20 }).default('staged').notNull(),
    source_id: integer('source_id').references(() => booksSource.id, { onDelete: 'set null' }),
    /** The bank's own text. Frozen at EVERY status, not only once posted. */
    raw_label: text('raw_label').notNull(),
    counterparty: varchar('counterparty', { length: 200 }),
    explanation: jsonb('explanation'),
    recognition: varchar('recognition', { length: 30 }).default('unrecognized').notNull(),
    matched_rule_id: integer('matched_rule_id').references(() => booksRule.id, {
      onDelete: 'set null',
    }),
    evidence_tier: varchar('evidence_tier', { length: 10 }).default('bare').notNull(),
    evidence_note: jsonb('evidence_note'),
    tva_rate: numeric('tva_rate', { precision: 5, scale: 2 }),
    tva_amount: numeric('tva_amount', { precision: 14, scale: 2 }),
    /** NEVER derived from `evidence_tier`. A CHECK requires `full` to claim. */
    tva_input_claimed: boolean('tva_input_claimed').default(false).notNull(),
    tva_note: jsonb('tva_note'),
    /** art. 959a al. 4. Holds `mirror_entry_id`, which points into another book. */
    related_party: jsonb('related_party'),
    piece_drive_ref: text('piece_drive_ref'),
    piece_hash: varchar('piece_hash', { length: 80 }),
    piece_captured: date('piece_captured'),
    /** 0011: the original-currency story, display-only. Nothing computes with it. */
    fx: jsonb('fx'),
    /** 0012: the bank's own reference — the import door's idempotency key. */
    bank_ref: varchar('bank_ref', { length: 64 }),
    /** 0014: the Devil's Advocate's flag {verdict, rules, worst_case, resolves, at, by}. NULL = never checked. */
    verdict: jsonb('verdict'),
    /** The only correction path. */
    reverses_entry_id: integer('reverses_entry_id'),
    history: jsonb('history'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('entry_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    unique('entry_entity_exercice_no_unique').on(t.entity_id, t.exercice_id, t.entry_no),
    index('idx_books_entry_entity_exercice').on(t.entity_id, t.exercice_id),
  ]
)

/**
 * The debit and credit sides.
 *
 * `account_no` IS NULLABLE while staged. Mockup entries 1012, 1013 and 2004 carry
 * `account: null` on the debit side, which is the normal arrival state: the money
 * moved and nobody has said yet what it was for. That is the whole reason the
 * balance check fires on posted rows only.
 */
export const booksEntryLine = booksSchema.table(
  'entry_line',
  {
    id: serial('id').primaryKey(),
    entry_id: integer('entry_id')
      .notNull()
      .references(() => booksEntry.id, { onDelete: 'cascade' }),
    /** NULL while staged. Required once posted. */
    account_no: varchar('account_no', { length: 10 }),
    debit: numeric('debit', { precision: 14, scale: 2 }).default('0').notNull(),
    credit: numeric('credit', { precision: 14, scale: 2 }).default('0').notNull(),
    position: smallint('position').default(0).notNull(),
  },
  (t) => [index('idx_books_entry_line_entry').on(t.entry_id)]
)

/**
 * The single-entry book. Art. 957 al. 2 CO.
 *
 * NOT a double-entry transaction with a line missing: `direction` plus `amount`,
 * because recettes/dépenses has no debit and credit to balance. Modelling it as a
 * small `entry` would import a balance requirement that does not legally apply.
 */
export const booksRiEntry = booksSchema.table(
  'ri_entry',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    exercice_id: integer('exercice_id')
      .notNull()
      .references(() => booksExercice.id, { onDelete: 'restrict' }),
    seq: integer('seq').notNull(),
    date: date('date').notNull(),
    /** `recette` | `depense`. */
    direction: varchar('direction', { length: 10 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    category: jsonb('category'),
    raw_label: text('raw_label').notNull(),
    counterparty: varchar('counterparty', { length: 200 }),
    explanation: jsonb('explanation'),
    recognition: varchar('recognition', { length: 30 }).default('unrecognized').notNull(),
    matched_rule_id: integer('matched_rule_id').references(() => booksRule.id, {
      onDelete: 'set null',
    }),
    evidence_tier: varchar('evidence_tier', { length: 10 }).default('bare').notNull(),
    evidence_note: jsonb('evidence_note'),
    piece_drive_ref: text('piece_drive_ref'),
    piece_hash: varchar('piece_hash', { length: 80 }),
    piece_captured: date('piece_captured'),
    /** 0011: the original-currency story, display-only. Nothing computes with it. */
    fx: jsonb('fx'),
    /** 0012: the bank's own reference — the import door's idempotency key. */
    bank_ref: varchar('bank_ref', { length: 64 }),
    /** 0012: which register source delivered this line. NULL for pre-import rows. */
    source_id: integer('source_id').references(() => booksSource.id, {
      onDelete: 'set null',
    }),
    /** 0014: the Devil's Advocate's flag {verdict, rules, worst_case, resolves, at, by}. NULL = never checked. */
    verdict: jsonb('verdict'),
    history: jsonb('history'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('ri_entry_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    index('idx_books_ri_entry_entity_exercice').on(t.entity_id, t.exercice_id),
  ]
)

/**
 * The RI net-worth statement. The second half of art. 957 al. 2.
 *
 * `as_of` is what the statement describes; `compiled` is when it was produced.
 * Two fields on purpose: a reader needs both to judge it.
 */
export const booksPatrimoine = booksSchema.table(
  'patrimoine',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    exercice_id: integer('exercice_id').references(() => booksExercice.id, {
      onDelete: 'set null',
    }),
    seq: integer('seq').notNull(),
    as_of: date('as_of').notNull(),
    compiled: date('compiled'),
    /** `[{ label, amount }]`. Not a chart of accounts, and must not become one. */
    items: jsonb('items').default([]).notNull(),
    note: jsonb('note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('patrimoine_workspace_id_seq_unique').on(t.workspace_id, t.seq)]
)

export type BooksEntity = typeof booksEntity.$inferSelect
export type BooksExercice = typeof booksExercice.$inferSelect
export type BooksAccount = typeof booksAccount.$inferSelect
export type BooksOpeningBalance = typeof booksOpeningBalance.$inferSelect

// ---------------------------------------------------------------------------
// Phase 3: what hangs off the sources register, and the pièces pipeline
// ---------------------------------------------------------------------------
// None of these is read by any derivation: a staged piece cannot reach a
// statement by construction. Migration 0008 carries the full reasoning.

/** Raw files pulled from a source. `hash` is of OUR copy, taken at download. */
export const booksSourcePull = booksSchema.table(
  'source_pull',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    source_id: integer('source_id')
      .notNull()
      .references(() => booksSource.id, { onDelete: 'cascade' }),
    file: varchar('file', { length: 200 }).notNull(),
    period: varchar('period', { length: 60 }),
    format: varchar('format', { length: 40 }),
    hash: varchar('hash', { length: 80 }),
    drive_ref: text('drive_ref'),
    pulled: date('pulled'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('source_pull_source_id_file_unique').on(t.source_id, t.file),
    index('idx_books_source_pull_source').on(t.source_id),
  ]
)

/** How to pull a source, versioned in place. `credential_ref` is a REFERENCE, never a secret. */
export const booksRunbook = booksSchema.table('runbook', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
  source_id: integer('source_id')
    .notNull()
    .unique()
    .references(() => booksSource.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 20 }).notNull().default('1.0'),
  updated: date('updated'),
  login_url: text('login_url'),
  credential_ref: text('credential_ref'),
  steps: jsonb('steps').notNull().default([]),
  output: varchar('output', { length: 80 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * One row per document the worker delivered. Always staged on arrival.
 *
 * `extraction` is the worker's payload VERBATIM; `validation` is THE SERVER'S
 * verdict, recomputed from the payload's own arithmetic, and the only one
 * anything trusts. Idempotency lives in a COALESCE unique index the migration
 * owns — Drizzle cannot express it, so do not "fix" its absence here.
 */
export const booksPieceInbox = booksSchema.table(
  'piece_inbox',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    /** Attribution. NULLABLE: a scanned receipt does not always say whose it is. */
    entity_id: integer('entity_id').references(() => booksEntity.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('staged'),
    received: date('received').notNull(),
    pipeline: varchar('pipeline', { length: 120 }),
    drive_file_id: varchar('drive_file_id', { length: 120 }).notNull(),
    file_name: varchar('file_name', { length: 300 }),
    mime_type: varchar('mime_type', { length: 120 }),
    md5_checksum: varchar('md5_checksum', { length: 64 }),
    drive_created_time: timestamp('drive_created_time', { withTimezone: true }),
    web_view_link: text('web_view_link'),
    extraction: jsonb('extraction').notNull(),
    validation: jsonb('validation').notNull(),
    needs_review: boolean('needs_review').notNull().default(false),
    duplicate_of_id: integer('duplicate_of_id'),
    matched_entry_id: integer('matched_entry_id').references(() => booksEntry.id, {
      onDelete: 'set null',
    }),
    /** The RI journal's half of the match. 0010's CHECK: never both. */
    matched_ri_entry_id: integer('matched_ri_entry_id').references(() => booksRiEntry.id, {
      onDelete: 'set null',
    }),
    matched_at: timestamp('matched_at', { withTimezone: true }),
    note: jsonb('note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('piece_inbox_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    index('idx_books_piece_inbox_ws').on(t.workspace_id, t.status),
  ]
)

/** The worker's ledger of the Drive inbox: one row per file, six states. */
export const booksDriveManifest = booksSchema.table(
  'drive_manifest',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    source_id: integer('source_id')
      .notNull()
      .references(() => booksSource.id, { onDelete: 'cascade' }),
    file_id: varchar('file_id', { length: 120 }).notNull(),
    name: varchar('name', { length: 300 }),
    mime_type: varchar('mime_type', { length: 120 }),
    drive_created_time: timestamp('drive_created_time', { withTimezone: true }),
    fetched: date('fetched'),
    extracted_piece_id: integer('extracted_piece_id').references(() => booksPieceInbox.id, {
      onDelete: 'set null',
    }),
    state: varchar('state', { length: 20 }).notNull().default('discovered'),
    archived: boolean('archived').notNull().default(false),
    archive_ref: text('archive_ref'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('drive_manifest_workspace_id_file_id_unique').on(t.workspace_id, t.file_id),
    index('idx_books_drive_manifest_source').on(t.source_id, t.state),
  ]
)

/**
 * 0013: a recorded analysis — question, verdict, and the `based_on` snapshot of
 * what the agent read at answer time. APPEND-ONLY: UPDATE and DELETE are revoked
 * from the app role, and no query function offers either. A stored answer that
 * silently changes is worse than a stale one.
 */
export const booksAnalysis = booksSchema.table(
  'analysis',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** When the answer was FILED — the server's clock, not the caller's claim. */
    asked: timestamp('asked', { withTimezone: true }).defaultNow().notNull(),
    asked_by: varchar('asked_by', { length: 120 }).notNull(),
    agent: varchar('agent', { length: 120 }).notNull(),
    scenario_label: jsonb('scenario_label'),
    /** Numeric restatement of the verdict's runway, so charts need no prose parsing. */
    runway_after_months: numeric('runway_after_months', { precision: 8, scale: 2 }),
    question: jsonb('question').notNull(),
    verdict: jsonb('verdict').notNull(),
    figures: jsonb('figures').notNull(),
    /** What the agent read: [{label, value, href}]. Permanent. NEVER recomputed. */
    based_on: jsonb('based_on').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('analysis_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    index('idx_books_analysis_entity').on(t.entity_id, t.asked),
  ]
)

/**
 * 0013: management cost categories — ledger accounts mapped to a named bucket,
 * per ENTITY because the mapping names accounts and the chart is the entity's.
 * Never deleted (a past analysis may cite a breakdown that used one): `retired`
 * is the exit, like a source's.
 */
export const booksAnalytiqueCategory = booksSchema.table(
  'analytique_category',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
    entity_id: integer('entity_id')
      .notNull()
      .references(() => booksEntity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    key: varchar('key', { length: 40 }).notNull(),
    label: jsonb('label').notNull(),
    /** Account numbers as a jsonb string array, validated against the chart at write time. */
    accounts: jsonb('accounts').notNull(),
    retired: boolean('retired').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('analytique_category_workspace_id_seq_unique').on(t.workspace_id, t.seq),
    unique('analytique_category_entity_id_key_unique').on(t.entity_id, t.key),
  ]
)

/**
 * 0013: the entity's tax parameters — canton, commune, and the TAX_INFO shape
 * with citations and `confirmed` flags. One row per entity; a book without one
 * shows "not configured" rather than someone else's rates.
 */
/**
 * 0014: the compliance rules — GLOBAL, like the vocabularies: the same law
 * binds every book, so there is no workspace column. All 19 load as DRAFT;
 * review (approve/edit/reject, with who and when) is the only write, and
 * DELETE is revoked — a verdict may cite a rule forever.
 */
export const booksComplianceRule = booksSchema.table('compliance_rule', {
  id: serial('id').primaryKey(),
  rule_id: varchar('rule_id', { length: 20 }).notNull().unique(),
  citation: text('citation').notNull(),
  applies_to: varchar('applies_to', { length: 10 }).notNull(),
  trigger_condition: text('trigger_condition').notNull(),
  check_logic: text('check_logic').notNull(),
  severity: varchar('severity', { length: 10 }).notNull(),
  consequence: text('consequence').notNull(),
  /** The human-sized {fr, en} one-liner, from the mockup's card. */
  summary: jsonb('summary'),
  source_confidence: varchar('source_confidence', { length: 30 }).notNull(),
  review_state: varchar('review_state', { length: 10 }).default('draft').notNull(),
  /** The fiduciary's corrected wording when review_state = 'edited'. The original stays. */
  edited_logic: text('edited_logic'),
  review_note: text('review_note'),
  reviewed_by: varchar('reviewed_by', { length: 120 }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const booksTaxParams = booksSchema.table('tax_params', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => booksWorkspaces.id, { onDelete: 'cascade' }),
  entity_id: integer('entity_id')
    .notNull()
    .unique()
    .references(() => booksEntity.id, { onDelete: 'cascade' }),
  canton: varchar('canton', { length: 2 }).notNull(),
  commune: varchar('commune', { length: 80 }).notNull(),
  params: jsonb('params').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type BooksSource = typeof booksSource.$inferSelect
export type BooksSourcePull = typeof booksSourcePull.$inferSelect
export type BooksRunbook = typeof booksRunbook.$inferSelect
export type BooksPieceInbox = typeof booksPieceInbox.$inferSelect
export type BooksDriveManifest = typeof booksDriveManifest.$inferSelect
export type BooksRule = typeof booksRule.$inferSelect
export type BooksEntry = typeof booksEntry.$inferSelect
export type BooksEntryLine = typeof booksEntryLine.$inferSelect
export type BooksRiEntry = typeof booksRiEntry.$inferSelect
export type BooksPatrimoine = typeof booksPatrimoine.$inferSelect
export type BooksAnalysis = typeof booksAnalysis.$inferSelect
export type BooksAnalytiqueCategory = typeof booksAnalytiqueCategory.$inferSelect
export type BooksTaxParams = typeof booksTaxParams.$inferSelect
export type BooksComplianceRule = typeof booksComplianceRule.$inferSelect
