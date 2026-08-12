# b/sales — backend

**This app only.** Platform-wide conventions — the shared `apiHandler`, the
`platform.*` tables, the event spine, the blob index, per-app access — live in
the root [`docs/backend.md`](../../../docs/backend.md) and are not repeated here.
An app's docs never describe another app
(`docs/platform-architecture.md` §7.5).

Status: **Phases 2–9 landed 2026-08-07.** The schema, the migrations, the
blob-reference triggers, the URN projection, the reference scanner, the dev seed,
the whole `bk sales` command group, every route behind it, and the web surface.
What is left is the deployment: the app is **not deployed and its
`platform.apps` row is not enabled** until Phase 12.

---

## 1. What this app is

blackcode's own business-development pipeline, ported from the validated mockup
at `bsales-mockup/`. The doctrine, which the schema is shaped by:

> **The agent operates the funnel; the human supervises.** The web surface is
> read-mostly. Nothing here computes — matches, aggregates and next actions are
> *stored*, written by an agent through `bk sales`.

Two consequences that look like missing features and are not:

- **No matching engine.** `sales.matches` is written by the agent, never derived
  by the app. A live recommender contradicts the doctrine and doubles the
  surface (`docs/sales-app-plan.md` §2).
- **The app never sends anything.** It records that a message was sent. There is
  no Gmail, Drive or Calendar integration, and no "connect an account" flow. The
  `external_ref` columns exist so that can be added later without a migration of
  meaning.

**But the doctrine forbids the app DECIDING things, not the app READING things,**
and the line matters because the mockup blurs it. What must stay agent-computed is
**triangulation** — client × product × message. That is judgement: which product
suits this client, which message to lead with. `sales.matches` keeps it stored,
exactly as the mockup insists.

`SUM(value) GROUP BY stage` is not judgement. It is arithmetic over rows this app
already holds, the same class of thing as counting how many prospects are in a
stage — which nobody would propose storing. **So dashboard aggregates are computed
by query and there is no aggregates table.** Storing them would create a second
number that can disagree with the first (D-6's argument), and a stale pipeline
total is worse than a slow one at a scale where nothing is slow. The mockup stores
them because a static HTML file has no other option; that is a constraint of the
artefact, not a design position.

## 2. Data protection — the owner is **Andrea**, as company director

A CRM holds names, emails, phone numbers and free-text notes about **people at
other companies**. That is a different category of data from an issue tracker and
it arrives with this app. Three positions, all settled (D-19):

| | Position | Where it lives |
|---|---|---|
| 1 | **Retention: 90 days.** A deleted prospect and its children sit in trash for 90 days, then purge automatically. The purge reports WHAT it destroyed — type, #number and name, captured before the delete — to `platform.events` | Phase 3 (the schedule) and Phase 5 (`bk sales trash`) |
| 2 | **Request-derived context is withheld from error rows.** `lib/api.ts` sets `redactBody: true` | `lib/api.ts`, and `packages/platform-api/src/handler.ts` at `errorLogContext` |
| 3 | **Owner: Andrea** | here |

**Read the ceiling on item 2 before quoting it.** `redactBody` omits
`ApiError.details` from `platform.error_events.context` and writes a
`{ redacted: 'body' }` marker so "withheld" and "there was none" are
distinguishable. It does **not** redact `message` or `stack`, and a Postgres
driver will put a rejected value straight into an error message
(`Key (email)=(…) already exists`). Redacting those was considered and rejected:
an error row nobody can triage is not a privacy win. **The honest control on
message and stack is retention** — item 1's horizon covers sales error rows too.
"No prospect data can ever appear in an error row" is not a claim this app makes.

## 3. The domain model

Postgres schema `sales`. Declared in `lib/db/schema.ts`, which carries the
reasoning inline; this section records only what a reader needs before opening
it, plus every place the implementation departs from the plan's §5.

### 3.1 The tables

```
prospects          the core object — company AND deal in one (D-5)
contacts           decision makers at a prospect
stage_entries      the deal journey — one row per stage, including the ones not reached
meetings           the meetings LEDGER (not a calendar)
communications     the multi-channel log
objections         what they pushed back on, what they really fear, our counter
products           what we sell
templates          how we say it
documents          the one shared library (D-8)
matches            triangulation: prospect × product (+ template) — AGENT-WRITTEN
match_documents    ⟩
document_prospects ⟩ pure links: composite PK, no surrogate id, cascade both ways
document_products  ⟩
template_documents ⟩
prospect_labels    into sales.labels (migration 0005 — the 13th foreign key)
counters           (workspace_id, entity_type, last_seq) — the #number allocator
user_preferences   ui_mode, saved filters
```

**Six more exist and NOTHING READS THEM YET** (migration `0003`, 2026-08-10):

```
workspaces         id, slug, name, owner_id, created_at, updated_at
workspace_members  workspace_id, user_id, role, joined_at
invitations        workspace_id, email, invited_by, role, token, status, expires_at, …
labels             workspace_id, name, color, description, created_by
uploads            workspace_id, url, pathname, filename, size, mime_type, uploaded_by
events             workspace_id, actor_user_id, actor_token_id, entity_type, entity_id, action, …
```

They are the multi-app refactor's Phase 1 (`docs/2026-08-multi-app-refactor.md`):
this app stops borrowing the platform's workspaces, membership, labels, upload
ledger and activity, and keeps only **identity** shared. Phase 2 points sign-up
and first sign-in at them; Phase 3 moves the query layer over one table at a
time. Until then every one of them is empty and this app behaves exactly as
before — that ordering is why Phase 1 cannot break anything.

Three things about them worth knowing before touching one:

- **The TypeScript names are prefixed (`salesWorkspaces`), the Postgres names
  are not.** `lib/db/schema.ts` re-exports the whole platform schema, so a local
  `export const workspaces` would silently shadow `platform.workspaces` at every
  existing import site. The switch-over has to be visible in a diff.
- **They are not copies.** Every column that existed only because the platform
  table was shared is gone: `app` everywhere, and with it the
  `app IS NULL OR app = 'sales'` predicate `lib/db/queries/labels.ts` threads
  through every read. So is anything with no writer (`workspaces.deleted_at`).
- **There is no `comments` and no `deletion_batches`.** D-13: this app has no
  platform comments, and `communications` with `channel = 'note'` is the
  equivalent. Its bin is `deleted_at` plus a cascade stamping one instant
  (§7.1.1), and the trash route answers `batch_id` as *absent* by design.

### 3.2 A prospect *is* the deal (D-5), and the split is pre-paid

The mockup merges company and deal and the stakeholder validated that shape. It
is a simplification we are **choosing**: the mockup's own data already contains
the multi-deal case (StaffUp carries both "Phase 1 shipped" and "Phase 2 in
negotiation", handled with tags).

So it is designed for the split without doing it. The deal fields live on
`prospects`, and **every child table FKs to `prospect_id` only**. Adding
`sales.deals` later means adding a nullable `deal_id` beside each `prospect_id` —
additive, no rewrite, and no data migration for rows that never split. Do not add
a child table that FKs to anything else.

### 3.3 #numbers, and why concurrent creates cannot collide

Every addressable row carries a workspace-scoped `seq`. **The serial `id` is
never exposed** — not in a route, not in CLI output, not in a URL.

`sales.counters` is `(workspace_id, entity_type, last_seq)` — generic, so adding
an entity adds a ROW, not a column. It is **not** `platform.workspace_counters`,
which no longer exists and must not be recreated (`platform-architecture.md`
§4.6).

Allocation is one statement, inside the same transaction as the insert:

```sql
INSERT INTO sales.counters (workspace_id, entity_type, last_seq)
VALUES ($1, $2, 1)
ON CONFLICT (workspace_id, entity_type)
  DO UPDATE SET last_seq = sales.counters.last_seq + 1
RETURNING last_seq;
```

`ON CONFLICT DO UPDATE` takes a row lock and re-reads under it, so a concurrent
transaction blocks until the first commits and then increments the committed
value. Two simultaneous `prospect create` calls get 12 and 13, never 12 twice.

A plain `UPDATE … RETURNING` is **not** sufficient, and the difference is the
whole point: the first allocation for a (workspace, type) pair has no row to
update and returns zero rows. Recovering with "UPDATE, and INSERT if that
returned nothing" is exactly the read-then-write §5.1 forbids — two concurrent
first-creates both see zero rows and both insert.

A rollback loses the number rather than reusing it. That is correct: #numbers are
identity, not a count. Gaps are fine; a reused number is not.

### 3.4 Actor attribution — the `_user_id` + `_label` pair

The mockup's "by Andrea / by Companion" attribution is a validated feature.
Companion is an **agent**, not a platform user, so four places carry a FK *and* a
label: the FK when a platform user did it, the label always.

| Table | Columns |
|---|---|
| `stage_entries` | `actor_user_id`, `actor_label` |
| `communications` | `logged_by_user_id`, `logged_by_label` |
| `prospects` | `next_action_owner_user_id`, `next_action_owner_label` |
| `documents` | `added_by_user_id`, `added_by_label` |

Populate `_label` from the **token's** name when the write comes from a token and
from the user's name otherwise, so agent-written history stays visibly
agent-written.

**`prospects.owner_user_id` is deliberately NOT in that list.** It is a user FK
with no label fallback: an agent can log a call and write history; it cannot own
a deal. If that ever needs to hold "Companion", it is a product decision, not a
schema convenience.

### 3.5 Search (D-9), and two Postgres facts that were verified rather than recalled

`bk sales search` is now this app's ONLY search, and the comparison that shaped
it is history worth keeping: the bare `bk search` read `platform.entities`, which
holds titles only, and it was unmounted here in Phase 3 and removed as a bare verb
in Phase 4. `bk sales search` reaches **inside** records, so every searchable
table carries a generated `tsvector` column with a GIN index, unioned by one
query helper.

Two things constrain how those columns are written, both checked against
PostgreSQL 16 rather than assumed:

1. **`to_tsvector(x)` — one argument — is STABLE** and Postgres rejects it in a
   generated column; `to_tsvector('simple', x)` is IMMUTABLE. The same function
   name carries both volatilities in `pg_proc`.
2. **`array_to_string` is STABLE, and so is `arr::text`** — both route through
   element output functions — so a `text[]` cannot be inlined. `CREATE TABLE`
   fails with *"generation expression is not immutable"*. Migration 0001 defines
   `sales.words(text[])`, an IMMUTABLE wrapper, and the generated columns call
   that. It is not a volatility lie: the wrapped call's element output function
   is `textout`, which genuinely is immutable.

**Configuration: `'simple'`, not `'english'`.** Stemming hurts this corpus — the
highest-value queries are proper nouns (companies, people, products), `english`
turns "Roches" into "roch", and the data is full of French names however
English-only the UI is. `simple` also keeps the vector predictable, which matters
more than usual here because an **agent** builds the queries. Prefix matching
(`to_tsquery('simple', 'x:*')`) covers the shipped/shipping case.

Weights: `A` = identity (name, title, subject), `B` = body and everything else.
Ranking only — both are matched.

### 3.6 Blob-reference triggers — the highest-risk step

Every column below needs a `platform.blob_refs_sync` trigger in migration 0002,
and **a content column added later needs its trigger in the same migration.** The
index is trigger-maintained so that no *write path* can forget it, which
concentrates the entire remaining risk here. Nothing will remind you: an app with
no scanner has nothing for `bk super-admin blob-drift` to compare against.

The rule for deciding: **a column needs a trigger if a legitimate write can put
an uploaded-file URL in it** — authored prose (`scan`) or a column that IS a URL
(`exact`). The asymmetry settles the borderline cases. A trigger on a column that
never holds a URL costs one no-op call per write; a missing trigger costs a file
somebody was still using, with no undo.

| Table | Columns | Mode |
|---|---|---|
| `prospects` | `summary`, `next_action_note`, `closed_reason` | scan |
| `contacts` | `notes` | scan |
| `stage_entries` | `note` | scan |
| `meetings` | `title`, `agenda`, `outcome` | scan |
| `meetings` | `meeting_url` | **exact** |
| `communications` | `subject`, `body` | scan |
| `objections` | `spoken`, `real_fear`, `counter` | scan |
| `products` | `description`, `pitch` | scan |
| `templates` | `subject`, `body` | scan |
| `documents` | `upload_url`, `external_url` | **exact** |
| `documents` | `title`, `description` | scan |
| `matches` | `why` | scan |

**Twenty-three columns across ten tables.** §5.4 of the plan lists thirteen while
its own prose says fourteen; the rule above produces twenty-three, and the count
is a consequence rather than a target. It was twenty-two until migration 0007
added `meetings.meeting_url` (2026-08-12).

Four of the twenty-two are length-capped **labels** — `meetings.title`,
`communications.subject`, `templates.subject`, `documents.title` — and they are
included deliberately. "A title is a label, not a body" is a line one can state,
and it is still a line about how people are expected to behave: a URL fits in 200
characters, and `documents.title` is exactly the field somebody pastes a link
into instead of filling in the form properly.

`documents.external_url` is the non-obvious one and the reason to state the rule
rather than a list. The column is *for* external URLs, so most rows contribute
nothing — but nothing stops a caller putting a blob URL there, and the CHECK
(exactly one of the two URL columns) then forbids the correct one. A file
referenced only from an untriggered column is invisible to the delete gate.
`exact` mode filters non-uploads out for free, so covering it costs nothing.

`meetings.meeting_url` is the SECOND application of that argument, and it is
worth reading as a worked example rather than a list entry. The column holds a
Teams/Meet/Zoom join link, so the instinct is that it is exempt — and the
asymmetry says otherwise: somebody uploads a recording or a dial-in card with
`bk sales upload` and pastes its blob URL into the field the screen labels
"Meeting link", because that is what the field is called. A wrongly-included
column costs one no-op recogniser call per row; a wrongly-excluded one costs a
file somebody is still using, with no undo. Both directions were measured on
2026-08-12 against a real database: a Teams URL produces **no** index row, a
`*.public.blob.vercel-storage.com` URL produces one, and clearing the column
removes it.

**A table can hold only one trigger of a given name**, so `meetings` carries
`trg_blob_refs` (scan) and `trg_blob_refs_url` (exact) — the same pairing
`documents` uses, for the same reason.

**Every triggered table also carries `workspace_id`, even when its parent has
one.** `platform.blob_references.workspace_id` is copied from the source row by
the trigger, and the Storage page, `bk issues storage list` and `bk super-admin
blob-drift` all work one workspace at a time. `apps/issues` shipped
`attachments.workspace_id` NULL on every row and had to repair 24 invisible
references inside migration 0037 — a clean report over a hole.

**The ordering in migration 0002 is the one irreversible thing in this project:**
triggers, then the backfill (by re-triggering, `SET col = col`), then
`maintains_blob_index = true`. Setting the flag first advertises an empty index
as authoritative, which is how a file still in use gets deleted. And the
`platform.apps` row goes in with `enabled = false`: registering an app that
cannot answer for its references stops blob deletion **platform-wide** — which is
the gate working, not a bug.

### 3.7 Where the implementation departs from `docs/sales-app-plan.md` §5

Each is a departure from the plan's *summary*, made because
`bsales-mockup/assets/js/data.js` — the older and more specific source — says
otherwise, or because a stated convention required it.

| # | Departure | Why |
|---|---|---|
| 1 | `workspace_id NOT NULL` on `contacts`, `stage_entries`, `objections`, `matches` | The blob trigger copies it into the index; without it those references are invisible to every workspace-scoped read. Issues' 0037 had to repair exactly this |
| 2 | `prospects.next_action_owner_label` added | Four of the mockup's seven prospects have `ownerId: 'companion'`. A user FK alone cannot represent the data |
| 3 | `documents.added_by_label` added | The mockup's `by` is "Companion · auto" and "Kali · field", neither necessarily a platform user |
| 4 | `products.currency` added | §5.1 says money is an amount AND a currency; §5's products table gave `price_from`/`price_to` without one |
| 5 | `stage_entries.occurred_at`, `actor_*` nullable | `upcoming` journey steps have no date, actor or note — the mockup renders the whole ladder |
| 6 | `objections.raised_at` nullable | Same shape; the mockup's value is a relative string that may not resolve |
| 7 | `matches` unique on `(prospect_id, product_id)` | Makes `bk sales match set` an upsert, so the table cannot accumulate three contradictory scores for one pair |
| 8 | `prospects.next_action_due` (`date`) **plus** `next_action_due_label varchar(40)` | §5.1: relative strings are a rendering, never storage — so the agent resolves "this week" to a concrete date, and the date is what sorts and filters. The label keeps the phrase verbatim, because resolving to a guessed Friday and discarding the words loses the difference between "due Friday" and "sometime this week, Friday is my guess". Displayed in preference to the date; never parsed |
| 9 | Nine more blob-trigger columns (§3.6) | Stated rule rather than an enumerated list |
| 12 | `demo_prep` added to `NEXT_ACTIONS` | It is in the mockup's Today queue. "Prepare the demo" and "do the demo" fall to different people on different days, and §5.5's list left the queue with a purpose that had no storable value behind it |
| 10 | `communications.channel` = `discovery`, not the mockup's `maps` | The record is "we found them by looking"; naming the tool in the schema needs a migration the first time the tool changes |
| 11 | Vocabularies for stage-entry status, comm direction and document kind live in `lib/pipeline.ts` | §5.5 lists eight; these three are equally vocabulary and equally belong in `bk meta` |

Not a departure, recorded because it looks like one: `objections.raised_by` stays
a plain name rather than a `contact_id`. The mockup records a name, and requiring
a contact row would make logging an objection from a call impossible until
somebody had entered the person. A nullable `contact_id` beside it is additive.

## 4. Vocabularies and limits

- **`lib/pipeline.ts`** is this app's `work-items.ts`. Stage, channel, objection,
  meeting, product, template, document and next-action vocabularies **and their
  colours** are canonical there and nowhere else. Served live under
  `apps.sales.vocabulary` by `GET /api/meta`.
- **`lib/limits.ts`** declares this app's caps and re-exports the platform half
  from `@blackcode/platform-api`. A limit is declared once, imported by the route
  that enforces it, served by `/api/meta`.
- **Neither is ever restated in a guide topic.** They are dynamic values: they
  change without a CLI release, so a topic says *"run `bk meta`"*.
  `cli/internal/guide/guide_test.go` fails the build on a hardcoded one.

## 5. Visual identity (D-4)

Tokens in `app/globals.css`, and **never a hardcoded colour in a component**.

| | issues | sales |
|---|---|---|
| Primary | `#007bd3` | **`#10a37f`** |
| Neutrals | cool blue-grey, OKLCH hue 264 | **warm, hue 85, chroma ≤ 0.008** |
| Radius | `0.5rem` | **`0.75rem`** |
| Density | `h-11` header, tight rows | **`h-12` header, `py-3` rows** |
| Charts | brand-blue lead | emerald → teal → amber → violet → rose |

**The neutrals are the load-bearing half.** A brand hue is one accent on a page;
the neutral hue is every surface, border and muted label on it. Changing only
`--primary` produces the issues app in a different colour, which is the outcome
D-4 exists to prevent.

`transpilePackages` in `next.config.js` and `@source` in `app/globals.css` are a
**pair** — the first makes `@blackcode/platform-ui` compile, the second makes its
CSS exist, and only the first fails loudly (D-30).

**React is pinned to 18.3.1, and that is a decision rather than an accident.**
`apps/_scaffold` declares `react: ^19.2.0` and npm installs 19.2.8 into it, but
`@blackcode/platform-ui` declares `peerDependencies: react ^18` and `apps/issues`
runs 18.3.1. So an app that copies the scaffold *and* uses the shared UI package —
which is every real app — inherits a peer conflict `docs/adding-an-app.md` does
not mention. Sales follows the package and the app that already ships. Revisit
when `platform-ui` widens its peer range, not before.

The four `--chart-series-*` tokens are defined so the shared chart kit *works*,
not as a commitment to use it. D-12 was narrowed on 2026-08-06: if sales' metrics
page needs something the kit does not do, it builds its own in
`apps/sales/components/`, with no shared change and nobody's permission.

## 6. The database, in practice

### 6.1 Migrations, and the ledger this app does NOT share

```
0001_sales_init.sql              schema, sales.words(), 17 tables, tsvector + GIN
0002_blob_reference_index.sql    11 triggers over 22 columns, grants, backfill, flag
0003_sales_own_foundations.sql   6 tables: workspaces, members, invitations,
                                 labels, uploads, events. Additive; no reader
0004_sales_owns_its_workspaces.sql  mirrors the platform.workspaces rows this
                                 app uses into sales.workspaces PRESERVING THE
                                 ID, copies the memberships, advances the
                                 sequence past platform's high-water mark, and
                                 swaps 12 foreign keys onto sales.workspaces.
                                 Deletes nothing
```

All three are hand-written. `drizzle-kit generate` cannot express a schema that must
exist before its own helper function, a `GENERATED … STORED` tsvector, or the
`documents_one_location` CHECK — the same reasons issues' 0037 and 0041–0043 are
hand-written.

**`apps/sales/drizzle.config.ts` sets `migrations.table` to
`__drizzle_migrations_sales`, and that is not a preference.** Every app on this
platform shares one database. Drizzle's migrator takes a single high-water mark
over the whole ledger —

```
select … order by created_at desc limit 1
if (!last || Number(last.created_at) < m.folderMillis) apply(m)
```

— with no notion of which app wrote a row. Two apps on one ledger means whichever
migrated last raises the mark for both, and the other app's next migration is
**silently skipped**: exit 0, no row inserted, tables that never appear, and the
same comparison skips it again forever. Reproduced on 2026-08-07 with two
throwaway migration folders against one ledger; the earlier-stamped one reported
success and created nothing.

### 6.2 Rollback

`docs/sql/sales-0003-rollback.sql`, then `sales-0002-rollback.sql`, then
`sales-0001-rollback.sql`, in that order — and 0001's script refuses if you get
it wrong.

0003's is independent of the other two: it drops only its own six tables
(`RESTRICT`, not `CASCADE`, and it does not drop the schema), so running it
leaves 0001's seventeen tables and 0002's triggers intact. **It is a no-op on
data only until Phase 2**, which puts the sole copy of "who may use this app"
into `sales.workspaces`; the file carries the count query that tells you which
of those two worlds you are in. Verified 2026-08-10: run against the six tables
it left 17 sales tables standing and 0 of its own.

Both were rehearsed on 2026-08-07 and **the first rehearsal found a real bug in
the guard**: `psql -f` autocommits each statement, so the `RAISE EXCEPTION`
printed in capitals and psql carried straight on and dropped the schema anyway,
exiting 0. That is CLAUDE.md finding #7's shape, reproduced by a script written
to avoid it. Both scripts now open with `\set ON_ERROR_STOP on` and run inside
`BEGIN`/`COMMIT`.

### 6.3 Provisioning — the three human steps

| | File |
|---|---|
| The `sales_app` role and its grants | `docs/sql/sales-app-role.sql` |
| The `platform.apps` row, in two parts around the migrations | `docs/sql/sales-app-register.sql` |
| The boundary probe, run **as `sales_app`** | `docs/sql/app-boundary-probe.sql` |

The probe was rehearsed locally against real roles on 2026-08-07, and **its check
(2) ran for real for the first time**: with `sales` in the registry it now finds
`issues.issues` and is refused with 42501, where it had reported `SKIPPED` since
it was written. It also surfaced a gap the checklist does not mention — see
`sales-app-role.sql` step 5c: issues' 0038 revoked `EXECUTE` on
`platform.blob_refs_purge` from PUBLIC and granted it only to the app roles that
existed then, so a new app role gets none and `blob-drift --repair` cannot clear
an orphaned reference. Migration 0002 re-runs that grant for every app role.

### 6.4 Seed

`SALES_SEED=1 npm run db:seed --workspace=sales` — the mockup's seven companies
and their history, behind **two** gates (`NODE_ENV !== 'production'` **and**
`SALES_SEED=1`), idempotent per workspace. It seeds no uploads (every document is
an `external_url`, so it cannot put a row in `platform.blob_references` for a
file nobody can fetch) and no `platform.entities` or `platform.events` — those
belong to the real write paths, and a second implementation of the projection is
a second thing that can disagree.

## 7. The HTTP surface

Under `app/api/**`. Private plumbing, **no OpenAPI spec, ever** — the CLI is the
only supported interface. Conventions are the platform's and are not repeated
here (`docs/backend.md` at the root, and the annotated scaffold route at
`apps/_scaffold/app/api/workspaces/[ws]/notes/route.ts`). What this section
records is what is specific to this app.

### 7.1 The surface

| Route | Command |
|---|---|
| `GET \| POST …/prospects` | `bk sales prospect list \| create` |
| `GET \| PATCH \| DELETE …/prospects/{n}` | `prospect show \| edit \| assign \| delete` |
| `POST …/prospects/{n}/stage` | `prospect stage` |
| `PATCH …/prospects/{n}/next-action` | `prospect next` |
| `GET \| POST …/prospects/{n}/contacts` | `contact list \| add` |
| `PATCH \| DELETE …/prospects/{n}/contacts/{cid}` | `contact edit \| rm` |
| `GET \| POST …/prospects/{n}/journey` | `journey list \| add` |
| `GET \| POST …/prospects/{n}/objections` | `objection list \| raise` |
| `PATCH \| DELETE …/prospects/{n}/objections/{oid}` | `objection counter \| resolve \| rm` |
| `GET \| POST \| DELETE …/prospects/{n}/matches` | `match list \| set \| clear` |
| `GET \| POST …/prospects/{n}/labels`, `DELETE …/{lid}` | `label attach \| detach` |
| `GET \| POST …/meetings`, `GET \| PATCH \| DELETE …/meetings/{n}` | `meeting …` (incl. `edit`, 2026-08-12) |
| `GET \| POST …/communications`, `GET \| DELETE …/communications/{n}` | `comm …` |
| `GET \| POST …/products`, `GET \| PATCH \| DELETE …/products/{n}` | `product …` |
| `GET \| POST …/templates`, `GET \| PATCH \| DELETE …/templates/{n}` | `template …` |
| `POST …/templates/{n}/render` | `template render` |
| `GET \| POST …/documents`, `GET \| PATCH \| DELETE …/documents/{n}` | `doc …` |
| `POST \| DELETE …/documents/{n}/links` | `doc link \| unlink` |
| `GET \| POST …/labels`, `GET \| PATCH \| DELETE …/labels/{id}` | `label …` |
| `GET …/trash`, `POST …/trash/restore`, `DELETE …/trash/purge`, `POST …/trash/empty` | `trash …` |
| `GET …/today`, `…/pipeline`, `…/metrics`, `…/sales-search` | `today`, `pipeline`, `metrics`, `search` |
| `GET /api/meta` | `bk meta` (Class C, D-20) |
| `GET \| POST /api/upload`, `POST /api/upload/blob` | `bk sales upload` |
| `GET \| PATCH …/preferences` | `bk sales preferences show \| set` |

**Six of those are platform route factories**, mounted from
`@blackcode/platform-api/routes`: `/api/upload`, `/api/upload/blob`, and — since
Phase 7 — `GET|PATCH /api/me`, `GET|POST /api/tokens`, `DELETE /api/tokens/{id}`,
`GET …/activity` and `POST /api/cli/authorize`. Why each, and the two that are
deliberately NOT mounted (`DELETE /api/me`, `/api/me/password/*`), is a table in
[`frontend.md` §10](./frontend.md) rather than repeated here — the decisions are
about what the WEB surface offers. `/api/meta` is
**Class C** and is this app's own route by design (D-20): it exists to say what
this app's vocabulary is, and §7.4 of `platform-architecture.md` forbids merging
two apps' vocabularies into one list.

**Everything else the platform commands claim is deliberately NOT mounted**, and
that is a permanent state rather than a gap. `bk <app> inbox` is per-user and
cross-workspace and this app raises no notifications; `bk super-admin errors`
reads platform-wide data and one host answers it. `bk <app> storage list` used to
be excluded on D-28's grounds ("the same rows from any deployment") — that reason
expired in Phase 3, when the upload ledger became per app, and the current reason
is simply that this app mounts no `/storage` route. Since 2026-08-07 the
parity guard derives each app's drift scope from the platform routes it actually
serves, so there is nothing to declare — and the repo-wide half
(`packages/platform-testing/test/platform-route-coverage.test.ts`) asserts that
every platform command is answerable by *someone*.

### 7.1.1 `trash` and `label` are this app's routes, not shared factories

There is no `trashRoute` in `platform-api` and there should not be. A recycle bin
lists ONE app's entities: the query is over `sales.*`, the types are this app's
vocabulary, and a restore has to invert this app's cascade. Nothing about it
generalises except the URL — and two deployments serving the same path over their
own tables is exactly what D-11's app-owned tier means.

Labels are the same shape for a different reason: the TABLE is
`platform.labels`, but `attach`/`detach` name an entity, and an entity belongs to
one app. `internal/appverbs` makes the identical split on the CLI side.

**The binnable types are declared twice** — `lib/db/queries/trash.ts` and
`cli/internal/commands/sales/appverbs.go` — because the CLI validates a
`--type` before any HTTP call and ships as an offline binary. `lib/trash-types.test.ts`
holds the two together, in order, and asserts `contact` is in neither: a contact
has no #number, so `contact:12` is not a ref anybody could type.

### 7.2 The four files a write path goes through

```
lib/http-input.ts          coercion + the vocabulary checks, shared by every route
lib/actor.ts               who did this, and the label to write beside the FK
lib/db/queries/events.ts   this app's recordEvent — `sales.events`, every type
lib/views.ts               the public shape: `number` not `id`, and no rendering
```

`lib/db/queries/events.ts` is the one that did not exist before Phase 5 and is
easy to assume away. It writes `sales.events` — **every entity type, including
the four platform ones**. Until 2026-08-10 it delegated `workspace`,
`workspace_member`, `workspace_app` and `invitation` to `recordPlatformEvent`
(D-23), because those were events about PLATFORM subjects; they are this app's
own rows in this app's own schema now, and their events belong beside the rest.
The two vocabularies are still imported from `platform-db` rather than restated,
because the activity route validates `?entity_type=`/`?action=` against them and
DROPS an unrecognised filter rather than rejecting it.

Sales' recorder differs from issues' in three further stated ways — no fan-out
(D-13 left this app with no inbox to fan out to), no coalescing (writes are
agent-issued commands, not autosave), and `actor_token_id` actually populated.

`subject_urn` survived the removal of the projection, and the reason is the
point: a URN is `bc:sales:<slug>/<type>/<number>` and every part of it is in
`sales.*`. `platform.entities` was where it used to be looked UP; it was never
what made it true. So the resolver moved into this file, joins
`sales.workspaces`, and `?subject_urn=` / `bk sales activity --subject` keep working.

### 7.2.1 Which records have a #number, and which do not

The rule, stated once because it decides every route's shape:

| | Types | Addressed by |
|---|---|---|
| **Projected** | prospect, meeting, communication, product, template, document | the workspace **#number**; the row id is never served |
| **Not projected** | contact, stage entry, objection, match | the parent's #number, then the child's **row id** |

The second row is not a breach of the "#number, never id" rule — it is the other
half of it. That rule is about ADDRESSABLE entities: ones with a URN, which
`bk sales search` returns. (`bk link` related two apps' records until it was
removed on 2026-08-10.) A child with no independent identity
has no URN, so its row id is the only address there is, and `apps/issues` settled
the same shape for comments (`/api/workspaces/{ws}/comments/{id}`). §6.1 of the
plan writes `{cid}` and `{oid}` for exactly this.

Giving a contact a #number would mean `bc:sales:{ws}/contact/12` had to resolve,
and nothing serves it.

### 7.2.2 Search: two layers, two paths (D-9)

`GET …/search` is the PLATFORM route and reads `platform.entities` — titles,
every app, URNs out. **This app does not mount it, and the reason changed on
2026-08-10.** `GET …/sales-search` is this app's, and reads the generated
`tsvector` columns, unioned by one query in `lib/db/queries/search.ts`.

The old reason was that serving both from one host made which search an agent
got depend on which deployment it was pointed at. That reasoning was wrong — the
VERB decides, not the deployment — and the route was mounted on 2026-08-07 for a
good reason: the bare `bk search` 404'd for anyone homed here.

**The real reason is a cross-tenant read, and it was measured.** `searchRoute`
resolves the workspace through `AppContext.workspaces` — `sales.workspaces` —
and then queries `platform.entities` BY THAT ID. Migration `0004` mirrored ids,
and sales membership is no longer platform membership, so the two tenancies
overlap by construction and differ in who belongs to them. Observed locally
against the real route: a member of sales workspace 1 who is not a member of
platform workspace 1 received issues' issue titles and dashboard URLs.
`lib/search-parity.test.ts` asserts the absence, with the measurement.
`…/links` was unmounted in the same change and for the same mechanism.

Three things about the query, each of which would be a silent wrong answer if got
wrong:

- **The configuration must match the column's.** The generated columns use
  `to_tsvector('simple', …)`; a query built with `english` produces lexemes that
  never line up, and the result is zero hits rather than an error.
- **One UNION, not nine queries.** Ranking is only meaningful when the candidates
  are compared against each other; nine separately-limited lists merged in
  JavaScript is nine truncated results, not a ranked one.
- **Prefix matching is bought back explicitly.** `simple` does not stem, so
  `websearch_to_tsquery` is OR'd with a `:*` prefix query on the last word —
  which is what makes "roch" find "Roches".

The searchable set is WIDER than the addressable one: contacts, objections and
matches are searchable and have no #number, so those hits carry their prospect's
number instead. `bk meta` serves both lists under `apps.sales`.

### 7.2.3 The aggregates are computed (D-33), and their shapes were chosen here

§6.1 named `today`, `pipeline` and `metrics` and specified no shape.

- **`today`** keeps OVERDUE actions in the answer, flagged. A follow-up queue
  that drops what was missed yesterday is the one thing it must not do. Terminal
  stages are excluded — a closed deal has no next action, and a stale one left on
  it would surface for ever.
- **`pipeline`** lists EVERY stage including the empty ones, in pipeline order. A
  funnel that omits the stage nobody is in hides the thing worth noticing.
- **`metrics`** reports a NULL win rate rather than 0% when nothing closed. "We
  closed nothing" and "we lost everything" are not the same month, and a 0%
  meaning the first is a number somebody will act on. `--period` is parsed by
  SHAPE (`30d`, `12w`, `6m`) rather than matched against a list — a period is not
  a vocabulary, so there is nothing for `bk meta` to say about it.

None of the three names a stage in its code: the open/terminal split comes from
`lib/pipeline.ts`, so adding a stage changes these answers with no second edit.

### 7.3 An error message never recites a dynamic value

A 400 for an unknown stage says *"run `bk meta` for the current stage values"* and
does not list them. Same rule as the guide topics, same reason: the vocabulary
changes without a deploy, and a stale list is worst in front of an agent that is
already failing and has no reason to doubt what it just read. Limits ARE
interpolated — from `lib/limits.ts`, which the route already imports, so there is
no second copy to drift.

### 7.4 Two shapes that are contracts, not preferences

- **Moving a deal is `POST …/{n}/stage`, and `PATCH …/{n}` refuses `stage`** with
  a 400 naming the right route. A stage change writes a `stage_entries` row and
  sets `closed_at`; a PATCH that set the column alone would leave a prospect
  whose own journey disagrees with it, silently.
- **`DELETE …/{n}` requires `?confirm=<name>`, checked server-side.** `Confirm()`
  in the CLI auto-approves under `BK_NO_PROMPT=1` and on a non-TTY, so the guard
  has to be the caller repeating the target back — and it is enforced on the
  server so it cannot be skipped by a stale binary or by curl. The target is the
  **company name**, not the #number the caller already typed: repeating the
  number proves nothing about whether it is the right one. The response carries
  the type, #number and name of what was binned, captured before the delete.

### 7.4.1 Three more shapes that are contracts

- **`journey add` does not move the deal; `prospect stage` does.** Two routes
  rather than one with a flag, because a flag defaulting to "also move it" is a
  second, undocumented way to change a stage — discovered the first time somebody
  records history and the deal jumps backwards.
- **An irreversible route reads BEFORE it destroys, and this one did not.**
  `DELETE …/objections/{oid}` deleted the row and then compared `--confirm`
  against what came back, so a wrong value returned a 409 explaining the mismatch
  with the objection already permanently gone. It is the one hard delete in this
  app — `sales.objections` has no `deleted_at` and no bin — so it was the one
  place where the confirmation had to work and the one place it did not. Fixed
  2026-08-07: the comparison happens against a read, and again inside
  `deleteObjection`'s transaction under `FOR UPDATE`, because two statements
  outside a transaction can be separated by a concurrent edit and a confirmation
  that was true a moment ago is not a confirmation. `lib/api/objection-delete-guard.test.ts`
  asserts that every refusal deletes NOTHING — the status alone was satisfied by
  the broken version.

- **A meeting OUTCOME implies the meeting happened; an objection COUNTER does not
  imply it is settled.** So `PATCH …/meetings/{n}` moves the status when an
  outcome arrives, and objections keep `counter` and `resolve` as two events.
  Otherwise you cannot see which counters actually worked.
- **A document's location is not patchable.** A CHECK requires exactly one of
  `upload_url`/`external_url`, so a partial update can violate it invisibly — and
  only an uploaded file is covered by `platform.blob_references`, so swapping one
  for the other silently changes whether the delete gate can see it.

### 7.4.2 This app owns its tenancy (2026-08-10)

Workspaces, membership and invitations are `sales.*`. Before this, a sales user
was somebody who had first been invited into an ISSUES workspace and then granted
the sales app inside it — which is what made this product an add-on rather than
an app.

**How the shared request layer still works.** `AppContext.workspaces` is a
`WorkspaceSource` (`packages/platform-api/src/workspace-source.ts`) and this app
supplies its own, over `lib/db/queries/workspaces.ts`. `apiHandler`,
`resolveWorkspace`, the workspace/members read factories, `/api/me/active-workspace`
and `platformMetaBlock` all go through it. The plumbing is shared; the data is
not, and that distinction is the whole refactor in one line.

**One method on that source is a deliberate no-op, and `lib/workspace-source.test.ts`
asserts the absence:**

- `setDefaultForUser` — `platform.users.active_workspace_id` is one column shared
  by every deployment, so a sales workspace id written into it is read back by
  `apps/issues` as one of ITS ids. The default comes from this app's own tenancy
  instead.

**What this app now serves itself**, and why each could not stay a shared factory:

| Route | Why |
|---|---|
| `POST /api/auth/register` | self sign-up. **Carries the whitelist gate** — the account is the shared platform one, so an ungated route here is an ungated route everywhere. `lib/auth/register-gate.test.ts` |
| `DELETE …/members/{userId}` | the row is `sales.workspace_members`, and the factory's event write would carry this workspace's id into `platform.events` |
| `GET\|POST …/invitations`, `DELETE …/invitations/{id}` | `sales.invitations` has no `app` column — an invitation to a sales workspace IS an invitation to sales |
| `GET …/invite-candidates` | the shared version suggested people you share an ISSUES workspace with |
| `GET /api/me/pending-invitations` | the shared version reads `platform.workspace_invitations` |
| `POST /api/invitations/{accept,decline}` | **these did not exist on this app at all.** `bk invite accept` is a bare verb, so it 404'd against a sales-homed CLI, and the accept link the invitations route printed pointed at a page this app did not serve. Sales could create invitations nobody could ever accept |

`GET|PATCH …/workspaces/{ws}/apps…` are **gone** from this deployment, with the
"No access to b/sales" screen.

### 7.4.3 …and its records (2026-08-10, Phase 3)

Tenancy was half of it. The other half is everything a workspace contains.

| Was | Is | What moved with it |
|---|---|---|
| `platform.labels` (+ an `app` column and an `app IS NULL OR app = 'sales'` predicate on every read) | `sales.labels` | `visibleToThisApp()` is **deleted, not ported**. Over a table whose foreign keys cannot reach another app's row it is a no-op that reads as protection. Migration `0005` moved `prospect_labels.label_id` with it |
| `platform.uploads` | `sales.uploads` | `AppContext.uploads`, an `UploadLedger`. **The store did not split** — one Blob store, one quota, one `platform.blob_references` |
| `platform.events` | `sales.events` | every entity type, no `recordPlatformEvent` delegation. The activity route's contribution now carries an `EventSource` |
| `platform.entities` (the projection) | **nothing** | `lib/db/queries/entities.ts` is gone, with `db:reproject`. A sales record is still addressable — the URN is derived from `sales.*` — it is just not in the cross-app index |
| `platform.links` | **nothing** | `bk link` retires (PLAN.md §3). Put the far end's URN in the record's text |

**The upload attribution change is the one that was a bug rather than a move.**
`attributeUpload` in platform-storage falls back to
`platform.users.active_workspace_id` — the shared column this app deliberately
never writes — so a sales upload was filed under, and attributed to, whichever
workspace the caller last selected IN ISSUES. `lib/db/queries/uploads.ts` asks
this app's own tenancy instead, and `uploads.test.ts` asserts the absence of the
fallback with a caller who HAS that column set.

**What stayed shared, and it is not an oversight:** `platform.blob_references`.
It is the one piece of cross-app machinery that earns its keep — no app may
delete a file another app still uses — it is maintained by Postgres triggers on
this app's own content tables (migration `0002`), and Phase 3 did not touch it.
`write-paths.integration.test.ts` re-checks those triggers precisely because the
ledger moved out from under them.

**Mostly still hidden (PLAN.md §1):** no create-workspace flow, no workspace
settings page. The tables are fully multi-workspace, so any of that is a UI
change rather than a migration.

**The switcher arrived on 2026-08-11**, and the premise it was withheld under —
one workspace per person — turned out to be false. Being invited into somebody
else's workspace leaves you in TWO: signing in mints your own (the bootstrap is
keyed on membership, and you have none until you accept), then accepting adds
theirs. `components/workspace-switcher.tsx` renders **nothing** below two
memberships, so the single-tenant feel D-3 wanted is intact for everyone who has
one.

The choice lives in `sales.user_settings.active_workspace_id` — this app's own
schema, migration `0006`. **Never `platform.users.active_workspace_id`**, which
holds an issues workspace id: the two id spaces overlap, so writing a sales id
there points the other app somewhere arbitrary. That is the same collision that
forced the CLI to keep its active workspace per app.

`WorkspaceSource.setDefaultForUser` was a no-op until then and is now the writer;
`getDefaultForUser` resolves the stored pointer **through the membership list**,
so a workspace you have been removed from stops being your default rather than
sending you to a 404. `POST /api/me/active-workspace` is the one write path, used
by both the sidebar switcher and `bk sales workspace use`.

**Not yet moved, and it is Phase 3's:** `labels`, `uploads` and `events` still
write `platform.*`. Because those tables' `workspace_id` foreign keys still point
at `platform.workspaces`, a write in a workspace that exists only in `sales.*`
fails LOUDLY — see `docs/platform-db.md` for why the sequence offset in `0004` is
what makes that failure loud rather than silent. **In practice this means a
brand-new sales workspace cannot create a prospect until Phase 3 lands.**

Upload attribution has the softer version of the same gap: a sales-only workspace
resolves to no `platform.workspaces` row, so the file lands under the
`unattributed` prefix with a NULL `workspace_id` in the ledger. That is the
documented, lossless behaviour of that path (`platform-storage/src/attribution.ts`
never throws) and it resolves when `sales.uploads` takes over.

### 7.4.4 The meeting link (migration 0007, 2026-08-12)

`sales.meetings.meeting_url` — nullable `text`, the join URL of an online
meeting. Four things about it are contracts rather than choices:

- **It is optional on every meeting type, including `call` and `in_person`.** A
  room with a dial-in bridge is both, and gating the field on `type` would be the
  app having an opinion about how people meet.
- **`text`, not `varchar(n)`.** A Teams link carrying a tenant id, a thread id
  and a base64 context blob runs past 400 characters routinely. The bound is
  `MEETING_URL_MAX` in `lib/limits.ts` (served by `bk meta`), and it is a
  paste-accident guard rather than a schema fact.
- **Only `http:` and `https:` are accepted, and that is a security control, not
  fussiness.** The web app renders the value as `<a href>`, and
  `javascript:alert(1)` is a perfectly well-formed URL — a stored XSS wearing the
  shape of a meeting link, written by one workspace member and clicked by
  another. `new URL()` alone accepts it. Allowlisting two schemes also excludes
  `data:` and `vbscript:` without enumerating what is dangerous. Nothing else is
  validated: people paste Teams, Meet, Zoom, Whereby, Jitsi and internal
  hostnames, and a pattern that tried to recognise "a conferencing link" would
  refuse a real one the week a customer changed provider.
- **`{"meeting_url": null}` CLEARS it**, via `nullableStr` — a meeting that moves
  from Teams to a phone call has to be able to lose its link. On the CLI that is
  `bk sales meeting edit <n> --clear-link`, spelled as its own flag rather than
  `--link ""`, because an empty `--link` is far more often an unexpanded shell
  variable than a deliberate erasure.

`bk sales meeting edit` was added in the same change and is the first CLI reach
into `PATCH …/meetings/{n}` beyond `outcome` and `cancel`. The route has always
accepted title/agenda/at/duration/attendees — the web app's meeting form writes
them — so the CLI could do strictly less than the browser, which is backwards
for a product whose doctrine is that the agent writes. A pasted URL is the most
typo-prone value in this app, and without an edit path the only recovery from a
wrong one was to bin the meeting and re-record it, destroying its #number and its
place in the feed to fix a character.

### 7.4.5 Filtering the document library (2026-08-12)

`GET …/documents` takes `kind`, `prospect`, `q` and, since 2026-08-12, `product`
and `tag`. **Nothing about this added a tagging system.** `sales.documents.tags`
is a `text[]` written since migration 0001 by `bk sales doc add --tag`, and
`sales.document_products` has been written by `doc link --product` just as long;
only the READ path was missing, so both were stored and unreachable.

- **`tag` matches with OR, and the choice is written into the route.**
  `?tag=deck,pricing` returns documents carrying either. That is what a row of
  tag chips means everywhere a person has met one — clicking a second chip
  widens the result — and a filter bar whose second click can only ever empty the
  list reads as broken. It is also the safe direction for this data: tags here
  are free text on a small library, so AND over any two of them is empty almost
  always, and the common outcome of the other choice would be a blank page with
  no explanation.
- **Case-insensitive**, because `tags` is free text with no vocabulary behind it.
  `Deck` and `deck` are one tag to everybody except a database.
- **An unknown tag is not an error.** Unlike `kind`, which is validated against
  `DOCUMENT_KIND_VALUES` and 400s, there is no vocabulary to check a tag against.
  A tag nothing carries is a filter that matches nothing, which is a true answer.
- **The SQL is `EXISTS` + `unnest`, not the `&&` array-overlap operator**, and
  the reason is a trap worth recording: drizzle interpolates a JS array in a
  `sql` template as a parenthesised PARAMETER LIST — the shape `IN (…)` wants —
  so `${tags}::text[]` reaches Postgres as `('a','b')::text[]` and fails with
  *cannot cast type record to text[]*. With a single tag it fails differently
  (*malformed array literal*), which is worse, because the two errors look
  unrelated and a one-tag test sends you looking in the wrong place. The working
  form uses `sql.join`, the same idiom `listMeetings` and `listCommunications`
  already use for their `IN` lists.
- **`--prospect`/`--product` are `int` on `doc list` and `ints` on `doc add` /
  `doc link`, and that asymmetry is correct.** On the filter they name one thing
  to filter BY; on the write they name things to attach TO, repeatably. Unifying
  them would make `doc list --prospect 3 --prospect 7` look meaningful when the
  route has no answer for it.

### 7.5 What is not built yet

| | Phase |
|---|---|
| Vercel project, subdomain, the `platform.apps` row for real | 12 |
| A super-admin surface — **settled 2026-08-07: never.** Platform administration lives in one app (D-28); [`frontend.md` §11](./frontend.md) | — |

Everything else in the plan's 2–9 exists. `sales.user_preferences` is served by
`GET|PATCH …/preferences` and read by the web; **no route in this app reads
`ui_mode` to decide anything**, which `lib/ui-mode.test.ts` asserts structurally
rather than by convention (D-7, and the half of it that guard did not cover is
written up in `frontend.md` §8.4).

**Every write path owes TWO things now, and both take a transaction handle
without opening one:** `allocateSeq` (`lib/db/queries/counters.ts`) and
`recordEvent` (`lib/db/queries/events.ts`). The third — `projectEntity`, into
`platform.entities` — went with the projection on 2026-08-10.

The rollback case is still proven both ways, and it moved with the property:
`lib/db/queries/write-paths.integration.test.ts` asserts that a create which
fails after `recordEvent` leaves no event, AND that the same sequence written
with `db` instead of `tx` leaves an orphan. Only the pair proves anything — the
first case passes just as well against a recorder that does nothing.

The one write with neither is `setPreferences`: a display setting is not an
event, so there is nothing about the pipeline to record.
`lib/db/queries/preferences.ts` says so where somebody would otherwise assume an
omission.

---

## 8. The north star, run from a sales login (2026-08-07)

> **DATED LOG — read it as history, not as instructions (note added 2026-08-12).**
> The transcript below is what ran on 2026-08-07 and it is left as it ran. Four
> of its spellings no longer exist: `bk workspace use` is `bk sales workspace
> use`, `bk search` is `bk <app> search`, `bk app list` no longer has ENABLED or
> ACCESS columns (both tables were dropped on 2026-08-10) and it now has a
> WORKSPACE one, and **`bk link create` was removed on 2026-08-10** — so the
> `LINKED` block in the `bk sales prospect show` output below cannot appear, and
> the command that printed it was deleted on 2026-08-12.
>
> **The north star itself still holds** and is the part worth keeping: one
> login, one token, one binary, no re-auth, no server switch. What changed is
> how the two records point at each other — the far end's URN goes in the
> record's own text, which is the design and not a workaround. Current
> practice: `bk guide platform/cross-app`.

> **DATED. Read §7.4.3 first — the script below no longer runs as written.**
> Phase 3 (2026-08-10) unmounted `bk search` and `bk link` from this deployment
> and retires `bk link` outright, so steps that cross the boundary through the
> shared index now fail with exit 5 and a hint. What the run PROVED — one login,
> one token, one binary, no re-auth, no server switch — is unchanged and is what
> the section is kept for. The crossing itself is a URN in the record's own
> text, and Phase 6 returns cross-app search as a CLI fan-out.

This section is the artefact, not the claim. §10.4 of `docs/sales-app-plan.md`
states the sentence this project was justified by:

> An agent working in sales spots an engineering problem, creates an issue in
> the issues app, links the two, and carries on — **one login, one token, one
> binary, no re-auth, no server switch, and no confusion about which app
> anything landed in.**

**It ran on the first pass and it did not work.** The sales deployment served 7
of the 54 platform routes `bk` claims, so `bk search`, `bk link create` and
`bk workspace use` — two north-star steps and the command every later step
depends on — answered with a 404 page. The run only completed after
`bk app use issues`, i.e. after a server switch, which is the thing the sentence
forbids. That transcript is deleted rather than kept: it recorded a workaround.

What follows is the run **from a sales login, with no `bk app use` and no
`--app-server`**, against two local dev servers (issues :3000, sales :3100) and
one Postgres, with one token minted once.

### 8.1 The script

```
$ bk login --token --server http://127.0.0.1:3100
Logged in as balathanusan+1@blackcode.ch (id=2)
Home app: sales (http://127.0.0.1:3100)
  issues → http://127.0.0.1:3000
  sales  → http://127.0.0.1:3100

$ bk workspace use balathanusan-1-2
Active workspace: Bala 1's workspace (balathanusan-1-2)

$ bk app list
   APP     NAME              ENABLED  ACCESS  SERVER                 REACHABLE
   issues  Blackcode Issues  yes      1       http://127.0.0.1:3000  yes
*  sales   Sales             yes      1       http://127.0.0.1:3100  yes
   * = home app                                    ← sales, and it stays sales

# --- record sales work ---
$ bk sales prospect create --name "Northstar SA" --city Lausanne --value 18000
created prospect #17: Northstar SA
$ bk sales comm log --prospect 17 --channel call --dir out --body "Intro call…"
bc:sales:balathanusan-1-2/communication/19
$ bk sales meeting schedule --prospect 17 --at "2026-08-14T10:00+02:00" \
      --type video --title "Demo"
bc:sales:balathanusan-1-2/meeting/10
$ bk sales objection raise 17 --type pricing --spoken "Too expensive for a pilot"
raised objection 5 (pricing) on prospect #17
$ bk sales objection counter 17 5 --counter "Two-milestone offer…"
objection 5 is now countered
$ bk sales upload proposal.pdf
/uploads/sales/balathanusan-1-2/…-proposal-ee9dbbc4.pdf
        → platform.uploads.app = 'sales', pathname prefixed sales/
$ bk sales prospect stage 17 meeting --note "Demo booked"
prospect #17 (Northstar SA) is now at stage meeting

# --- cross the boundary. Same token, same host, no re-auth. ---
$ bk issues issue create --project 1 --title "SSO for Northstar SA — blocks CHF 18k deal" --priority 1
created #5

$ bk link create bc:issues:…/issue/5 bc:sales:…/prospect/17 --rel blocks
linked bc:issues:balathanusan-1-2/issue/5 --blocks--> bc:sales:…/prospect/17

# --- and back ---
$ bk sales prospect show 17
  LINKED
    blocks  bc:issues:balathanusan-1-2/issue/5  SSO for Northstar SA — blocks…

$ bk search northstar
  bc:issues:…/issue/5     issues  issue     5   SSO for Northstar SA — blocks…
  bc:sales:…/prospect/17  sales   prospect  17  Northstar SA

$ bk activity --since 10m
  …  issues  created        issue          #5     ← its serial is 729
  …  sales   updated        objection      5
  …  sales   stage_changed  prospect       17
  …  sales   created        meeting        10
  …  sales   created        communication  19
  …  sales   created        prospect       17

$ bk sales prospect delete 17 --confirm "Northstar SA"
binned prospect #17: Northstar SA
$ bk sales trash list
  prospect:17       Northstar SA
  meeting:10        Demo            ← the cascade is visible
  communication:19  call · out
```

**One login. One token. One binary. One host. No re-auth, no server switch.**

Two details worth reading twice:

- `bk activity` printed `issue #5` from the **sales** host. That issue's serial
  id is 729. Until 2026-08-07 this feed served the other app's internal row id
  with a `#` in front of it (§8.3).
- `bk link create` and `bk search` ran against the sales deployment. Both were
  404s here until the platform factories were mounted.

In the browser: one sign-in at `:3100`, then `:3000` with no second login (D-16,
the shared session cookie), and the prospect page's **Related** block links to
`http://127.0.0.1:3000/dashboard/…/issues/5`, which opens the issue.

### 8.2 What this host still does not serve, and what happens when you ask

An app serving a SUBSET of the platform surface is permanent and legitimate
(D-36 as amended: a permanent subset is fine, an accidental one is a bug, and
the test is whether every bare verb has a host). Sales now serves 27 of the 54;
the rest, and why:

| Verb | Why not here |
|---|---|
| `bk super-admin …` | Platform administration lives in one app. Same answer from any host, and the issues host gives it. |
| `inbox` | No route, and nothing to put in one: this app raises no per-user notifications. |
| `storage list \| rm` | No route. The delete path reaches blob deletion, which has exactly one implementation. D-28's old reason ("one ledger, same rows from issues") expired in Phase 3. |
| `user` | **Route removed 2026-08-10 (Phase 4).** `getVisibleUsers` joins `platform.workspace_members`, so on this deployment it listed people who are in NO sales workspace — measured. `bk sales member list` is the question this app has. |
| the bare `search`, `link` | **Unmounted 2026-08-10 (Phase 3), removed as bare verbs in Phase 4.** Both read `platform.entities` scoped by a workspace id resolved from `sales.workspaces` — two tenancies that share ids and not members. See §7.2.2 for the measurement. `link` is gone outright; `bk sales search` is this app's own. |
| `workspace edit \| delete \| transfer`, `member leave` | No route: the queries are still app-local to issues, and the workspace delete cascade has one implementation on purpose. `GET` on a workspace IS served, because `bk sales workspace use` resolves a slug through it. |
| `workspace create` | D-3: a workspace is the company; sales has no create-workspace flow. |

**Since Phase 4 these are ABSENT from `bk sales --help` rather than present and
404ing.** `appverbs.Config` declares what this app serves, so a verb it has no
route for is not built at all — a command that could only 404 is a dead end with
a help page. The table above is the reasoning behind that declaration, and
`lib/cli-parity.test.ts` checks it against `app/api/**` in both directions.

Asking for one of them from here is a recoverable dead end rather than a wall:

```
$ bk inbox list
error: the sales app does not serve /api/me/inbox (404)
hint: the sales deployment serves only part of the platform surface. Try
      `bk --app-server issues …` for this one command, `bk app use <slug>` to
      move the bare verbs for good, or `bk app list` to see every app's server
```

Exit 5, two lines. It used to be roughly thirty lines of the framework's HTML
404 page, pasted in as the error message.

### 8.3 Two defects this run found, both fixed

**The merged activity feed served other apps' internal row ids.** The same feed,
before the fix:

```
via issues:3000   sales   created  prospect  29     ← sales' row id (seq 9)
via sales:3100    issues  created  issue     #727   ← issues' row id (seq 4)
```

Each host resolved its OWN app and passed the other through untouched, because
`resolveEntitySeqs` can only read the mounting app's tables — and `bk activity`
prints a `#` either way, so a serial was presented AS a #number. Now taken from
`platform.events.subject_urn`, written by the producing app in the same
transaction; where a foreign row has none, the field is null rather than a
guess. Both hosts now agree, and agree with the database.

**`bk issues issue view` still does not show links back into sales.** Verified
rather than assumed, as D-18 asks. (Historic: `bk link list <urn>`
returns both links with resolved titles — and what is missing is a display in
the issues app. Deliberately not built during a verification phase; logged as a
Phase 13 item. `bk link` was removed on 2026-08-10; the URN goes in the
record's own text now.)
