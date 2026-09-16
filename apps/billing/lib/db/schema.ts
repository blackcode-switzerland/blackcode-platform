// This app's database schema: the shared platform tables plus its own.
//
// THE BOUNDARY RULE: this app's tables live in ITS OWN Postgres schema, and it
// may not read or write another app's. That is enforced by grants, not by
// review — `billing_app` simply has no SELECT on `issues.*`. See
// docs/platform-architecture.md §4.3 and docs/sql/billing-app-role.sql.
//
// Deciding where a new table goes is one question: "would a second app need this
// unchanged?" Yes → `packages/platform-db` (users, api_tokens, the blob index).
// No → here. For b/billing the answer has been "here" every time so far.
import {
  pgSchema,
  serial,
  bigserial,
  varchar,
  char,
  text,
  integer,
  numeric,
  boolean,
  date,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core'
import { users } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const billingSchema = pgSchema('billing')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RE-EXPORT IS WHY EVERY TABLE BELOW IS PREFIXED. DO NOT "TIDY" THE NAMES.
// ═══════════════════════════════════════════════════════════════════════════
// The line below exports `workspaces`, `workspaceMembers` and
// `workspaceInvitations` — the PLATFORM ones. A local `export const workspaces`
// would shadow `platform.workspaces` at every import site in this app,
// SILENTLY: no error, no warning, and the switch-over would have happened by
// name resolution instead of in a diff a reviewer can read.
//
// So the TypeScript names carry the app (`billingWorkspaces`) and the Postgres
// names do not (`billing.workspaces` — the schema already says which app).
export * from '@blackcode/platform-db/schema'

/**
 * THIS APP'S WORKSPACES.
 *
 * An app owns its workspaces, members and invitations. `platform.*` is identity
 * plus an address book; `platform.workspaces` is `apps/issues`' data despite the
 * name. FK into `platform.users` freely, and into nothing else outside this
 * schema.
 *
 * ── TWO COLUMNS THE SCAFFOLD HAS THAT THIS DOES NOT ─────────────────────────
 * No `app` column: the schema name is the answer. And no `deleted_at`, which has
 * never had a writer in any app and would acquire a second meaning by being
 * carried forward. Dropping the columns that only existed because a platform
 * table was shared is part of copying it.
 */
export const billingWorkspaces = billingSchema.table('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 40 }).notNull(),
  /**
   * `ON DELETE RESTRICT` stays, and it is INERT — know what it does not do.
   *
   * It cannot fire against the `UPDATE` that soft-deletes a user, which is how
   * an account is actually closed. What protects this app's data from being
   * stranded under an unreachable account is `AppContext.footprint`
   * (lib/db/queries/footprint.ts), not this constraint.
   */
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
export const billingWorkspaceMembers = billingSchema.table('workspace_members', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('member').notNull(),
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Pending invitations into one of this app's workspaces. */
export const billingInvitations = billingSchema.table('invitations', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
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

/**
 * The #number allocator: one row per workspace, PER ENTITY TYPE.
 *
 * ── WHY NOT `platform.workspace_counters` ────────────────────────────────────
 * Because it cannot be used. That table has FIXED columns — `last_issue_seq`,
 * `last_project_seq`, `last_task_seq` — so it is shaped for exactly one app's
 * entity types. A second app allocating a #number from it would have to ALTER a
 * platform table every time it added an entity, which is precisely the coupling
 * the platform/app split exists to prevent.
 *
 * ── AND WHY NOT THE SCAFFOLD'S SHAPE EITHER ──────────────────────────────────
 * The scaffold's `note_counters` is `(workspace_id, last_note_seq)`: one column
 * per entity type, which is the same mistake one level down. Phase 1 of this app
 * adds `company`, `invoice` and `audit`; phases 4 and 5 add `recurrence` and
 * `history`. With a column per type each of those is a migration of this table.
 * With `(workspace_id, entity_type, last_value)` they are rows, and the
 * allocator is one upsert that never changes.
 *
 * The counter is bumped with `RETURNING` inside the writing transaction, never
 * read-then-write: two concurrent creates would otherwise read the same value
 * and collide. See `lib/db/queries/seq.ts` from phase 1.
 */
export const billingCounters = billingSchema.table('counters', {
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  entity_type: varchar('entity_type', { length: 20 }).notNull(),
  last_value: integer('last_value').default(0).notNull(),
})

export type BillingWorkspace = typeof billingWorkspaces.$inferSelect
export type BillingInvitation = typeof billingInvitations.$inferSelect

// ===========================================================================
// THE CORE — phase 1. Mirrors migration 0004 column for column.
// ===========================================================================
// This half of the file is a MIRROR of hand-written SQL, and the two can drift.
// `lib/db/schema-parity.test.ts` reads both and fails when they do, which is
// what makes the mirror trustworthy rather than aspirational.
//
// ── EVERY MONEY COLUMN IS `numeric`, AND DRIZZLE HANDS IT BACK AS A STRING ──
// That is the point. `numeric(14,2)` → `string` in TypeScript means the value
// cannot pass through a float on the way out of the database, and
// `lib/derive/totals.ts` parses those strings into integer rappen. A money
// column declared as `real` or read through `Number()` is silently wrong in the
// last rappen, and an invoice wrong in the last rappen is one somebody reissues.
//
// ── AND NOTHING DERIVED IS A COLUMN ─────────────────────────────────────────
// No `subtotal`, no `vat`, no `total`, no `line_total`. Look for one and you are
// looking at a bug: the rounding policy is a COMPANY setting (D-B7), so a stored
// total would have to be rewritten across history every time that setting moved.

/**
 * The issuing company — the entity whose name, address and bank account appear
 * on the bill.
 *
 * Multi-entity by design: a new company is a row, never a code change. A
 * workspace is a tenant; this is what it bills from.
 */
export const billingCompany = billingSchema.table('company', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  /** The workspace #number — the address. `id` is never printed by any surface. */
  seq: integer('seq').notNull(),
  /** The URL and CLI handle. Immutable after create, enforced at the write door. */
  slug: varchar('slug', { length: 40 }).notNull(),

  name: varchar('name', { length: 70 }).notNull(),
  /**
   * Goes on the payment part, and **must match the account holder** of the
   * credit account (spec §4 line 6). 70 is the payload's own limit, so the
   * column enforces it rather than the renderer trimming it.
   */
  legal_name: varchar('legal_name', { length: 70 }).notNull(),

  street: varchar('street', { length: 70 }),
  building: varchar('building', { length: 16 }),
  postal_code: varchar('postal_code', { length: 16 }),
  city: varchar('city', { length: 35 }),
  country: char('country', { length: 2 }),

  email: varchar('email', { length: 255 }),
  logo_initials: varchar('logo_initials', { length: 4 }),
  logo_color: varchar('logo_color', { length: 9 }),

  /** ⇠ borrowed from b/books. Carries SCOR and NON, CHF and EUR. Owner-only to edit. */
  iban: varchar('iban', { length: 21 }),
  /** ⇠ borrowed from b/books. QR-IID 30000–31999. Null means QRR is impossible here. */
  qr_iban: varchar('qr_iban', { length: 21 }),

  /** `false` means VAT is OMITTED from its invoices — no rate, no 0%, no block. */
  vat_registered: boolean('vat_registered').default(false).notNull(),
  uid: varchar('uid', { length: 32 }),
  vat_number: varchar('vat_number', { length: 32 }),

  // Prefills for NEW invoices and their lines. Never read at render time: an
  // old document must not change because somebody edited a setting.
  default_currency: char('default_currency', { length: 3 }).default('CHF').notNull(),
  default_language: varchar('default_language', { length: 2 }).default('fr').notNull(),
  default_ref_type: varchar('default_ref_type', { length: 4 }).default('NON').notNull(),
  default_vat_rate: numeric('default_vat_rate', { precision: 5, scale: 2 }),
  default_prices_include_vat: boolean('default_prices_include_vat').default(false).notNull(),
  payment_terms_days: integer('payment_terms_days').default(30).notNull(),

  /**
   * Read at DERIVATION time, unlike the defaults above — decision D-B7.
   * Changing it changes every total this company has ever derived.
   */
  rounding: varchar('rounding', { length: 12 }).default('line_0_05').notNull(),

  number_format: varchar('number_format', { length: 40 }).default('BC-{YYYY}-{SEQ4}').notNull(),

  /**
   * **THE GAPLESS ALLOCATOR.** Read `lib/db/queries/seq.ts` before touching
   * anything near this column. Bumped by a row-locking `UPDATE … RETURNING`
   * inside the invoice insert's transaction; never a Postgres `SEQUENCE`,
   * which is non-transactional and would leave a hole on rollback.
   */
  next_seq: integer('next_seq').default(1).notNull(),

  footer_fr: text('footer_fr'),
  footer_en: text('footer_en'),
  /** Retired companies issue no new invoices and still render their old ones. */
  retired_at: timestamp('retired_at', { withTimezone: true }),

  external_ref: varchar('external_ref', { length: 80 }),
  metadata: jsonb('metadata').default({}).notNull(),

  created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * The invoice. A numbered legal document, with three identifiers that must never
 * be confused: `id` (the row, printed nowhere), `seq` (the workspace #number,
 * the address) and `seq_no`/`number` (the per-company statutory sequence).
 */
export const billingInvoice = billingSchema.table('invoice', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),

  /** Frozen after insert by G1: a changed issuer is a different document. */
  company_id: integer('company_id')
    .notNull()
    .references(() => billingCompany.id, { onDelete: 'restrict' }),
  seq_no: integer('seq_no').notNull(),
  number: varchar('number', { length: 40 }).notNull(),

  status: varchar('status', { length: 10 }).default('draft').notNull(),
  issue_date: date('issue_date').notNull(),
  due_date: date('due_date'),
  paid_date: date('paid_date'),

  currency: char('currency', { length: 3 }).notNull(),
  /** The DOCUMENT's language, not the operator's UI language. */
  language: varchar('language', { length: 2 }).notNull(),

  ref_type: varchar('ref_type', { length: 4 }).notNull(),
  /** Without its check digit, which is derived on every render (I6). */
  ref_body: varchar('ref_body', { length: 26 }),

  /**
   * One self-contained block. Nothing else on the invoice may depend on its
   * internals, which is what makes the later b/clients swap a data-source
   * change. It holds no money, so D-B4's float64 objection to `jsonb` does not
   * apply here.
   */
  client: jsonb('client').default({}).notNull(),

  /** The rate prefilled onto NEW lines. The totals read the lines, never this. */
  vat_rate: numeric('vat_rate', { precision: 5, scale: 2 }),
  /** `true` means each line's price already contains its VAT. Frozen by G2. D-B7. */
  prices_include_vat: boolean('prices_include_vat').default(false).notNull(),

  /** 140 characters, the QR-bill's own budget, shared with billing information. */
  message: varchar('message', { length: 140 }),
  /** A void is a RECORD, never a deletion. `{ts, by, reason: {fr, en}}`. */
  void: jsonb('void'),

  external_ref: varchar('external_ref', { length: 80 }),
  metadata: jsonb('metadata').default({}).notNull(),

  created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * One line of an invoice — **a table, not a `jsonb` column** (decision D-B4).
 *
 * The wire shape stays `items: [...]` as the mockup serves it; the shaping
 * function assembles it. What a table buys is that the amounts survive: a money
 * value inside `jsonb` is a JSON number and therefore a float64.
 */
export const billingInvoiceLine = billingSchema.table('invoice_line', {
  id: serial('id').primaryKey(),
  invoice_id: integer('invoice_id')
    .notNull()
    .references(() => billingInvoice.id, { onDelete: 'cascade' }),
  line_no: integer('line_no').notNull(),

  description: text('description').notNull(),
  /** Three decimals: 12 days, 0.5 hours, 48 pieces. Not money, so not (14,2). */
  qty: numeric('qty', { precision: 12, scale: 3 }).default('1').notNull(),
  /** Display-only text, deliberately not a vocabulary. */
  unit: varchar('unit', { length: 24 }),
  unit_price: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),

  /**
   * **NULL means this line carries no VAT** — an exempt medical act, or a
   * company that is not registered. `0` is a valid rate and prints `TVA 0%`.
   *
   * The test is `!== null`, never `> 0`: that spelling merges "exempt" into
   * "zero-rated", which are different facts with different consequences on a
   * VAT return. Invariant I3, per line since D-B7.
   */
  vat_rate: numeric('vat_rate', { precision: 5, scale: 2 }),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * The append-only log. **It IS the edit workflow** — there is no separate
 * history feature and no `updated_by` column anywhere in this schema.
 *
 * It also doubles as this app's event feed: `?since=<seq>` returns rows
 * ascending from a cursor. That works because `seq` comes from the counter
 * upsert, which takes a row lock, so sequence order IS commit order.
 */
export const billingAudit = billingSchema.table('audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  /** Monotonic per workspace. The feed's cursor. */
  seq: integer('seq').notNull(),

  subject_type: varchar('subject_type', { length: 16 }).notNull(),
  /**
   * The subject's `id`. Deliberately **not** a foreign key: a typed FK per
   * subject type would mean three nullable columns and a CHECK, for no gain —
   * nothing here cascades, because nothing here is deleted.
   */
  subject_id: integer('subject_id').notNull(),

  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),

  /** Humans and agents land in the same log; an agent write is a user's token. */
  actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** `session` or `token` — the only structural difference between the two. */
  via: varchar('via', { length: 8 }).notNull(),

  action: varchar('action', { length: 20 }).notNull(),
  field: varchar('field', { length: 64 }),
  from_value: text('from_value'),
  to_value: text('to_value'),
  detail_fr: text('detail_fr'),
  detail_en: text('detail_en'),
})

/**
 * The idempotency ledger.
 *
 * This app is the one on the platform where a retry is unrecoverable: the number
 * is gapless and the row is never deleted, so a retried create mints a second
 * real invoice that can only be voided.
 *
 * The UNIQUE index on `(workspace_id, key)` is the MECHANISM, not a backstop —
 * `lib/api/idempotency.ts` never checks first, because a check-then-insert is a
 * race and a concurrent double-submit is exactly the case that matters.
 */
export const billingIdempotencyKeys = billingSchema.table('idempotency_keys', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => billingWorkspaces.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 80 }).notNull(),
  /** sha256 of method + path + canonical body. A different hash is refused, never replayed. */
  request_hash: char('request_hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 8 }).default('pending').notNull(),
  response_status: integer('response_status'),
  response_body: jsonb('response_body'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type BillingCompany = typeof billingCompany.$inferSelect
export type BillingInvoiceRow = typeof billingInvoice.$inferSelect
export type BillingInvoiceLineRow = typeof billingInvoiceLine.$inferSelect
export type BillingAuditRow = typeof billingAudit.$inferSelect
