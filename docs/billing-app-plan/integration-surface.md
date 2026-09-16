# The integration surface: b/billing as a service

**Goal:** a company whose own system is the system of record can create, fetch,
send and settle invoices in a b/billing deployment over HTTP with a token, retry
safely, correlate by its own identifiers, and follow what changed, without
anything in this repo being hand-maintained for them. This is the decision
**D-B5** in the [README](README.md), and it is the one milestone here that
amends a repo rule rather than following one.

- **The problem** — the platform's standing rule is that the HTTP API has no
  public contract and the `bk` CLI is the only supported client
  ([`backend.md:20`](../backend.md#L20), [`CLAUDE.md`](../../CLAUDE.md) "Agent
  surface contract"). A second company's billing stack plugging in "like
  Stripe" is exactly an external consumer of the HTTP API. And this app has a
  trap no other app on the platform has: an invoice number is gapless and an
  invoice is never deleted, so a network timeout on create, retried by any
  client, mints a second real invoice that can only be voided. A system that
  cannot be retried safely cannot be integrated at all.
- **What this milestone does** — declares a small, versioned subset of
  b/billing's routes as public, served from one declaration that `/api/meta`
  carries, the contract hash covers, a page on the deployment renders and a
  test checks against the filesystem, so it is never typed twice; adds
  idempotency keys to every route that allocates a number; gives invoices,
  companies and series an `external_ref` and a `metadata` map; turns the
  audit log into a cursor-paged event feed; and moves the app's display
  identity from constants to environment. Each item is threaded into the phase
  where it is cheap, and this doc is where the reasoning lives.
- **Expected result** — a token minted in the browser at
  `/settings/tokens` can drive the whole invoice lifecycle from another
  system; the same create sent twice with one key yields one invoice and one
  number, observed after the unique index was dropped and two appeared; a
  caller can look an invoice up by its own reference; a poller that reads the
  audit feed from a cursor never misses a row; `/api/meta` says which routes
  are public and the hash moves when that list does; and the rest of the
  surface stays exactly as private as it is today.

## In one look

| | |
|---|---|
| **Data** | `billing.idempotency_keys`; `external_ref` and `metadata` on `company`, `invoice` and `recurrence`; nothing else new. The audit log is reused as the feed. |
| **Logic** | One route wrapper that replays or refuses a repeated key; one declaration of which routes are public, served and tested; a `since` cursor on the audit query; three constants read from env. |
| **UI** | `/integration` on every deployment, rendering the declaration and the conventions. A `⇠ external` chip on any record that carries an `external_ref`. |

## The decision, and the rule it amends

The rule, in [`backend.md:887`](../backend.md#L887): *"These routes are private
plumbing: the `bk` CLI is their only supported client... do not point external
consumers at them, and do not treat any shape here as stable."* Its reason is
stated in the same paragraph: retiring the OpenAPI spec meant a route and its
command could change together in one commit without breaking anybody.

Two ways to serve a second company without breaking that reason were weighed on
2026-09-16:

| Option | What it costs | Why it lost or won |
|---|---|---|
| **(1) They integrate through `bk`.** Their backend shells out to the binary. | Nothing new in this repo. | Fully inside the rule and language-neutral. It lost because a team expecting an HTTP API is being asked to ship a Go binary into their stack, and because `bk` is a product for agents and people, not a library. |
| **(2) b/billing declares a public subset.** About ten routes, marked public, promised stable. | One declaration, one test, one page, and a changelog discipline that already exists. | **Chosen.** What the rule protects is *"a route and its command change together without breaking anybody"*. A declared subset keeps that for every route outside it, and for the routes inside it makes the breaking explicit: a changelog entry marked breaking and a moved contract hash. |

**What stays:** every route not in the declaration is as private as today. `bk`
remains the whole product, and every public route still needs its `bk` command,
because `cli-parity` does not know the word "public".

**What the objection actually was:** the spec that was retired was a
hand-maintained copy of facts that lived elsewhere and had drifted. Nothing in
this milestone is typed twice. The declaration is one TypeScript array; the
meta block, the page, the test and the contract hash all read it.

## What already serves an external caller

Verified against the repo on 2026-09-16. None of this is built by this
milestone.

- **Bearer tokens.** `bk_live_…` tokens in `platform.api_tokens`, verified by
  `packages/platform-auth`, accepted on every data route through `resolveUser`
  ([`app-context.ts:170`](../../packages/platform-api/src/app-context.ts#L170)).
  Minting is session-only by design (`app-context.ts:174`), so the customer's
  administrator mints in the browser and hands the token to their system.
- **Tenancy.** A workspace is the tenant and membership is the whole gate. The
  `company` table gives one tenant several issuing entities.
- **The borrow seam.** The client block on an invoice is caller-supplied JSON
  (README, "the borrowed-data rule"). Their system pushes the client with the
  invoice, and b/billing never reads their stack.
- **The wire shape.** Money and dates as strings, lists as `{data, next_cursor}`,
  every refusal carrying a `suggestion`, and a derived contract hash
  ([`contract-version.ts`](../../packages/platform-api/src/contract-version.ts))
  that changes if and only if the declared contract does.
- **The changelog.** `docs/changelog/billing.md` is served by `bk changelog` and
  `GET /api/changelog`, and its own rule says it exists so integrations can keep
  up. It is the vehicle for every breaking change on a public route.

## Build

### 1. The declaration — phase 1, extended by each later phase

`apps/billing/lib/integration.ts`:

```ts
export const PUBLIC_ROUTES = [
  { method: 'POST', path: '/api/workspaces/{ws}/invoices',            since: '2026-10-01' },
  { method: 'GET',  path: '/api/workspaces/{ws}/invoices',            since: '2026-10-01' },
  { method: 'GET',  path: '/api/workspaces/{ws}/invoices/{ref}',      since: '2026-10-01' },
  { method: 'PATCH',path: '/api/workspaces/{ws}/invoices/{ref}',      since: '2026-10-01' },
  { method: 'GET',  path: '/api/workspaces/{ws}/invoices/{ref}/pdf',  since: '…' },   // phase 2
  { method: 'GET',  path: '/api/workspaces/{ws}/invoices/{ref}/qr',   since: '…' },   // phase 2
  { method: 'POST', path: '/api/workspaces/{ws}/invoices/{ref}/send', since: '…' },   // phase 3
  { method: 'POST', path: '/api/workspaces/{ws}/invoices/{ref}/mark-sent', since: '…' },
  { method: 'POST', path: '/api/workspaces/{ws}/invoices/{ref}/paid', since: '…' },
  { method: 'POST', path: '/api/workspaces/{ws}/invoices/{ref}/void', since: '…' },
  { method: 'GET',  path: '/api/workspaces/{ws}/companies',           since: '2026-10-01' },
  { method: 'GET',  path: '/api/workspaces/{ws}/audit',               since: '2026-10-01' },
] as const
```

`since` is the date the route became public, for the reader of the page. Dates
above are placeholders until the phase that ships the route lands.

**Where the declaration is read, and nowhere else:**

| Reader | What it does with it |
|---|---|
| `GET /api/meta` | Serves it under `apps.billing.integration`, in the **anonymous half** of the response. b/books already splits `/api/meta` that way: the vocabulary half needs no session (`apps/books/app/api/meta/route.ts:89`). Being under `apps.<slug>` puts it inside the contract hash automatically, because the hash covers *"everything `/api/meta` serves under `apps.<slug>`"* (`contract-version.ts`, "what must and must not go into it"). |
| `/integration` page | A public page on the deployment, no session, rendering the list plus the conventions below. It exposes no tenant data. This is the customer's developer documentation, and it lives on their deployment, so it describes the version they are running. |
| `lib/integration.test.ts` | Every declared path has a file under `app/api/**` exporting that method; every declared route has a `bk` claim in `bk __routes`; the declaration is non-empty. |
| `bk meta` | Prints it. No new command. |

**The conventions the page states, once:** `Authorization: Bearer bk_live_…`;
`Idempotency-Key` on every POST; `{data, next_cursor}` on lists; the error
envelope with `code`, `message`, `suggestion`; amounts as strings in the
currency's minor unit rules; dates as `YYYY-MM-DD`; the contract hash header
and where to poll it; the changelog URL.

**The stability promise, in words a customer can hold us to:** a public route's
request and response shapes change only additively. A breaking change is a new
path, or a `docs/changelog/billing.md` entry marked breaking whose date is at
least thirty days before the deploy. The hash moves either way.

**Watch the guard fail:** add a route to `PUBLIC_ROUTES` that has no file, then
one that has a file and no `bk` command. Both red, then restore.

### 2. Idempotency keys — phase 1, every allocating POST

**Why this app cannot skip it.** The number allocator in phase 1 is a
row-locking `UPDATE … RETURNING`, so a retried `POST …/invoices` produces two
invoices with two contiguous numbers. Neither can be deleted (guard G5). A
timeout between our commit and the client's receipt is indistinguishable, to
the client, from a failure, and every HTTP client retries. The events spine
already carries an idempotency key for the same reason, stated at
[`apps/sales/lib/db/schema.ts:1653`](../../apps/sales/lib/db/schema.ts#L1653):
*"the UNIQUE index on it is what makes a retried agent command not double-log,
and the cost of the column is one nullable varchar against the cost of
discovering you need it after the table has rows."*

**The header:** `Idempotency-Key`, at most 80 characters (the events column's
width), any printable string. Required on the public POSTs from the customer's
side; optional otherwise, because `bk` supplies one itself.

**The table, migration 0004 (with the other phase-1 tables):**

```sql
CREATE TABLE billing.idempotency_keys (
  id              serial PRIMARY KEY,
  workspace_id    integer NOT NULL REFERENCES billing.workspaces(id) ON DELETE CASCADE,
  key             varchar(80) NOT NULL,
  request_hash    char(64) NOT NULL,          -- sha256(method + path + canonical body)
  status          varchar(8) NOT NULL DEFAULT 'pending',   -- pending | done
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
```

**The semantics, and each is one test:**

| Case | Response |
|---|---|
| New key | Insert `pending`, run the handler, store status and body, mark `done`, respond. |
| Same key, same hash, `done` | Replay the stored status and body, with header `Idempotent-Replayed: true`. **Nothing runs.** |
| Same key, different hash | `422 idempotency_key_reused`, suggestion: *"use a new key for a different request"*. |
| Same key, still `pending` | `409 idempotency_in_progress`, suggestion: *"retry in a few seconds with the same key"*. This is the concurrent double-submit, and the unique index is what makes the second insert fail rather than the second handler run. |
| Key older than 24 hours | Treated as new. A daily `bk billing maintenance purge-keys` deletes older rows; the app schedules nothing. |

**Where it lives:** `apps/billing/lib/api/idempotency.ts`, a wrapper applied in
the route files that allocate: `POST …/companies`, `POST …/invoices`,
`POST …/recurrences/{seq}/generate`, `POST …/invoices/{ref}/send`. **Not in
`packages/platform-api` yet.** This repo promotes a thing to the platform when a
second app asks for it, and the second app has not asked. The wrapper takes a
store interface so the promotion is a move, not a rewrite.

**`bk`'s side:** every write command generates a UUID once per invocation and
sends it on every attempt of that invocation's request. `--idempotency-key`
lets a caller supply its own. Both are tested at the `cmdutil` level: the same
key on a retried request, a fresh key on a fresh invocation.

**Watch it fail three ways:** drop the unique index and post twice with one key
in parallel (two invoices); change the hash to cover the path only and post two
different bodies with one key (the second silently replays the first); mark
`done` before the handler runs and make the handler throw (a failure is now
replayed forever). Restore after each.

### 3. `external_ref` and `metadata` — phase 1, three tables

| Column | Type | Rule |
|---|---|---|
| `external_ref` | `varchar(80)` nullable | The caller's own identifier. Partial unique index `(workspace_id, external_ref) WHERE external_ref IS NOT NULL`, per table. A duplicate is `409 external_ref_taken` whose suggestion names the existing `#seq`. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | A flat map of string to string. Limits declared once in `lib/limits.ts` and served by `/api/meta`: 50 keys, 40 characters per key, 500 per value, following Stripe's so that a caller migrating from it keeps its data. Nested values are refused at the write door. |

On `company`, `invoice` and `recurrence`. Both stay **writable after send**:
they are the caller's bookkeeping, not the document, so guard G2 does not
cover them. Changes are audited as `metadata.<key>` field paths.

**Lookup:** `?external_ref=` on each list route, returning zero or one row. The
`{ref}` resolver stays `#seq` then `number`; a third spelling would make every
error message longer for one caller's convenience.

**`bk`:** `--external-ref <id>` and `--meta key=value` (repeatable) on create
and edit; `--external-ref` on list.

### 4. The audit log as the event feed — phase 1, one query parameter

The customer's system needs to know when a bill was sent, paid or voided by
someone in the browser. The audit log already records every state change with
an actor and a monotonic `seq`. Make it pollable:

```
GET /api/workspaces/{ws}/audit?since=<seq>&limit=<n>
```

Rows with `seq > since`, ordered by `seq` ascending; `next_cursor` is the last
`seq` returned, or null. Each row carries `subject_type`, the subject's `#seq`
(its address), `action`, `field`, `from_value`, `to_value`, `ts`, `via`.

**Why a poller cannot miss a row.** Phase 1's counter is an upsert on
`billing.counters` inside the writing transaction. The upsert takes a row lock
on the `(workspace, 'audit')` row, so a second writer blocks until the first
commits or rolls back. Sequence order is therefore commit order, and no row can
appear behind a cursor a poller has already passed. Write this reasoning in the
query file; it is the property the whole feed rests on.

**The vocabulary** of `action` is served by `/api/meta` as
`vocabulary.audit_actions`, and the guide topic says *"run `bk meta`"*, never the
values.

**Push webhooks are later, and they sit on this feed.** They need something to
fire them, and phase 4's rule is that the app schedules nothing. The candidates
are a Vercel cron hitting an internal delivery route, or delivery attempted
inline on write with the feed as the retry ledger. Neither is decided, and
nothing in this milestone forecloses either. A signed payload
(`X-Billing-Signature`, HMAC over timestamp plus body) and a per-endpoint
delivery table are the shape when it comes.

**`bk`:** `bk billing audit list --since <seq>`.

### 5. Identity from environment — phase 0, three constants

The slug is `billing` everywhere and stays so: in the customer's extracted
product the schema is still `billing.*` and the group is still `<cli> billing`.
The extraction's `brand.json` ([`standalone-deployment.md`](standalone-deployment.md)
§2) rewrites the defaults below, and the environment overrides remain for
deploy-time variation. What varies is what a person sees:

| Constant today | Where it is hardcoded | Becomes |
|---|---|---|
| `APP_NAME` | `apps/books/lib/app.ts:40`, and the scaffold's `layout.tsx:11` has a literal title | `process.env.BILLING_DISPLAY_NAME ?? 'b/billing'`; `layout.tsx` reads `APP_NAME` |
| `contactEmail` | `apps/books/lib/email/send.ts:60` hardcodes `contact@blackcode.ch` | `process.env.BILLING_CONTACT_EMAIL ?? 'contact@blackcode.ch'` |
| `EMAIL_ACCENT` | `apps/books/lib/app.ts:61` | `process.env.BILLING_EMAIL_ACCENT ?? <the computed green>`; the 4.5:1 contrast rule still applies to the default and is documented for the override |

`RESEND_FROM_EMAIL` is already environment. The invoice PDF needs nothing: its
issuer block comes from the `company` row. Document all three in
[`env.md`](../env.md).

### 6. A rounding parity check — phase 1, optional

Two billing systems rounding differently is the oldest integration bug there
is. `POST …/invoices` accepts an optional `expected_total` (a string, like every
amount). If it is present and differs from the derived total, the create is
refused with `409 total_mismatch` carrying both numbers and nothing is
allocated. One field, one test, and the customer's system learns about a
rounding disagreement on the first bill rather than on the first complaint.

### 7. Tokens for a service, and what scopes are today

Two facts to state on the `/integration` page rather than build around:

- **A token belongs to a person.** `platform.api_tokens.user_id` is `NOT NULL`
  ([`schema.ts:550`](../../packages/platform-db/src/schema.ts#L550)). The
  customer's integration runs as a **service account**: a user created through
  the whitelist that nobody logs in as, invited as a member of the workspace,
  whose token their system holds. The audit log then names it, which is the
  point.
- **Scopes are stored and never read.** `scopes` defaults to `['full']` and
  the only file that mentions it is the minting code. The grep that established
  this searched `packages/platform-api/src` and `packages/platform-auth/src`
  for the word `scopes` outside `tokens.ts` and found nothing. A read-only key
  is therefore a platform change with a positive test in the shape finding #16
  demands, and it is not in v1. Say so on the page.

## Routes and CLI

Nothing new beyond phase 1's table, with these additions:

| Route | Change | Command |
|---|---|---|
| every allocating `POST` | honours `Idempotency-Key` | `--idempotency-key` |
| `GET …/audit` | `?since=`, `?limit=` | `bk billing audit list --since` |
| every list | `?external_ref=` | `--external-ref` |
| `POST …/invoices` | `expected_total` | `--expect-total` |
| `GET /api/meta` | `apps.billing.integration` block, anonymous half | `bk meta` |
| `/integration` | a page, not a route; reads the declaration | none needed, `bk meta` carries the same block |

## Done when

- [ ] `PUBLIC_ROUTES` exists, `/api/meta` serves it anonymously, and
      `contract_version` changes when one entry is added, observed by reading
      the hash before and after
- [ ] `/integration` renders on the local deployment with no session and shows
      every declared route and the conventions
- [ ] `lib/integration.test.ts` was watched failing on a declared route with
      no file, then on one with no `bk` claim
- [ ] Two `POST …/invoices` with one key produce one invoice; the same two with
      the unique index dropped produce two, observed, then restored
- [ ] Same key with a different body is refused; a concurrent pair yields one
      201 and one 409, asserted on the responses, not on a counter
- [ ] `?external_ref=` finds the row; a duplicate is refused with the existing
      `#seq` in the suggestion
- [ ] A poller reading `?since=` while twenty concurrent writes land collects
      every row exactly once
- [ ] `BILLING_DISPLAY_NAME=Acme` changes the title, the From line and the
      dashboard wordmark, and nothing else
- [ ] `docs/changelog/billing.md` has an entry naming the public surface and the
      stability promise; `docs/backend.md`'s "Internal" paragraph gains one
      sentence pointing at this decision

## Notes

- **Multi-tenant or standalone, the groundwork is the same.** Nothing here
  depends on whether the customer gets their own extracted product
  ([`standalone-deployment.md`](standalone-deployment.md)) or a workspace on
  ours. The declaration, the keys, the refs and the feed serve both.
- **Not built:** hosted invoice pages a client opens by link, push webhooks,
  scoped keys, rate limits. Each is additive on what is here.
- **The declaration is the only new hand-written list**, and it is one that
  has four readers and a test. That is the difference between it and the spec
  that was retired.
