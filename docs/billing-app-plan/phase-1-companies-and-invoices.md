# Phase 1: Companies and invoices

**Goal:** four screens show real data, every field of an invoice is editable from
the browser and from `bk`, and the rules that make a bill a bill are enforced by
the database rather than by app code.

This is the keystone phase. The number allocator and the audit contract decided
here cannot be changed later without touching every row.

- **The problem** — an invoice is a numbered legal document. Its number must be
  contiguous with no holes and never reused, two people creating a bill at the
  same instant must not receive the same number, a cancelled bill must keep its
  number forever, and every change to any of it must be attributable. None of
  that is enforceable in application code, because the app is not the only thing
  that can write to the database: a migration, a console session or a second
  deployment can too. And the arithmetic has its own trap — a money value that
  passes through a JavaScript float is silently wrong in the last rappen.
- **What this phase does** — creates `company`, `invoice`, `invoice_line` and
  `audit`; allocates the invoice number by a row-locking `UPDATE … RETURNING`
  inside the same transaction as the insert, so gaplessness follows from
  serialisation rather than from hope; puts the number freeze, the status
  machine, the no-delete rule, the Swiss reference-combination matrix and the
  closed vocabularies into SQL as triggers and constraints; derives every total
  in integer rappen and stores none of them; and builds the four screens plus
  their eleven `bk` commands against the same routes.
- **Expected result** — overview, invoice list, invoice detail and companies
  render live data whose totals match the mockup to the rappen; twenty
  concurrent creates produce twenty contiguous numbers; a voided number is never
  handed out again; every write has left an audit row; and each of those four
  facts has been observed failing with its guard removed.

## In one look

| | |
|---|---|
| **Data** | Each issuing company with its address, bank details, VAT status and number format. Every invoice with its lines, its client address block, its status and its cancellation record. An append-only log of who changed what, when. |
| **Logic** | Hand out the next invoice number so the sequence has no hole and no duplicate. Add up the lines, work out the VAT, produce the total — storing none of them. Refuse a rewritten number, an impossible status move, a forbidden account-and-reference combination, and any edit to the document half of a sent bill. |
| **UI** | Overview, invoice list, invoice detail (every field editable), companies and settings. The company switcher in the top bar of every page. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/overview        KPIs per currency, needs-action  new
│  components/invoice-list    filters, badges, sequence        new
│  components/invoice-detail  every field, line editor         new
│  components/company-*       cards + profile editor           new
│  components/billing-shell   sidebar, company switcher        new
│  lib/client.ts   the only fetch · lib/mutations.ts  writes    new
│  lib/scope.ts    ?company= · lib/query-keys.ts  cache keys    new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/billing/company.go, invoice.go                     new
│  commands/billing/audit.go, overview.go                      new
│  commands/billing/nextstep.go + nextstep_test.go             new
│  client/billing.go          the wire types              altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/companies|invoices|audit|overview   new
│  lib/derive/totals.ts, number.ts · lib/format.ts             new
│  lib/db/queries/companies.ts, invoices.ts, audit.ts, seq.ts  new
│  lib/vocabularies.ts, lib/limits.ts, lib/vat-rates.ts        new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        4 tables                            new
│  migrations/0004         the tables
│  migrations/0005         six guards, in SQL
│  migrations/0006         the revokes
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.** **Shared files this phase
alters:** none, except `apps/billing/docs/*` and `docs/changelog/billing.md`.

## Build

### Migration 0004: the tables

Every table carries `workspace_id integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE`,
except `invoice_line`, which is reached through `invoice_id`. It is stated once
here rather than repeated in four rows. Leave the column off and the app has no
tenancy, which is close to unfixable once there are invoices in it.

#### `billing.company` — the issuing identity

Multi-entity by design: a new company is a row, never a code change.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | internal. Never printed by any surface. |
| `seq` | `integer` | the workspace `#number`. `UNIQUE(workspace_id, seq)`. |
| `slug` | `varchar(40)` | the URL and CLI handle. `UNIQUE(workspace_id, slug)`. Immutable after create, enforced at the write door. |
| `name`, `legal_name` | `varchar(70)` | `legal_name` goes on the payment part and **must match the account holder** of the credit account (spec §4 line 6). 70 is the payload's limit, so the column enforces it. |
| `street` | `varchar(70)` | no building number |
| `building` | `varchar(16)` | |
| `postal_code` | `varchar(16)`, `city` `varchar(35)`, `country` `char(2)` | structured address only. The combined-address option is gone from the standard. |
| `email` | `varchar(255)` | the reply-to identity for the send |
| `logo_initials` `varchar(4)`, `logo_color` `varchar(9)` | | the mockup's placeholder shape. A real logo asset is later and is not a blob. |
| `iban` | `varchar(21)` nullable | **borrowed ⇠ b/books.** Carries SCOR and NON, CHF and EUR. |
| `qr_iban` | `varchar(21)` nullable | **borrowed ⇠ b/books.** QR-IID 30000–31999. NULL means QRR is impossible for this company. |
| `vat_registered` | `boolean` | `false` means VAT is **omitted entirely** from its invoices — no rate, no 0%, no block. |
| `uid`, `vat_number` | `varchar(32)` nullable | ⚠ placeholders until P2 |
| `default_currency`, `default_language`, `default_ref_type` | `varchar` | prefill for new invoices only. Never read at render time. |
| `number_format` | `varchar(40)` | `BC-{YYYY}-{SEQ4}`, `AL-{SEQ4}`. Two tokens, both optional. |
| `next_seq` | `integer NOT NULL DEFAULT 1` | **the allocator.** See below. |
| `payment_terms_days` | `integer` | `due_date` prefill |
| `footer_fr`, `footer_en` | `text` nullable | printed at the foot of the A4 |
| `retired_at` | `timestamptz` nullable | a company stops being offered for new invoices. **Never deleted** — past invoices reference it and must still render. |
| `external_ref` | `varchar(80)` nullable | the caller's own identifier. Partial unique `(workspace_id, external_ref) WHERE external_ref IS NOT NULL`. [`integration-surface.md`](integration-surface.md) §3. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | flat string → string, limits declared once in `lib/limits.ts`. Not the document: stays writable. |

#### `billing.invoice`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | internal |
| `seq` | `integer` | the workspace `#number` — the address. `UNIQUE(workspace_id, seq)`. |
| `company_id` | FK company | frozen after insert |
| `seq_no` | `integer` | the per-company statutory sequence value. `UNIQUE(company_id, seq_no)`. |
| `number` | `varchar(40)` | rendered from `number_format` at allocation. **Never edited.** |
| `status` | `varchar(10)` | `draft` / `sent` / `paid` / `void` |
| `issue_date`, `due_date` | `date` | |
| `paid_date` | `date` nullable | required when `status = 'paid'` |
| `currency` | `char(3)` | ISO 4217. Multi-currency; the payment part exists only for CHF and EUR. |
| `language` | `varchar(2)` | the **document's** language, `fr` / `de` / `it` / `en`. Drives the Annex C literals and the content language. Not the operator's UI language. |
| `ref_type` | `varchar(4)` | `QRR` / `SCOR` / `NON` |
| `ref_body` | `varchar(26)` nullable | the reference **without** its check digit. NULL for NON. |
| `client` | `jsonb NOT NULL` | `{name, street, building, postal_code, city, country}`. **One self-contained object** — nothing else on the invoice may depend on its internals, which is what makes the later b/clients swap a data-source change. |
| `vat_rate` | `numeric(5,2)` **nullable** | NULL means VAT omitted (company not registered). `0` is a **valid rate** (export, reverse charge) and is not NULL. The distinction is load-bearing. |
| `message` | `varchar(140)` | the unstructured payment message. Shares a 140-character budget with billing information, enforced from day one even though we emit none. |
| `void` | `jsonb` nullable | `{ts, by, reason: {fr, en}}`. A void is a record, never a deletion. |
| `created_by` | FK `platform.users` | |
| `external_ref` | `varchar(80)` nullable | the caller's own identifier, partial unique per workspace as on `company`. Writable after send: it is the caller's bookkeeping, not the document, so G2 does not cover it. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | as on `company`. Audited as `metadata.<key>` paths. |

#### `billing.invoice_line`

**A table, not a `jsonb` column — decision D-B4.** The wire shape stays
`items: [...]`; the shaping function assembles it.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `invoice_id` | FK invoice, `ON DELETE CASCADE` | |
| `line_no` | `integer` | display order. `UNIQUE(invoice_id, line_no)`. |
| `description` | `text NOT NULL` | free text in the invoice's language |
| `qty` | `numeric(12,3)` | 12 days, 0.5 hours, 48 pieces |
| `unit` | `varchar(24)` | display-only text. Not a vocabulary. |
| `unit_price` | `numeric(14,2)` | |

No `product_id` and no per-line `vat_rate` in v1 — the catalogue is b/sales and
the mockup carries one rate per invoice. The table is what makes a per-line rate
a column later rather than a rewrite of every row.

#### `billing.audit` — append-only

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `seq` | `integer` | `UNIQUE(workspace_id, seq)` |
| `subject_type` | `varchar(16)` | `invoice` / `company` / `recurrence` |
| `subject_id` | `integer` | the subject's `id`. Deliberately **not** a foreign key: an audit row outlives nothing here, but a typed FK per subject type would mean three nullable columns and a CHECK, for no gain. |
| `ts` | `timestamptz NOT NULL DEFAULT now()` | |
| `actor_user_id` | FK `platform.users` | **Humans and agents land in the same log.** An agent write is a user's token, so the user is always known. |
| `via` | `varchar(8)` | `session` or `token` — the only structural difference between a human write and an agent write. Same spelling as `/api/meta`'s `user.via`. |
| `action` | `varchar(20)` | `created` / `field_changed` / `status_changed` / `sent` / `paid` / `voided` |
| `field` | `varchar(64)` nullable | `items[2].unit_price`-style paths, as the mockup writes them |
| `from_value`, `to_value` | `text` nullable | |
| `detail_fr`, `detail_en` | `text` nullable | one human sentence of context |

`billing.counters` from phase 0 gains rows for the entity types `company`,
`invoice` and `audit`.

#### `billing.idempotency_keys` — why a retried create is not a second bill

This app is the one on the platform where a retry is unrecoverable: the number
is gapless and the row is never deleted, so a client that retries a timed-out
`POST …/invoices` mints a second real invoice. The events spine carries an
idempotency key for the same reason (`apps/sales/lib/db/schema.ts:1653`).

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | FK `billing.workspaces` | |
| `key` | `varchar(80)` | the `Idempotency-Key` header. `UNIQUE(workspace_id, key)` — the index is what settles a concurrent double-submit; the code never checks first. |
| `request_hash` | `char(64)` | sha256 of method, path and canonical body. Same key with a different hash is refused, never replayed. |
| `status` | `varchar(8)` | `pending` / `done` |
| `response_status`, `response_body` | `integer`, `jsonb` | what is replayed |
| `created_at` | `timestamptz` | rows older than 24 hours are treated as new |

The wrapper is `lib/api/idempotency.ts`, applied to every `POST` that
allocates a number. Semantics, tests and the three mutations to watch are in
[`integration-surface.md`](integration-surface.md) §2. It is **not** in
`packages/platform-api` until a second app asks.

### The number allocator, in detail

**Two numbers per invoice, and they are not interchangeable.** Books learned this
first; this app has one more identifier than books does.

| | What it is | Where it comes from | Where it appears |
|---|---|---|---|
| `id` | the row | `serial` | nowhere. No surface prints it. |
| `seq` | the workspace `#number`, the **address** | `billing.counters`, the upsert below | `bk billing invoice show 7`, the URN `bc:billing:blackcode/invoice/7`, the route path |
| `seq_no` + `number` | the **statutory** per-company sequence | `company.next_seq`, the row lock below | printed on the document, and on the payment part's reference |

**`seq` — the workspace #number.** One statement, so the read and the increment
cannot interleave. Copied from `apps/books/lib/db/queries/statutory.ts:691`:

```sql
INSERT INTO billing.counters (workspace_id, entity_type, last_value)
VALUES ($1, $2, 1)
ON CONFLICT (workspace_id, entity_type)
  DO UPDATE SET last_value = billing.counters.last_value + 1
RETURNING last_value
```

**`seq_no` — the gapless statutory number.** Inside the same transaction as the
invoice insert:

```sql
UPDATE billing.company
   SET next_seq = next_seq + 1
 WHERE id = $1
RETURNING next_seq - 1 AS seq_no
```

Then render `number` from `company.number_format`, replacing `{YYYY}` with the
issue year and `{SEQ4}` with `seq_no` zero-padded.

**Why this is gapless and a Postgres `SEQUENCE` is not.** The `UPDATE` takes a
row lock on the company for the rest of the transaction. A second create waits.
If the first transaction rolls back, its increment reverts **before the waiter is
released**, so the waiter receives the same number and no gap appears. A
`SEQUENCE` is explicitly non-transactional: a rollback consumes the value and
leaves a hole, which is a bookkeeping violation rather than an inconvenience.

Three consequences to accept rather than optimise away:

1. **Invoice creation for one company is serialised.** That is the price of
   gaplessness and it is the right trade at this volume. Do not "improve" it.
2. `UNIQUE(company_id, seq_no)` is the backstop, not the mechanism. If it ever
   fires, the allocator has been changed to read-then-write.
3. A void **does not** free its number. There is no code path that decrements
   `next_seq`, and adding one would be the bug.

### Migration 0005: the guards, written in SQL

These are not app checks. They are database objects, and they hold against a
migration, a console session and a second deployment.

| # | Guard | Mechanism |
|---|---|---|
| **G1** | **The number is permanent.** `number`, `seq_no`, `company_id` and `seq` cannot change after insert. | `BEFORE UPDATE` trigger, comparing `OLD` to `NEW` per column, raising with a message that names the correction path. |
| **G2** | **A sent document is frozen.** Once `status <> 'draft'`: `currency`, `ref_type`, `ref_body`, `client`, `vat_rate`, `issue_date` and the invoice's lines are immutable. `message`, `due_date`, `paid_date`, `status` and `void` stay writable. | Two triggers, one on `invoice` and one on `invoice_line` — the lines of a sent invoice **are** the document. **Column-scoped, and that is stronger than a table-level revoke, not weaker:** a revoke cannot tell an amount from a payment message, and only one of those is a legal fact. This is position P9; see the README. |
| **G3** | **The status machine.** `draft → sent → paid`, anything → `void`, and nothing else. `void` requires the `void` object. `paid` requires `paid_date`. | A `CHECK` for the vocabulary and the field dependencies; a `BEFORE UPDATE` trigger for the transitions, because a `CHECK` cannot see the old row. |
| **G4** | **The Swiss combination matrix.** `QRR` implies `currency = 'CHF'` and a 26-digit numeric `ref_body`. `NON` implies `ref_body IS NULL`. `SCOR` implies a non-empty `ref_body`. | `CHECK` constraints. The remaining half of the matrix — QRR requires the company to *have* a `qr_iban` — needs the company row, so it is enforced at the write door and asserted in a test. |
| **G5** | **Nothing is ever deleted.** No `DELETE` on `invoice`, `invoice_line` or `audit`. | `BEFORE DELETE` trigger raising, **plus** the revokes in 0006. Both deliberately: the trigger stops anything running as owner, the revoke stops the app before the statement is attempted and shows up in `\dp` where a reviewer sees it. |
| **G6** | **Closed vocabularies.** `status`, `ref_type`, `language`, `currency`, `audit.action`, `audit.via`, `member role`. | `CHECK` constraints mirroring `lib/vocabularies.ts`. Two copies of one list, so a test asserts they agree — the scanner-versus-migration lesson of finding #18. |

`billing.audit` additionally gets no `UPDATE`: it is append-only, and phase 1 is
where that becomes true.

### Migration 0006: the revokes

```sql
REVOKE DELETE ON billing.invoice, billing.invoice_line, billing.audit FROM billing_app;
REVOKE UPDATE ON billing.audit FROM billing_app;
```

`UPDATE` stays on `invoice` and on `invoice_line`. **Do not revoke it**: editing
a draft is the app's main loop, and immutability is enforced per column by G1 and
G2, which a table-level revoke cannot express. This is the same disagreement
`apps/books/lib/db/migrations/0005_app_role_grants.sql:38-54` records with its
own plan, resolved the same way.

Also add `REVOKE DELETE ON billing.company` — a company is retired, never
deleted.

### Derivations (`lib/derive/`)

Pure functions. Never store a result. Every amount is an **integer count of
rappen** inside these functions and a **string** at both ends.

**`totals.ts`**

```
lineTotal(qty, unit_price)  → rappen
    qty is numeric(12,3)   → parse to an integer count of milli-units
    unit_price is numeric(14,2) → parse to an integer count of rappen
    product = qty_milli × price_rappen        (scaled by 1000)
    lineTotal = round_half_away(product / 1000)   → rappen

computeTotals(lines, vat_rate) → { subtotal, hasVat, vat_rate, vat, total }
    subtotal = Σ lineTotal                     → rappen
    hasVat   = vat_rate !== null               ← NOT `vat_rate > 0`
    vat      = hasVat
                 ? round_to_step(round_half_away(subtotal × rate_bp / 10000), 5)
                 : 0                            → rappen
    total    = subtotal + vat
```

`rate_bp` is the rate in basis points (`8.1%` → `810`), parsed from the
`numeric(5,2)` string. `VAT_ROUNDING_STEP = 5` rappen lives in `lib/limits.ts`
and nowhere else — this is position P8 and it is one constant to flip.

**Two decisions inside that specification, both assumptions to confirm with the
fiduciary:** each line total is rounded to the rappen before the subtotal is
summed, and VAT is computed on the rounded subtotal rather than per line. Say so
in the code, not only here.

**No `Number` is constructed on the display path.** `apps/books/lib/format.ts` is
the worked example and its header records why: the old path went string → float64
→ `toFixed(2)`, and `"0.145"` and `"8.005"` rounded in opposite directions while
`"1e3"` rendered as `CHF 1'000.00`. **Do not import it** — apps never import each
other. Copy the approach, and note that b/billing formats money the mockup's way
(space thousands separator, `CHF 1 590.00`, per spec §3.5.4) rather than books'
apostrophe, and that the payload uses no separator at all. Three formats, two of
them mandated, and a test for each.

**`number.ts`** — `renderNumber(format, year, seqNo)`. Two tokens, `{YYYY}` and
`{SEQ4}`, both optional; an unknown token is an error, not a passthrough.

**`format.ts`** — `money`, `date` (slice the ISO string; never construct a
`Date`, which shifts a Postgres `date` across a year boundary west of
Greenwich), `percent`, and `amountForPayload` (no thousands separator).

### Queries (`lib/db/queries/`)

`seq.ts` → `allocateSeq(tx, workspaceId, entityType)`, `allocateInvoiceNumber(tx, companyId)`

`companies.ts` → `listCompanies`, `getCompanyBySlug`, `createCompany`, `updateCompany`, `publicCompany`

`invoices.ts` → `listInvoices` (keyset on `seq`), `getInvoice`, `createInvoice`, `updateInvoice`, `replaceLines`, `publicInvoice`

`audit.ts` → `appendAudit(tx, …)`, `listAudit`

`overview.ts` → `getOverview`

**Every write function is one transaction that ends in `appendAudit` and returns
a fresh read.** A write answers with a result, never with `null` and a flag.

The diff that produces `field_changed` rows belongs in the query layer, not the
route: one implementation, and it is what makes an agent write and a browser write
indistinguishable in the log except for `via`.

### Routes and CLI

Both in the same commit, or the parity test fails the build.

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/companies` | `bk billing company list` |
| `POST /api/workspaces/{ws}/companies` | `bk billing company create` |
| `GET /api/workspaces/{ws}/companies/{slug}` | `bk billing company show` |
| `PATCH /api/workspaces/{ws}/companies/{slug}` | `bk billing company edit` |
| `GET /api/workspaces/{ws}/invoices` | `bk billing invoice list` |
| `POST /api/workspaces/{ws}/invoices` | `bk billing invoice create` |
| `GET /api/workspaces/{ws}/invoices/{ref}` | `bk billing invoice show` |
| `PATCH /api/workspaces/{ws}/invoices/{ref}` | `bk billing invoice edit`, `line add`, `line edit`, `line remove` |
| `GET /api/workspaces/{ws}/audit` | `bk billing audit list` |
| `GET /api/workspaces/{ws}/overview` | `bk billing overview` |

`{ref}` accepts the `#seq` or the invoice `number`, resolved in that order. A
`number` that matches nothing is a 404 whose suggestion names
`bk billing invoice list`.

List filters: `?company=`, `?status=`, `?currency=`, `?external_ref=`, `?limit=`,
`?cursor=`. The audit list adds `?since=<seq>` and returns rows ascending from
there; [`integration-surface.md`](integration-surface.md) §4 has the reason a
poller cannot miss a row, and it rests on the counter's row lock.

Every `POST` that allocates a number honours `Idempotency-Key` (§2 there), and
`bk` sends one per invocation. `POST …/invoices` also accepts an optional
`expected_total` and refuses with `409 total_mismatch`, carrying both numbers,
when it disagrees with the derived total. The routes in this table that appear
in `lib/integration.ts`'s `PUBLIC_ROUTES` are the public surface from this phase
on; the declaration, its readers and its test are §1 there.
Lists return `{data, next_cursor}` through `jsonList`; single resources are bare;
create returns 201.

**The `--company` flag is this app's third scope dimension and has no precedent
in the repo beyond books' `--entity`.** Decide it here and keep it identical
everywhere: `--company <slug>`, remembered per workspace in the CLI's own config,
and **stated in the output of every write** so a bill never lands under a company
the caller did not mean. `bk` says a command run against a workspace you did not
mean returns 200 and real data; the same is true one level down, and the company
is the level at which the wrong answer is a wrong IBAN.

Every write command ends with a runnable next command. Copy
`cli/internal/commands/books/nextstep.go` and its AST-level test, which fails any
`newXxxCmd` whose `routes` annotation contains a write verb and whose body does
not call `nextStep`.

### The web surface

**Full write parity — decision D-B1.** `apps/sales` is the app with forms; reuse
its shape rather than books':

- **`lib/client.ts` is the only module that may name `fetch`.**
- **`lib/mutations.ts` is the only module that may send a write**, one exported
  hook per write (`useEditInvoice`, `useSetStatus`, `useAddLine`, …), mirroring
  `apps/sales/lib/mutations.ts:161+`.
- Copy `apps/sales/lib/read-only.test.ts` **for its module-graph half only** and
  drop its read-only assertion: this app writes from the browser by design. What
  survives is the part that matters — a stray `fetch` in a component, or a
  `'POST'` string beside `/api/workspaces` anywhere outside `lib/mutations.ts`,
  fails the build. The scan is **inverted** (everything is the web surface except
  a named list of non-surface directories), because a component in a new
  directory once called `fetch('/api/…', {method:'POST'})` with all 41 tests
  green.
- Undo on every mutation via a `sonner` toast; `useConfirm` for anything that
  asks a question. Never `window.confirm`.

Cache keys go through one helper, `billingKey(resource, scope)`, with a
`query-keys.test.ts` that scans `lib/hooks.ts` and fails on any `queryKey:` not
built by it. **The worst bug this app can ship is one company's invoices under
another's name**, and a stale cache key is how that happens without anybody
writing anything wrong.

The **company switcher** is a query-string filter, not navigation:
`?company=<slug>`, written with `router.replace` preserving every other
parameter. An unknown slug is **kept, not replaced** — the page renders "no such
company" and says which company it is showing instead. Silently resolving to the
first company answers a different question from the one asked, and that class of
bug reaches no console and no test.

The workspace slug stays in the URL because the platform's route factories need
it, and **the word "workspace" never appears on screen**. Hide the company
switcher where the workspace has one company.

Four screens:

| Page | Reads |
|---|---|
| `/dashboard/[ws]` | `GET …/overview` — KPIs **per currency, never merged**, the needs-action list, recent invoices, recent audit |
| `/dashboard/[ws]/invoices` | `GET …/invoices` — status and currency filters, `QRR`/`SCOR`/`NON` badges, the gapless sequence visible. "+ New invoice" POSTs a minimal draft then pushes to the detail page with `?new=1`, which auto-focuses the first field — the platform's create-item pattern, no modal. |
| `/dashboard/[ws]/invoices/[ref]` | `GET …/invoices/{ref}` — every field editable, the client block visually separate behind its `⇠ b/clients (future)` chip, the line editor, derived totals, the audit log, and a raw-record drawer |
| `/dashboard/[ws]/settings/companies` | `GET …/companies` — cards plus the profile editor. Bank fields read-only behind `⇠ b/books` unless the caller owns the workspace. The number-sequence strip. |

EN and FR chrome through `platform-i18n`: a dictionary per area under
`lib/dictionary/`, `useT()` binding the generic once so a typo is a compile
error, the locale resolved in the **root** layout, and a `hardcoded-strings.test.ts`
scanning components for literals that never went through `t()`. The document
language is a different mechanism from the UI language and the two must never
merge.

Empty states for all four pages, exercised by switching to a second, empty
workspace. Not a blank panel: say what the page is for and what would fill it.

## Done when

- [ ] Four screens render live data, and every total matches
      `localhost:8734/bbilling` **to the rappen** for the seeded data
- [ ] **Twenty concurrent creates** against one company produce twenty distinct
      contiguous numbers, no gap and no duplicate
- [ ] A void, then a create, shows the voided number still consumed and the new
      one following it
- [ ] `vat_rate: null` renders **no VAT block at all**; `vat_rate: 0` renders
      `TVA 0%`. Both asserted.
- [ ] Every write path has left exactly the audit rows expected, including one
      row per changed line path
- [ ] The combination matrix refuses QR-IBAN + SCOR, IBAN + QRR, and EUR + QRR
      at the write door, each with a `suggestion` that names the fix
- [ ] `billing_app` cannot `DELETE` an invoice or `UPDATE` an audit row —
      checked **as that role** against the local database, not as the superuser
- [ ] Two `POST …/invoices` with one `Idempotency-Key` produce one invoice; with
      the unique index on `idempotency_keys` dropped they produce two, observed,
      then restored. Same key with a different body is refused; a concurrent
      pair yields one 201 and one 409, asserted on the responses
- [ ] `?external_ref=` finds the row, and a duplicate `external_ref` is refused
      with the existing `#seq` in the suggestion
- [ ] `PUBLIC_ROUTES` is served by `/api/meta` anonymously, the contract hash
      moves when an entry is added, and `lib/integration.test.ts` was watched
      failing on a declared route with no file
- [ ] **These were watched failing, then restored:** the allocator replaced with
      `MAX(seq_no)+1` outside the transaction (duplicate appears); `appendAudit`
      dropped from `updateInvoice`; G1 disabled and `number` patched; G2 disabled
      and a sent invoice's `unit_price` patched; `VAT_ROUNDING_STEP` changed to 1;
      a `fetch` added to a component; a `queryKey` written by hand
- [ ] Every page opened in a browser, **per page**, in FR and EN on a string that
      differs between them, including the detail page **with no `?ref` at all**
      on an **empty** tenant

## Frontend gets

**Four pages live:** overview, invoice list, invoice detail, companies and
settings. The invoice detail page is the densest thing in the app and the one to
study first in the mockup — `app-invoice-detail.html?id=7004`.

## Notes

**The `client` block is `jsonb` and that is the point.** R3 says it becomes
`{bclients_ref, snapshot{…}}` later. Keeping it one opaque object now means the
swap is a data-source change; spreading it into six columns on `invoice` would
make it a migration plus every read site. It holds no money, so `jsonb` costs
nothing here.

**`vat_rate: null` is not `0`, at every layer.** A company that is not registered
for VAT omits the block entirely — not a zero line. A registered company may
legitimately invoice at 0% (export, reverse charge) and that must print. The
mockup demonstrates both: Aurora Labs has `null` throughout, and BC-2026-0035 is
an EUR export at `0`. `hasVat` is `vat_rate !== null` and must never be written
as a truthiness check.

**Per-currency sums are never merged.** The dashboard shows `CHF x + EUR y`.
There is no converted total, conversion is not this app's business, and if you
find one, delete it.

**`/api/me/footprint` owes an update in this phase.** Its `holds` array is empty
after phase 0 and must now count companies and invoices. Forgetting it means a
person closing their account is told this app holds nothing while it holds their
billing history — and nothing fails to remind you.

**A route is not a page.** Every check in this repo that verifies behaviour sees
`app/api/**` and nothing else. Two bugs shipped to production in two days in this
repo and both lived where every route was correct: a dashboard that 404'd for
four phases, and a members page that went blank because a cast renamed the
`{data, next_cursor}` envelope instead of opening it. When a page reads
something, open it.

**The vocabulary lives in one place and is served live.** `lib/vocabularies.ts`
holds the statuses, reference types, currencies, document languages and
frequencies; `/api/meta` serves them; a guide topic never restates them. This is
also the file `cli/internal/guide/guide_test.go`'s `vocabularySources` map points
at, so the guard that stops a topic hardcoding a status only works if this file
keeps the `value: '…'` shape the other apps use.
