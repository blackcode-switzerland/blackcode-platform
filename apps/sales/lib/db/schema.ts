// The sales app's database schema: the shared platform tables plus its own.
//
// Derived from `bsales-mockup/assets/js/data.js` by way of
// `docs/sales-app-plan.md` §5. Where the two disagree the mockup wins — it is
// the older and more specific source — and every such departure is recorded in
// `apps/sales/docs/backend.md` with its reason.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY RULE
// ---------------------------------------------------------------------------
// This app's tables live in ITS OWN Postgres schema and it may not read or write
// another app's. That is enforced by grants, not by review: `sales_app` has no
// SELECT on `issues.*`. See docs/platform-architecture.md §4.3 and
// docs/sql/app-role.sql. `lib/app-isolation.test.ts` catches it before a shared
// local credential lets it work by accident.
//
// Deciding where a new table goes is one question: "would a SECOND app need this
// unchanged?" Yes → `packages/platform-db`. No → here. Deals, prospects and
// objections are as app-specific as a table gets.
//
// ---------------------------------------------------------------------------
// FOUR CONVENTIONS, ALL INHERITED, NONE NEGOTIABLE (§5.1)
// ---------------------------------------------------------------------------
//  1. Every addressable row has a workspace-scoped `seq` — the #number. **The
//     serial `id` is never exposed**: not in a route, not in CLI output, not in
//     a URL. `apps/issues` learned that the hard way; `bk trash` printed row ids
//     until Phase 8.
//  2. `seq` is allocated from `sales.counters` INSIDE the insert's transaction.
//     Never read-then-write. See the counters table below.
//  3. Soft delete via `deleted_at`; hard delete only through trash purge. A
//     binned row is restorable, so **its files are still in use** — which is why
//     the blob-reference triggers deliberately do not fire on a soft delete.
//  4. Money is `numeric(14,2)` + `currency char(3)`. Swiss formatting
//     (`CHF 105'000`) lives in one helper, `lib/format.ts`, and nowhere else.
//
// ---------------------------------------------------------------------------
// EVERY WRITE PATH OWES THREE THINGS, IN ONE TRANSACTION
// ---------------------------------------------------------------------------
//     db.transaction(async (tx) => {
//       const seq = await allocateSeq(tx, workspaceId, 'prospect')
//       const [row] = await tx.insert(prospects).values({ …, seq }).returning()
//       await recordEvent(tx, …)        // platform.events — D-6, no sales.activity
//       await projectEntity(tx, …)      // platform.entities — same tx, not after
//     })
//
// A projection written outside the transaction commits even when the source
// write rolls back, and the result is an entities row for a prospect that does
// not exist: `bk search` returns a title, the link resolves, and nothing looks
// wrong until somebody clicks through to a 404 weeks later.
//
// ---------------------------------------------------------------------------
// THE COLUMNS THAT CAN HOLD AN UPLOADED FILE URL — READ BEFORE ADDING ONE
// ---------------------------------------------------------------------------
// Every column below marked `BLOB-REF` needs a `platform.blob_refs_sync` trigger
// in migration 0002, and **a new one added later needs its trigger in the same
// migration**. The index is trigger-maintained precisely so that no write path
// can forget it — which concentrates the entire remaining risk on adding a
// content column without a trigger. Nothing will remind you.
//
// The rule for deciding: a column needs a trigger if a legitimate write can put
// an uploaded-file URL in it — authored prose (`scan` mode) or a column that IS
// a URL (`exact` mode). The asymmetry decides the borderline cases: a trigger on
// a column that never holds a URL costs one no-op function call per write, and a
// missing trigger costs a file somebody was still using, with no undo.
//
// **TWENTY-TWO COLUMNS ACROSS TEN TABLES.** §5.4 of the plan lists thirteen
// while its own prose says fourteen; the rule above produces twenty-two, and the
// count is a consequence rather than a target.
//
// The four length-capped LABELS in that number — `meetings.title`,
// `communications.subject`, `templates.subject`, `documents.title` — are there
// deliberately. "A title is a label, not a body" is a line one can state, and it
// is still a line about how people are expected to behave: a URL fits in 200
// characters, and `documents.title` is exactly the field somebody pastes a link
// into instead of filling in the form properly. The asymmetry above says include
// them, and "I felt it was unlikely" is the reasoning D-26 exists to distrust.
//
// Read `packages/platform-storage/src/references.ts` and
// `packages/platform-db/src/schema.ts` at `blobReferences` before touching
// anything near this.
//
// **Every table carrying a BLOB-REF column also carries `workspace_id`, even
// when it is reachable through its parent.** That is not denormalisation for
// convenience: `platform.blob_references.workspace_id` is copied from the source
// row by the trigger, and the Storage page, `bk storage list` and
// `bk super-admin blob-drift` all work one workspace at a time. `apps/issues`
// shipped `attachments.workspace_id` NULL on every row and had to repair 24
// invisible references inside migration 0037 — a clean report over a hole.

import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { apiTokens, users, workspaces } from '@blackcode/platform-db'
import { DEFAULT_LABEL_COLOR } from '@/lib/pipeline'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const salesSchema = pgSchema('sales')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
export * from '@blackcode/platform-db/schema'

// ---------------------------------------------------------------------------
// FULL-TEXT SEARCH (D-9)
// ---------------------------------------------------------------------------
// `bk search` (cross-app, bare) reads `platform.entities`, which holds titles
// only. `bk sales search` (app-owned) has to reach INSIDE records — a phrase in
// a call summary, a name in an attendee list — so each searchable table carries
// a GENERATED tsvector column with a GIN index, unioned by one query helper.
//
// ── TWO THINGS THAT ARE EASY TO GET WRONG, BOTH VERIFIED AGAINST PG 16 ──────
//
// 1. **The regconfig argument is not optional.** `to_tsvector(x)` — one
//    argument — resolves the configuration from `default_text_search_config`
//    and is therefore STABLE, and Postgres rejects it in a generated column.
//    `to_tsvector('simple', x)` is IMMUTABLE. Confirmed by `provolatile` in
//    `pg_proc`: the same function name carries both.
//
// 2. **`array_to_string` is STABLE, so a `text[]` cannot be inlined here.** Nor
//    can `arr::text` — both go through element output functions. `CREATE TABLE`
//    fails with "generation expression is not immutable". Migration 0001 defines
//    `sales.words(text[])`, an IMMUTABLE wrapper, and the generated columns call
//    that. It is honest rather than a volatility lie: the wrapped call is
//    `array_to_string(text[], ' ')`, whose element output function is `textout`,
//    which genuinely is immutable.
//
// ── WHY `'simple'` AND NOT `'english'` ──────────────────────────────────────
// Stemming actively hurts this corpus. The highest-value queries are proper
// nouns — company names, people, product names — and `english` turns "Roches"
// into "roch" and drops one-letter tokens as stopwords. The data is Swiss and
// full of French names however English-only the UI is (§2). `simple` keeps the
// vector's contents predictable, which matters more here than usual because an
// AGENT constructs the queries: prefix matching (`to_tsquery('simple', 'x:*')`)
// covers the shipped/shipping case well enough, and it behaves the same for the
// agent as for the human reading the same page.
//
// Weights: `A` = identity (name, title, subject), `B` = body and everything
// else. Ranking only; both are matched.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})

/** `to_tsvector('simple', coalesce(<col>, ''))` at weight `w`. */
function weighted(w: 'A' | 'B', ...columns: string[]) {
  const parts = columns.map((c) => `coalesce(${c}, '')`).join(` || ' ' || `)
  return `setweight(to_tsvector('simple', ${parts}), '${w}')`
}

/** The same, for a `text[]` column — via the IMMUTABLE wrapper (see above). */
function weightedArray(w: 'A' | 'B', ...columns: string[]) {
  const parts = columns.map((c) => `coalesce(sales.words(${c}), '')`).join(` || ' ' || `)
  return `setweight(to_tsvector('simple', ${parts}), '${w}')`
}

// ===========================================================================
// prospects — the core object: company AND deal in one (D-5)
// ===========================================================================
//
// The mockup merges company and deal, and the stakeholder validated that shape.
// It is a simplification we are CHOOSING, not one that is obviously right: the
// mockup's own data already contains the multi-deal case (StaffUp carries both
// "Phase 1 shipped" and "Phase 2 in negotiation", handled with tags).
//
// **Designed for the split without doing it.** The deal fields live here, and
// every child table FKs to `prospect_id` ONLY. Adding `sales.deals` later means
// adding a nullable `deal_id` beside each `prospect_id` — additive, no rewrite,
// no data migration for rows that never split.

export const prospects = salesSchema.table(
  'prospects',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The workspace #number. `bc:sales:{ws}/prospect/{seq}`. */
    seq: integer('seq').notNull(),

    name: varchar('name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }),
    /** Free text, not a vocabulary — "SaaS · staffing", "Fiduciaire". */
    sector: varchar('sector', { length: 120 }),

    /** `lib/pipeline.ts` STAGES. Validated in the route, not by a CHECK — the
     *  vocabulary is served live by `bk meta` and a CHECK would need a migration
     *  every time a stage is added. */
    stage: varchar('stage', { length: 24 }).notNull().default('new_lead'),

    value: numeric('value', { precision: 14, scale: 2 }),
    currency: char('currency', { length: 3 }).default('CHF').notNull(),

    /**
     * OUR deal owner — a real person, accountable for the deal.
     *
     * Deliberately a user FK with NO label fallback, unlike the actor columns
     * elsewhere in this schema. An agent can LOG a call and WRITE history; it
     * cannot own a deal. If this ever needs to hold "Companion", that is a
     * product decision, not a schema convenience.
     */
    owner_user_id: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),

    /** "referral", "maps", "word of mouth". Free text — the mockup encodes this
     *  in tags today and the taxonomy is not settled. */
    source: varchar('source', { length: 60 }),

    /** BLOB-REF (scan). The last-contact summary — prose, agent-authored. */
    summary: text('summary'),

    // ── the mockup's `nextAction` ─────────────────────────────────────────
    // Four columns rather than a jsonb blob: `due` is filtered on ("actions due
    // today" is a KPI on the mockup's own dashboard) and a jsonb key cannot
    // carry a useful index for that.
    next_action_type: varchar('next_action_type', { length: 24 }),
    /**
     * A resolved DATE, and beside it the words the agent actually wrote.
     *
     * The mockup has "Today", "This week", "Thu 30 July, 10:00". §5.1 says a
     * relative string is a RENDERING and never storage, so the agent resolves a
     * fuzzy due to a concrete date on write — and the date is what sorts, what
     * filters, and what the Today page reads.
     *
     * But resolving "this week" to a guessed Friday and then DISCARDING the
     * phrase loses information nothing can recover: the difference between "due
     * Friday" and "sometime this week, Friday is my guess" is exactly the
     * difference a human needs when the follow-up is late. So the label is kept
     * verbatim, displayed in preference to the date where it exists, and never
     * parsed by anything.
     */
    next_action_due: date('next_action_due'),
    next_action_due_label: varchar('next_action_due_label', { length: 40 }),
    /** BLOB-REF (scan). */
    next_action_note: text('next_action_note'),
    /**
     * Who owes the next action — and this one CAN be the agent.
     *
     * Four of the mockup's seven prospects have `ownerId: 'companion'` here, so
     * a user FK alone cannot represent the data. The `_user_id` + `_label` pair
     * is the same shape used for `stage_entries.actor_*` and
     * `communications.logged_by_*`: the FK when a platform user did it, the
     * label always — so agent-written history stays visibly agent-written.
     */
    next_action_owner_user_id: integer('next_action_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    next_action_owner_label: varchar('next_action_owner_label', { length: 80 }),

    /** Set together when `stage` becomes `won` or `lost`. */
    closed_at: timestamp('closed_at', { withTimezone: true }),
    /** BLOB-REF (scan). Free text — "went with Pipedrive, revisit summer 2027". */
    closed_reason: text('closed_reason'),

    /**
     * Reserved for a future CRM / Google Workspace id. Empty in v1 by design:
     * Gmail / Drive / Calendar integration is an explicit non-goal (§2), and
     * this column is what lets it be ADDED later rather than migrated in.
     */
    external_ref: jsonb('external_ref'),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'name'),
          weighted('B', 'city', 'sector', 'source', 'summary', 'next_action_note', 'closed_reason'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_prospects_ws_seq').on(t.workspace_id, t.seq),
    wsStage: index('idx_prospects_ws_stage').on(t.workspace_id, t.stage),
    wsOwner: index('idx_prospects_ws_owner').on(t.workspace_id, t.owner_user_id),
    wsUpdated: index('idx_prospects_ws_updated').on(t.workspace_id, t.updated_at),
    wsDue: index('idx_prospects_ws_due').on(t.workspace_id, t.next_action_due),
    search: index('idx_prospects_search').using('gin', t.search),
  })
)

// ===========================================================================
// contacts — decision makers at a prospect
// ===========================================================================
// No `seq`: a contact is not independently addressable and has no URN. It is
// always reached through its prospect, so giving it a #number would advertise an
// identity `bk` cannot resolve.

export const contacts = salesSchema.table(
  'contacts',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 120 }).notNull(),
    /** "Co-founder · product", "Sponsor · SKS Innovation SA". */
    role: varchar('role', { length: 120 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 40 }),
    is_primary: boolean('is_primary').default(false).notNull(),
    /** BLOB-REF (scan). */
    notes: text('notes'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'name'), weighted('B', 'role', 'email', 'notes')].join(' || '))
    ),
  },
  (t) => ({
    prospectIdx: index('idx_contacts_prospect').on(t.prospect_id),
    wsIdx: index('idx_contacts_ws').on(t.workspace_id),
    search: index('idx_contacts_search').using('gin', t.search),
  })
)

// ===========================================================================
// stage_entries — the deal journey
// ===========================================================================
// One row per step of the ladder, INCLUDING the steps not taken yet: the mockup
// renders `upcoming` placeholders with no date, no actor and no note, which is
// why `occurred_at`, `actor_user_id` and `actor_label` are all nullable.
//
// The "by Andrea / by Companion" attribution is a validated feature, not
// decoration. `actor_label` is populated from the TOKEN's name when the write
// comes from a token and from the user's name otherwise, so agent-written
// history stays visibly agent-written.

export const stageEntries = salesSchema.table(
  'stage_entries',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    stage: varchar('stage', { length: 24 }).notNull(),
    /** `done | current | upcoming` — `lib/pipeline.ts` STAGE_ENTRY_STATUSES. */
    status: varchar('status', { length: 16 }).notNull().default('upcoming'),
    /** Null on an `upcoming` step, which has not happened yet. */
    occurred_at: timestamp('occurred_at', { withTimezone: true }),

    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_label: varchar('actor_label', { length: 80 }),
    /** BLOB-REF (scan). */
    note: text('note'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(weighted('B', 'note', 'actor_label'))
    ),
  },
  (t) => ({
    prospectIdx: index('idx_stage_entries_prospect').on(t.prospect_id, t.occurred_at),
    wsIdx: index('idx_stage_entries_ws').on(t.workspace_id),
    search: index('idx_stage_entries_search').using('gin', t.search),
  })
)

// ===========================================================================
// meetings — the ledger, NOT a calendar
// ===========================================================================
// Google Calendar owns scheduling; this is the per-prospect RECORD of meetings,
// extracted by the agent from voice debriefs, WhatsApp and email threads. A past
// meeting carries an `outcome`; an upcoming one carries an `agenda`. Both
// columns exist on every row because a cancelled meeting can have had both.

export const meetings = salesSchema.table(
  'meetings',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
    duration_min: integer('duration_min'),
    /** `video | call | in_person`. */
    type: varchar('type', { length: 16 }).notNull(),
    /** `upcoming | done | cancelled`. */
    status: varchar('status', { length: 16 }).notNull().default('upcoming'),
    /** BLOB-REF (scan). A label, and triggered anyway — see the header. */
    title: varchar('title', { length: 200 }).notNull(),
    /** Plain names, ours and theirs mixed — the mockup does not distinguish and
     *  neither does the record. Not FKs: half of these people are not users. */
    attendees: text('attendees').array(),
    /** BLOB-REF (scan). */
    agenda: text('agenda'),
    /** BLOB-REF (scan). */
    outcome: text('outcome'),
    /**
     * Where an online meeting happens — Teams, Meet, Zoom, Whereby, an internal
     * hostname. NULL for the phone calls and in-person meetings that are most of
     * this ledger, and it stays that way: a "Link: —" row on every past call is
     * noise, so the readers render it only when present.
     *
     * BLOB-REF (exact). Migration 0007 says why a conferencing link is
     * triggered: it is `documents.external_url`'s argument unchanged — nothing
     * stops somebody pasting an uploaded recording's blob url here, and `exact`
     * mode costs nothing on a real Teams link.
     *
     * `text`, deliberately. Conferencing links are long; the length bound is
     * MEETING_URL_MAX in `lib/limits.ts`, where a caller gets a 400 that names
     * it.
     */
    meeting_url: text('meeting_url'),

    external_ref: jsonb('external_ref'),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'title'),
          weighted('B', 'agenda', 'outcome'),
          weightedArray('B', 'attendees'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_meetings_ws_seq').on(t.workspace_id, t.seq),
    prospectIdx: index('idx_meetings_prospect').on(t.prospect_id, t.starts_at),
    wsStarts: index('idx_meetings_ws_starts').on(t.workspace_id, t.starts_at),
    search: index('idx_meetings_search').using('gin', t.search),
  })
)

// ===========================================================================
// communications — the multi-channel log
// ===========================================================================
// The mockup's channel for a Google-Maps prospecting sweep is `maps`. Stored as
// `discovery`: the RECORD is "we found them by looking", and naming the tool in
// the schema would need a migration the first time the tool changes. `note` is
// new and is D-13's consequence — sales has no `platform.comments`, so an
// internal note about a prospect is `bk sales comm log --channel note`.

export const communications = salesSchema.table(
  'communications',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    /** `email | whatsapp | call | note | discovery | system`. */
    channel: varchar('channel', { length: 16 }).notNull(),
    /** `out` = we → them, `in` = them → us. */
    direction: varchar('direction', { length: 3 }).notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** BLOB-REF (scan). */
    subject: varchar('subject', { length: 300 }),
    /** BLOB-REF (scan). */
    body: text('body'),

    /** Which decision maker, when the record names one. */
    contact_id: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Who logged it — the FK when a platform user did, the label always.
     *  "Companion · auto-logged", "Andrea · voice debrief". */
    logged_by_user_id: integer('logged_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    logged_by_label: varchar('logged_by_label', { length: 80 }),

    external_ref: jsonb('external_ref'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'subject'), weighted('B', 'body', 'logged_by_label')].join(' || '))
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_communications_ws_seq').on(t.workspace_id, t.seq),
    prospectIdx: index('idx_communications_prospect').on(t.prospect_id, t.occurred_at),
    wsOccurred: index('idx_communications_ws_occurred').on(t.workspace_id, t.occurred_at),
    wsChannel: index('idx_communications_ws_channel').on(t.workspace_id, t.channel),
    search: index('idx_communications_search').using('gin', t.search),
  })
)

// ===========================================================================
// objections — what they pushed back on, and our counter
// ===========================================================================
// The three-text-column shape is the mockup's and it is the point of the table:
// `spoken` is what they SAID, `real_fear` is what we think they MEAN, `counter`
// is what we say back. Collapsing them into one "notes" field would delete the
// only structured sales insight in the product.

export const objections = salesSchema.table(
  'objections',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    /** `pricing | complexity | existing_solution | timing | decision_pending`. */
    type: varchar('type', { length: 32 }).notNull(),
    /** The person at the prospect who raised it, by name. A plain string, not a
     *  `contact_id`: the mockup records a name, and requiring a contact row
     *  would make logging an objection from a call impossible until somebody had
     *  entered the person. Adding a nullable `contact_id` beside it is additive. */
    raised_by: varchar('raised_by', { length: 120 }),
    raised_at: timestamp('raised_at', { withTimezone: true }),
    /** `open | countered | resolved`. */
    status: varchar('status', { length: 16 }).notNull().default('open'),

    /** BLOB-REF (scan). What they actually said, in quotes. */
    spoken: text('spoken'),
    /** BLOB-REF (scan). What we think is really going on. */
    real_fear: text('real_fear'),
    /** BLOB-REF (scan). Our answer. */
    counter: text('counter'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [weighted('A', 'raised_by'), weighted('B', 'spoken', 'real_fear', 'counter')].join(' || ')
      )
    ),
  },
  (t) => ({
    prospectIdx: index('idx_objections_prospect').on(t.prospect_id),
    wsStatus: index('idx_objections_ws_status').on(t.workspace_id, t.status),
    search: index('idx_objections_search').using('gin', t.search),
  })
)

// ===========================================================================
// products — what we sell
// ===========================================================================

export const products = salesSchema.table(
  'products',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    /** `module | service | licence`. */
    category: varchar('category', { length: 16 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),

    /**
     * The price AS WRITTEN — "CHF 4'800 + CHF 190/mo", "on request", "from CHF
     * 12,000". The mockup has exactly one price field and it is prose, because
     * half the catalogue is not a single number.
     *
     * `price_from` / `price_to` are the machine-readable half where one exists,
     * for filtering and for the pipeline-value maths. Neither derives from the
     * other and `price_label` is what the UI shows.
     */
    price_label: varchar('price_label', { length: 120 }),
    price_from: numeric('price_from', { precision: 14, scale: 2 }),
    price_to: numeric('price_to', { precision: 14, scale: 2 }),
    /** §5.1: money is an amount AND a currency. §5's products table omitted
     *  this; a price with no currency is the bug that only shows up abroad. */
    currency: char('currency', { length: 3 }).default('CHF').notNull(),

    /** BLOB-REF (scan). */
    description: text('description'),
    /** Who it suits — "SMB < 20 employees", "construction trades". */
    fit: text('fit').array(),
    /** BLOB-REF (scan). The one-line pitch. */
    pitch: text('pitch'),
    /** "v1.3 · shipped internally". Prose, not a vocabulary — it is a note about
     *  the product's maturity, not a state machine. */
    status_label: varchar('status_label', { length: 80 }),
    /** Reference customers, by NAME rather than by `prospect_id`: the mockup
     *  cites names, and a reference can be a company we never had a deal row for. */
    refs: text('refs').array(),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'name'),
          weighted('B', 'description', 'pitch', 'price_label', 'status_label'),
          weightedArray('B', 'fit', 'refs'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_products_ws_seq').on(t.workspace_id, t.seq),
    wsCategory: index('idx_products_ws_category').on(t.workspace_id, t.category),
    search: index('idx_products_search').using('gin', t.search),
  })
)

// ===========================================================================
// templates — how we say it
// ===========================================================================

export const templates = salesSchema.table(
  'templates',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    /** `email | whatsapp | call` — a call template is a script, not a message. */
    channel: varchar('channel', { length: 16 }).notNull(),
    /** `intro | follow_up | objection | meeting | kickoff`. */
    category: varchar('category', { length: 24 }).notNull(),
    /** The pipeline stage this template is FOR. Nullable — some are stageless. */
    stage: varchar('stage', { length: 24 }),
    name: varchar('name', { length: 120 }).notNull(),
    /** BLOB-REF (scan). */
    subject: varchar('subject', { length: 300 }),
    /** BLOB-REF (scan). */
    body: text('body'),
    /**
     * The `{{placeholder}}` names, PARSED FROM `body` ON WRITE.
     *
     * Derived, and stored anyway, for one reason: `bk sales template render`
     * validates that every placeholder was supplied, and doing that by
     * re-parsing on every render puts the parser in two places. Parsed in one
     * helper on the write path; if this ever disagrees with `body`, the write
     * path is the bug.
     */
    variables: text('variables').array(),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'name', 'subject'), weighted('B', 'body')].join(' || '))
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_templates_ws_seq').on(t.workspace_id, t.seq),
    wsChannel: index('idx_templates_ws_channel').on(t.workspace_id, t.channel),
    wsStage: index('idx_templates_ws_stage').on(t.workspace_id, t.stage),
    search: index('idx_templates_search').using('gin', t.search),
  })
)

// ===========================================================================
// documents — ONE library (D-8)
// ===========================================================================
// A document is either an UPLOADED FILE — through `/api/upload` on the sales
// host, so it lands in `platform.uploads` with `app = 'sales'` and the
// `sales/{ws}/` path prefix — or an EXTERNAL LINK (a Drive folder, a Loom
// recording). The mockup has both and they are not two tables.
//
// The many-to-many tables below are what make the per-prospect Documents tab a
// FILTERED VIEW into one library rather than a silo.

export const documents = salesSchema.table(
  'documents',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    /** BLOB-REF (scan). A label, and triggered anyway — see the header. */
    title: varchar('title', { length: 200 }).notNull(),
    /** `pdf | deck | image | video | link`. */
    kind: varchar('kind', { length: 16 }).notNull(),

    /**
     * BLOB-REF (exact). The uploaded file's URL, from `platform.uploads`.
     *
     * No FK to `platform.uploads.url`: the same URL can legitimately be
     * referenced without a ledger row (an old upload, a URL pasted between
     * workspaces), and a reference must still count. `platform.blob_references`
     * makes the same choice for the same reason.
     */
    upload_url: text('upload_url'),
    /**
     * BLOB-REF (exact) — and this is the non-obvious one.
     *
     * The column is FOR external URLs, so most rows contribute nothing to the
     * index. But nothing stops a caller putting a blob URL here instead of in
     * `upload_url`, and the CHECK below then forbids the correct column. A file
     * referenced ONLY from an untriggered column is invisible to the delete
     * gate — which is the one failure that ends in lost bytes. `exact` mode
     * filters non-uploads out for free, so the cost of covering it is zero.
     */
    external_url: text('external_url'),

    size_bytes: integer('size_bytes'),
    mime_type: varchar('mime_type', { length: 120 }),
    /** BLOB-REF (scan). The mockup's `note` — prose about what the file is for. */
    description: text('description'),
    tags: text('tags').array(),

    /** Who added it — the FK when a platform user did, the label always.
     *  The mockup has "Companion · auto" and "Kali · field", neither of which is
     *  necessarily a platform user. Same pair as the other actor columns. */
    added_by_user_id: integer('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    added_by_label: varchar('added_by_label', { length: 80 }),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'title'),
          weighted('B', 'description', 'added_by_label'),
          weightedArray('B', 'tags'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_documents_ws_seq').on(t.workspace_id, t.seq),
    wsKind: index('idx_documents_ws_kind').on(t.workspace_id, t.kind),
    search: index('idx_documents_search').using('gin', t.search),
    // Exactly one of the two URL columns. Written in migration 0001 as
    //   CHECK ((upload_url IS NULL) <> (external_url IS NULL))
  })
)

// ===========================================================================
// matches — the triangulation result
// ===========================================================================
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ THIS TABLE IS WRITTEN BY THE AGENT. THE APP NEVER COMPUTES IT.       │
//   └──────────────────────────────────────────────────────────────────────┘
//
// A live recommendation engine is an explicit non-goal (§2). The agent decides
// which product fits which prospect, with which message and which attachments,
// and STORES the answer here. Building a matcher in the app would contradict the
// doctrine and double the surface — and the first person to add "recompute
// matches" to a route will not have read this far, which is why the sentence is
// at the top of the file rather than in a doc.

export const matches = salesSchema.table(
  'matches',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    /** 0–100. `smallint` because a percentage is not a measurement. */
    fit: smallint('fit'),
    /** The message to lead with, when the agent picked one. */
    template_id: integer('template_id').references(() => templates.id, { onDelete: 'set null' }),
    /** BLOB-REF (scan). The agent's reasoning, in prose — and the agent is the
     *  actor most likely to be holding an upload URL when it writes one. */
    why: text('why'),

    computed_at: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    computed_by_label: varchar('computed_by_label', { length: 80 }),

    search: tsvector('search').generatedAlwaysAs(sql.raw(weighted('B', 'why'))),
  },
  (t) => ({
    /** One verdict per (prospect, product) — so `bk sales match set` is an
     *  upsert rather than an append, and the table cannot silently accumulate
     *  three contradictory scores for the same pair. */
    uq: uniqueIndex('uq_matches_prospect_product').on(t.prospect_id, t.product_id),
    prospectIdx: index('idx_matches_prospect').on(t.prospect_id),
    wsIdx: index('idx_matches_ws').on(t.workspace_id),
    search: index('idx_matches_search').using('gin', t.search),
  })
)

// ===========================================================================
// The join tables
// ===========================================================================
// All four are pure links: a composite primary key, no surrogate id, cascade on
// both sides. Nothing about a link needs a #number, a soft delete or an actor.

/** The attachments a match recommends — the third corner of the triangle. */
export const matchDocuments = salesSchema.table(
  'match_documents',
  {
    match_id: integer('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.match_id, t.document_id] }),
    docIdx: index('idx_match_documents_document').on(t.document_id),
  })
)

/** Which deals a document has been sent to / attached on. */
export const documentProspects = salesSchema.table(
  'document_prospects',
  {
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.document_id, t.prospect_id] }),
    prospectIdx: index('idx_document_prospects_prospect').on(t.prospect_id),
  })
)

/** Which products a document is collateral for. */
export const documentProducts = salesSchema.table(
  'document_products',
  {
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.document_id, t.product_id] }),
    productIdx: index('idx_document_products_product').on(t.product_id),
  })
)

/** A template's default attachments — references INTO the one library, never a
 *  second copy of a file. */
export const templateDocuments = salesSchema.table(
  'template_documents',
  {
    template_id: integer('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.template_id, t.document_id] }),
    docIdx: index('idx_template_documents_document').on(t.document_id),
  })
)

/**
 * Prospect tags — `sales.labels` since Phase 3 (migration 0005, the thirteenth
 * foreign key).
 *
 * The mockup's tags ("Phase 1 shipped", "Active client", "Referral ·
 * Metaesthetics") are labels, so they reuse proven machinery — colours, attach,
 * detach, filtering, `bk sales label` — instead of a parallel tag system that
 * every future app then also builds.
 *
 * It used to point at `platform.labels`, and the scope that kept issues' labels
 * out of this app's picker was a predicate (`app IS NULL OR app = 'sales'`)
 * threaded through every read. **The scope is now the schema**: this FK cannot
 * reach a row belonging to another app, so there is no predicate to forget.
 */
export const prospectLabels = salesSchema.table(
  'prospect_labels',
  {
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => salesLabels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prospect_id, t.label_id] }),
    labelIdx: index('idx_prospect_labels_label').on(t.label_id),
  })
)

// ===========================================================================
// counters — the #number allocator
// ===========================================================================

/**
 * One row per (workspace, entity type). **Not** `platform.workspace_counters`:
 * that table no longer exists and must not be recreated
 * (`platform-architecture.md` §4.6). Sharing a counter buys nothing and costs a
 * shared write point plus a shared migration per entity type — and the version
 * the scaffold documents has FIXED columns (`last_issue_seq`, …), so a second
 * app would have to ALTER a platform table every time it added an entity.
 *
 * This shape is generic on purpose: adding `sales.quotes` later adds a ROW, not
 * a column.
 *
 * ── ALLOCATION, AND WHY TWO CONCURRENT CREATES CANNOT COLLIDE ───────────────
 * One statement, inside the same transaction as the insert it numbers:
 *
 *     INSERT INTO sales.counters (workspace_id, entity_type, last_seq)
 *     VALUES ($1, $2, 1)
 *     ON CONFLICT (workspace_id, entity_type)
 *       DO UPDATE SET last_seq = sales.counters.last_seq + 1
 *     RETURNING last_seq;
 *
 * `ON CONFLICT DO UPDATE` takes a ROW LOCK on the conflicting row and re-reads
 * it under that lock, so a second transaction doing the same thing BLOCKS until
 * the first commits or rolls back, then increments the committed value. Two
 * concurrent `prospect create` calls therefore get 12 and 13, never 12 twice.
 *
 * §5.1 says "`UPDATE … RETURNING`", and a bare UPDATE is not enough: the FIRST
 * allocation for a (workspace, type) pair has no row to update and returns zero
 * rows. Splitting it into "UPDATE, and INSERT if that returned nothing" is
 * exactly the read-then-write §5.1 forbids — two concurrent first-creates both
 * see zero rows and both insert. The upsert is one statement and has neither
 * problem.
 *
 * A rollback LOSES the number rather than reusing it, and that is correct:
 * #numbers are identity, not a count. Gaps are fine; a reused number is not.
 */
export const counters = salesSchema.table(
  'counters',
  {
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `prospect | meeting | communication | product | template | document` —
     *  the projected entity types, from `lib/entity-address.ts`. */
    entity_type: varchar('entity_type', { length: 32 }).notNull(),
    last_seq: integer('last_seq').default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspace_id, t.entity_type] }),
  })
)

// ===========================================================================
// user_preferences — the read-only / full affordance switch (D-7)
// ===========================================================================

/**
 * `ui_mode` is an AFFORDANCE SWITCH, not a permission.
 *
 * `read_only` means the web renders no mutation affordances at all. It does NOT
 * mean the API refuses writes — permissions are `platform.app_access`, and a
 * preference that looked like a permission would be a security control anybody
 * could turn off from their own settings page. Default `read_only`, because the
 * product's doctrine is that the agent writes and the human reads.
 */
export const userPreferences = salesSchema.table(
  'user_preferences',
  {
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `read_only | full`. */
    ui_mode: varchar('ui_mode', { length: 16 }).default('read_only').notNull(),
    /** Saved listing filters — stage, owner, sort. Opaque to the server. */
    default_filters: jsonb('default_filters'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.workspace_id] }),
  })
)

// ===========================================================================
// THIS APP'S OWN FOUNDATIONS — workspaces, membership, invitations, labels,
// uploads, activity
// ===========================================================================
//
// Added 2026-08-10 by the multi-app refactor's Phase 1
// (docs/2026-08-multi-app-refactor.md §5). **Nothing reads or writes them yet** —
// that is Phase 2 (bootstrap) and Phase 3 (the switch-over), deliberately, so
// that the phase which creates the shapes cannot break either app.
//
// ---------------------------------------------------------------------------
// WHY AN APP HAS ITS OWN WORKSPACES AT ALL
// ---------------------------------------------------------------------------
// The platform was built on the reading that the apps SHARE their data. The
// requirement was only ever that one account, one token and one CLI reach every
// app — the agent is the connector, not the database. So identity stays shared
// (`platform.users`, `api_tokens`, `email_whitelist`, `apps`) and everything
// else becomes app-local. A sales workspace and an issues workspace are two
// different things that happened to share a table.
//
// ---------------------------------------------------------------------------
// THE `workspace_id` COLUMN IS NOT NEGOTIABLE, EVEN THOUGH SALES HIDES IT
// ---------------------------------------------------------------------------
// Sales keeps workspaces UNDER THE HOOD: one per user, no switcher, no picker,
// no settings page, and a sales user never sees the word. That is a product
// decision about the UI. Reading it as a DATA decision and dropping the column
// would make "sales gets multiple workspaces" a migration over live rows
// instead of a screen nobody has drawn yet.
//
// ---------------------------------------------------------------------------
// THE TS NAMES ARE PREFIXED; THE POSTGRES NAMES ARE NOT
// ---------------------------------------------------------------------------
// `sales.workspaces` in Postgres, `salesWorkspaces` in TypeScript. The prefix
// is not decoration: this module does `export * from '@blackcode/platform-db/schema'`,
// so a local `export const workspaces` would SHADOW the platform table of the
// same name at every one of this app's ~80 existing import sites, silently, and
// the switch-over would happen by name resolution rather than by a diff anyone
// can read. Phase 3 flips call sites one table at a time and each flip has to be
// visible in the patch.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY ABSENT
// ---------------------------------------------------------------------------
// **No `sales.comments`.** D-13: this app has no platform comments and never
// had. Its equivalent is `communications` with `channel = 'note'`, above, which
// already exists. The refactor plan listed one from a file-count survey that
// counted the WORD; a grep for the table finds zero call sites.
//
// **No `sales.deletion_batches`.** This app's bin is `deleted_at` on the row
// plus a cascade that stamps one instant — `lib/db/queries/trash.ts` — and the
// trash route already answers `batch_id` as absent rather than inventing one.
// A batch table with no writer is a shape for somebody to later mistake for a
// feature.
//
// **No `app` column on any of these.** The platform copies carry one because
// they are shared and had to say whose row this is. In a table owned by one app
// the answer is the schema name. Carrying it over would be cargo-culting a
// workaround into the place that made it unnecessary.
//
// **No `sales.users`.** Identity is shared, and every `*_id` below is a
// cross-schema FK into `platform.users`. That FK is not a leak of the boundary
// this refactor draws — it is the boundary.

/**
 * `sales.workspaces` — this app's tenancy root.
 *
 * Dropped from the platform shape: `logo_url` (this app renders no workspace
 * chrome — there is no switcher to put a logo in), `storage_limit_bytes`
 * (nothing has ever enforced it, and a storage quota is a question about one
 * Blob store shared by every app, so it does not belong in a per-app table),
 * and `deleted_at` (no writer, in either app — `listMyWorkspaces` says so at
 * length. Carrying a column that has never been written forward into a new
 * table is how it acquires two different meanings in two apps).
 */
export const salesWorkspaces = salesSchema.table(
  'workspaces',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 40 }).notNull(),
    /**
     * ── `ON DELETE RESTRICT` HERE IS INERT, AND KEEPING IT IS A DECISION ──────
     *
     * It reads like "an account cannot be closed while it owns a sales
     * workspace". It has never meant that and cannot: closing an account is
     * `softDeleteUser`, an **UPDATE** setting `deleted_at`, and an UPDATE does
     * not fire a delete rule. So nothing refused, nothing cascaded, and until
     * 2026-08-11 the workspace survived — owned by an account that could no
     * longer authenticate by password or by Google and whose tokens had been
     * revoked. Data stranded rather than lost, and unrecoverable by the person.
     * (Measured in Phase 8; docs/2026-08-multi-app-refactor.md §9 item 8.)
     *
     * **What actually protects this data is `lib/db/queries/footprint.ts`**:
     * `DELETE /api/me?scope=all_apps` asks this app what it holds, purges it
     * through this app's own route, and asserts the app comes back empty BEFORE
     * it touches `platform.users`. An application-layer question, answered in
     * the application layer.
     *
     * The constraint stays because it is correct for the one case it can see —
     * a genuine hard `DELETE FROM platform.users` — and dropping it would swap
     * an inert guard for no guard. It must NOT be read as the thing that makes
     * account closure safe. Do not "fix" it by making `softDeleteUser` a hard
     * delete: RESTRICT would then REFUSE the closure outright, and the twelve
     * `ON DELETE CASCADE` FKs on `platform.workspaces` would take issues'
     * content with it.
     */
    owner_id: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Kept, unlike the three above, because it is READ: the workspace listing
    // orders by it.
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: uniqueIndex('uq_sales_workspaces_slug').on(t.slug),
    ownerIdx: index('idx_sales_workspaces_owner').on(t.owner_id),
  })
)

/** `sales.workspace_members` — who is in one, and whether they own it. */
export const salesWorkspaceMembers = salesSchema.table(
  'workspace_members',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => salesWorkspaces.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).default('member').notNull(),
    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('uq_sales_workspace_members_ws_user').on(t.workspace_id, t.user_id),
    userIdx: index('idx_sales_workspace_members_user').on(t.user_id),
    roleCheck: check('sales_workspace_members_role_check', sql`${t.role} IN ('owner', 'member')`),
  })
)

/**
 * `sales.invitations` — named the short way, and the table it replaces is
 * `platform.workspace_invitations`.
 *
 * The platform name says "workspace" because that table sits beside
 * `api_tokens` and `email_whitelist`, which invite you to nothing; here the
 * schema already says which app and there is only one kind of invitation.
 *
 * Dropped from the platform shape: `app`. That column exists to invite somebody
 * straight into ONE app inside a shared workspace, under the `workspace_apps` /
 * `app_access` gates — both of which Phase 5 drops, because gating an app
 * inside a workspace stops being a concept when apps do not share workspaces.
 * An invitation to a sales workspace is an invitation to sales.
 *
 * `status` keeps its CHECK, minus `'declined'`: nothing in either app has ever
 * written that value, and an accepted vocabulary is a promise that some code
 * path produces it. Phase 2 adds it back in the same change as the route that
 * writes it, if it needs it.
 */
export const salesInvitations = salesSchema.table(
  'invitations',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => salesWorkspaces.id, { onDelete: 'cascade' }),
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
  },
  (t) => ({
    tokenUniq: uniqueIndex('uq_sales_invitations_token').on(t.token),
    workspaceIdx: index('idx_sales_invitations_ws').on(t.workspace_id),
    emailIdx: index('idx_sales_invitations_email').on(t.email),
    statusCheck: check(
      'sales_invitations_status_check',
      sql`${t.status} IN ('pending', 'accepted', 'revoked', 'expired')`
    ),
  })
)

/**
 * `sales.labels`.
 *
 * Dropped from the platform shape: `app`, and with it the whole
 * `app IS NULL OR app = 'sales'` predicate that `lib/db/queries/labels.ts` used
 * to thread through every read and every write. That predicate is the D-14
 * workaround for one table serving two apps; in this table every row is this
 * app's, so the correct scope is the absence of a scope. Phase 3 DELETED
 * `visibleToThisApp()` rather than porting it — a scope helper left behind over
 * a table that cannot hold a foreign row reads as protection and is a no-op,
 * which is CLAUDE.md's whole subject.
 *
 * `workspace_id` is NOT NULL here where the platform column is nullable. That
 * nullability is a backfill artefact ("Phase 1: nullable during backfill") on a
 * table with live rows; a new table starts with the constraint the code has
 * always assumed.
 */
export const salesLabels = salesSchema.table(
  'labels',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => salesWorkspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    // The default is IMPORTED, not written here. D-4: every colour in this app
    // is decided in `lib/pipeline.ts`, and `lib/palette.test.ts` fails the build
    // on a hex literal anywhere else — it caught this line carrying the platform
    // table's `#6b7280`, which is issues' cool grey.
    color: varchar('color', { length: 7 }).default(DEFAULT_LABEL_COLOR),
    description: text('description'),
    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsIdx: index('idx_sales_labels_workspace').on(t.workspace_id),
    wsNameUniq: uniqueIndex('uq_sales_labels_ws_name').on(t.workspace_id, t.name),
  })
)

/**
 * `sales.uploads` — the LEDGER, not the storage.
 *
 * There is still one Vercel Blob store, one bill and one quota; what splits is
 * the record of which of this app's files exist. `platform.blob_references`
 * (the cross-app delete gate) is untouched by this and stays shared — it is the
 * one piece of cross-app machinery that earns its keep, and it is maintained by
 * Postgres triggers, not from here.
 *
 * `url` is NOT in the refactor plan's column list and it has to be: it is the
 * join key the whole ledger is addressed by, it is `NOT NULL` and UNIQUE in the
 * platform table, and `recordUpload` is idempotent BECAUSE of that uniqueness.
 * Without it a repeated blob callback writes a second row.
 *
 * Dropped from the platform shape: `app`. `workspace_id` stays nullable, unlike
 * `labels` above — that one is deliberate and load-bearing in the source table:
 * an upload whose workspace could not be determined is still RECORDED rather
 * than lost, and an unattributed ledger row is recoverable where a missing one
 * hides bytes nobody can find again.
 */
export const salesUploads = salesSchema.table(
  'uploads',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id').references(() => salesWorkspaces.id, {
      onDelete: 'cascade',
    }),
    url: text('url').notNull(),
    pathname: text('pathname'),
    filename: varchar('filename', { length: 255 }).notNull(),
    size: bigint('size', { mode: 'number' }),
    mime_type: varchar('mime_type', { length: 100 }),
    uploaded_by: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlUniq: uniqueIndex('uq_sales_uploads_url').on(t.url),
    workspaceIdx: index('idx_sales_uploads_workspace').on(t.workspace_id),
  })
)

/**
 * `sales.events` — the activity spine behind `bk sales activity`.
 *
 * Dropped from the platform shape: `app`.
 *
 * KEPT, and flagged for Phase 3 rather than decided here: `subject_urn`. It is
 * the cross-app address of what an event is about, and the refactor removes
 * this app's projection into `platform.entities`, which is where the URN is
 * resolved from today (`resolveSubjectUrn`). It is kept anyway because it is a
 * READ surface with a flag behind it — `?subject_urn=` on the activity route,
 * `bk activity --subject` — and the URN for a sales row is derivable from
 * `sales.*` alone; the shared index is how it is looked up, not what makes it
 * true. Whoever owns Phase 3 should confirm that and drop the column if not:
 * dropping an unused column from an empty table is free, and adding one back to
 * a populated one is not.
 *
 * `actor_token_id` references `platform.api_tokens` — a shared identity table,
 * like `users`. This app is the one that actually fills it ("by Andrea / by
 * Companion" attribution), so it is not speculative here.
 *
 * `idempotency_key` has no writer today: `recordEvent` accepts one and every
 * call site leaves it unset. It is carried anyway because the UNIQUE index on
 * it is what makes a retried agent command not double-log, and the cost of the
 * column is one nullable varchar against the cost of discovering you need it
 * after the table has rows.
 */
export const salesEvents = salesSchema.table(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => salesWorkspaces.id, { onDelete: 'cascade' }),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_token_id: integer('actor_token_id').references(() => apiTokens.id, {
      onDelete: 'set null',
    }),
    entity_type: varchar('entity_type', { length: 30 }).notNull(),
    entity_id: integer('entity_id').notNull(),
    // No FK, for the reason the platform table gives: events are append-only
    // history and must outlive a purge of their subject.
    subject_urn: text('subject_urn'),
    action: varchar('action', { length: 40 }).notNull(),
    diff: jsonb('diff'),
    meta: jsonb('meta'),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    idempotency_key: varchar('idempotency_key', { length: 80 }),
  },
  (t) => ({
    wsOccurredIdx: index('idx_sales_events_ws_occurred').on(t.workspace_id, t.occurred_at),
    wsSubjectIdx: index('idx_sales_events_ws_subject').on(
      t.workspace_id,
      t.subject_urn,
      t.occurred_at
    ),
    wsEntityIdx: index('idx_sales_events_ws_entity').on(
      t.workspace_id,
      t.entity_type,
      t.entity_id,
      t.occurred_at
    ),
    wsActorIdx: index('idx_sales_events_ws_actor').on(
      t.workspace_id,
      t.actor_user_id,
      t.occurred_at
    ),
    wsActionIdx: index('idx_sales_events_ws_action').on(t.workspace_id, t.action, t.occurred_at),
    idempUniq: uniqueIndex('uq_sales_events_idempotency').on(t.workspace_id, t.idempotency_key),
  })
)

/**
 * `sales.user_settings` — this app's memory of which workspace you were in.
 *
 * NOT `platform.users.active_workspace_id`, which holds an ISSUES workspace id.
 * The two apps' workspace tables have overlapping ids, so a sales id written
 * there points the issues app at a different workspace with the same number.
 * That is the collision that already forced the CLI to keep its active
 * workspace per app; the server needs the same separation. See migration 0006.
 *
 * `active_workspace_id` is nullable and ON DELETE SET NULL: a deleted workspace
 * must empty the pointer, never delete the person's settings row. A pointer at
 * a workspace the person has since been REMOVED from is not something a foreign
 * key can catch — `getDefaultForUser` re-checks membership on every read.
 */
export const salesUserSettings = salesSchema.table('user_settings', {
  user_id: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  active_workspace_id: integer('active_workspace_id').references(() => salesWorkspaces.id, {
    onDelete: 'set null',
  }),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ===========================================================================
// Row types
// ===========================================================================

export type SalesUserSettings = typeof salesUserSettings.$inferSelect
export type SalesWorkspace = typeof salesWorkspaces.$inferSelect
export type NewSalesWorkspace = typeof salesWorkspaces.$inferInsert
export type SalesWorkspaceMember = typeof salesWorkspaceMembers.$inferSelect
export type NewSalesWorkspaceMember = typeof salesWorkspaceMembers.$inferInsert
export type SalesInvitation = typeof salesInvitations.$inferSelect
export type NewSalesInvitation = typeof salesInvitations.$inferInsert
export type SalesLabel = typeof salesLabels.$inferSelect
export type NewSalesLabel = typeof salesLabels.$inferInsert
export type SalesUpload = typeof salesUploads.$inferSelect
export type NewSalesUpload = typeof salesUploads.$inferInsert
export type SalesEvent = typeof salesEvents.$inferSelect
export type NewSalesEvent = typeof salesEvents.$inferInsert

export type Prospect = typeof prospects.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type StageEntry = typeof stageEntries.$inferSelect
export type Meeting = typeof meetings.$inferSelect
export type Communication = typeof communications.$inferSelect
export type Objection = typeof objections.$inferSelect
export type Product = typeof products.$inferSelect
export type Template = typeof templates.$inferSelect
export type SalesDocument = typeof documents.$inferSelect
export type Match = typeof matches.$inferSelect
export type UserPreferences = typeof userPreferences.$inferSelect
