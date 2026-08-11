# Backend — platform

> **2026-08-04 — this file was split along the platform/app line** (Phase 5 of
> `2026-08-platform-migration.md`). What stayed here is the **platform**: identity,
> workspaces, membership, per-app access, the shared content tables, the event
> spine, the `apiHandler`/`Errors` contract, the query-layer conventions.
>
> **The issue tracker's own schema, routes and `#number` model moved to
> [`apps/issues/docs/backend.md`](../apps/issues/docs/backend.md).** Root docs
> never describe an app's internals; an app's docs never describe another app
> (platform-architecture.md §7.5).
>
> **Paths in this file are relative to `apps/issues/`** where they name
> `lib/…`, `app/…` or `components/…`. Some of what is described here still
> physically lives in that app: `lib/auth.ts` (next-auth `authOptions`) stays
> there deliberately, and `lib/upload.ts` keeps the client-side uploader and this
> app's size cap. The rest of storage moved to `packages/platform-storage` in
> Phase 7. `cli/…` and `docs/…` are at the repo root.

> **Internal.** The HTTP API is private plumbing — **the only public contract is
> the `bk` CLI.** This document is for people working on this repo. Do not treat
> it as an integration guide, do not link external consumers to it, and do not
> reintroduce a published API spec. Agent-facing usage lives in `bk guide`
> (`cli/internal/guide/topics/platform/`).

How the shared server side fits together: the API conventions, the two
authentication paths, the workspace-scoped data model, per-app access, and the
event spine that powers activity/inbox/analytics. **Source of truth is the
code** — `lib/db/schema.ts` for the schema and `app/api/**` for routes; this doc
describes them as they are today.

## Table of contents

- [Stack](#stack)
- [Architecture at a glance](#architecture-at-a-glance)
- [Authentication & authorization](#authentication--authorization)
- [Database schema](#database-schema)
- [Per-app access](#per-app-access-phase-4)
- [The event spine](#the-event-spine)
- [API reference](#api-reference)
- [Query layer](#query-layer)
- [Cross-cutting concerns](#cross-cutting-concerns)
- [Adding new functionality](#adding-new-functionality)
- [Operational notes](#operational-notes)

**App docs:** [`apps/issues/docs/backend.md`](../apps/issues/docs/backend.md) ·
[`apps/issues/docs/frontend.md`](../apps/issues/docs/frontend.md)

## Stack

- **Next.js 16** App Router route handlers (`app/api/**/route.ts`).
- **PostgreSQL** via **Drizzle ORM** (`drizzle-orm` + `pg` Pool). Client in
  `lib/db/client.ts`, schema in `lib/db/schema.ts`, migrations in
  `lib/db/migrations/` managed by `drizzle-kit`.
- **NextAuth v4** (JWT sessions) for browser auth; custom `bk_live_…` bearer
  tokens for the API/CLI.
- **bcryptjs** (cost 12) for passwords, **Resend** for transactional email,
  **Vercel Blob** (with a local fallback) for uploads.

## Architecture at a glance

A typical authenticated request:

```
request
  → middleware.ts            (guards /dashboard/* for the browser only)
  → apiHandler(...)          (lib/api/handler.ts — a thin bind of the SHARED
                              wrapper in packages/platform-api/src/handler.ts)
      → resolveWorkspace()   (lib/api/workspace-context.ts — same)
          → resolveAuth()    (lib/auth/resolve.ts — bearer token OR session)
          → getWorkspaceForUser()  → { user, workspace, role }
      → query layer          (lib/db/queries/* — the only place that touches the DB)
          → recordEvent(tx)  (events spine, in the same transaction)
              → fanOutEvent(tx)          (this app's inbox rows)
              → recordPlatformEvent(tx)  (platform entity types — D-23)
                  → fanOutPlatformEvent(tx)
  → NextResponse.json(...)
```

Key principles:

- **Routes are thin.** They authenticate, validate input, call a query-layer
  function, and shape the JSON. Business logic lives in `lib/db/queries/`.
- **Every domain mutation records an event** in the same transaction (see
  [event spine](#the-event-spine)). There are deliberately **no DB triggers**.
- **Everything is workspace-scoped.** Access is decided by workspace
  membership; there is no global admin role.

### `apiHandler` and error model

#### Where it lives (changed 2026-08-06)

`apiHandler` and `resolveWorkspace` are **shared**. The implementations are
`packages/platform-api/src/handler.ts`; each app binds them once to its own
`AppContext` and re-exports them from `lib/api`, so every route file is written
exactly as before:

```ts
// apps/<app>/lib/api/handler.ts
export const apiHandler = createApiHandler(appContext)
```

`AppContext` (`packages/platform-api/src/app-context.ts`) is the whole of what a
shared handler needs from an app:

| Field | Why it cannot be defaulted |
|---|---|
| `appSlug` | who this deployment IS. It tags `platform.error_events.app` and `platform.uploads.app`, prefixes blob paths (`<app>/<workspace>/<file>`), and keys `platform.blob_references` — so it is the answer to "who wrote this row?" wherever a shared table still carries rows from more than one app |
| `db` | a Drizzle client typed to the platform tables; every app's is a superset. **Supply it as a getter if the app's client is lazy** — `next build` imports every route module |
| `workspaces` | **where this app's workspaces live** (2026-08-10). A `WorkspaceSource`: **six** methods over one subject — resolve one for a caller, list them, one by id, its members, and the default workspace's read/write. (It was seven until 2026-08-10: `assertAppAccess` went with `platform.app_access`, and a method every app implements as an empty function is not a seam.) `apps/issues` supplies `platformWorkspaceSource(db, APP_SLUG)`; `apps/sales` supplies its own over `sales.*`. **Required, with no platform default** — a default would mean an app that never answered the question serves, correctly and silently, against another app's tenancy |
| `uploads` | **where this app records its uploads** (2026-08-10, Phase 3). An `UploadLedger`: attribute a file to a workspace, and write the ledger row. `apps/issues` supplies `platformUploadLedger(db, APP_SLUG)`; `apps/sales` writes `sales.uploads`. **Required, with no platform default** — the cross-app delete gate asks an app whether a file is still in use, and an app writing its rows into another app's ledger would be asked the wrong question. **The STORE does not split**: one Blob store, one quota, one `platform.blob_references` |
| `resolveUser` | the browser half is app-specific (next-auth config) |
| `resolveSessionUser?` | session-ONLY, for `/api/tokens`. A separate field because a bearer token minting a bearer token is privilege escalation; the routes that need it throw at mount time rather than falling back |
| `manifest?` | `X-BK-Help` / `X-BK-Changelog`. Omitted by an app with no agent landing page — a breadcrumb pointing at a 404 is worse than none |
| `redactBody?` | omit request-derived payload from `error_events.context` (D-19) |

The bar for a new field is high: every one is a thing each future app must supply
forever. `schema` was in the original sketch and was dropped — shared code cannot
type against an app's schema.

> **`workspaces` is the field that made the last sentence of that paragraph stop
> being true.** It used to end "…and every table these routes touch is
> `platform.*`". That held only because every app's workspaces were in the same
> table. `AppContext.workspaces` is the seam that replaced it: shared code still
> never names an app's table, it asks the app. Seven methods rather than one
> resolver because several shared entry points read tenancy, not one —
> `/api/meta` resolves a default and lists members, `bk issues workspace use` writes
> one, upload attribution reads one by id. A single resolver would have left
> every one of those still naming `platform.*`: a seam that looks finished and is
> not. See `packages/platform-api/src/workspace-source.ts`.
>
> Creating, renaming and deleting a workspace, membership writes and the whole
> invitation state machine are deliberately NOT in it. They carry an event spine,
> a cascade and a token lifecycle, and an app that owns its tenancy writes those
> routes itself.

**Platform route factories** live beside it, in
`packages/platform-api/src/routes/`. A shared route is mounted in three lines:

```ts
import { searchRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
export const GET = searchRoute(appContext)
```

A factory serving several methods returns an object; unpack it one line at a
time (`export const GET = handlers.GET`), never `export const { GET } = …` — the
parity guard matches `/export\s+(const|function)\s+GET\b/`, so a destructuring
export serves fine while silently dropping out of coverage.

#### Three classes of shared route (D-22)

Not every route is equally shareable, and the classification is by what a route
reaches **transitively**, not by what its own import block names. That is the
mistake worth naming: `/api/workspaces/{ws}/activity` looked like a pure factory
until `resolveEventEntitySeqs` turned out to read `issues.*` two calls down.

| Class | Shape | When |
|---|---|---|
| **A** | `factory(ctx)` | nothing app-specific. Most routes |
| **B** | `factory(ctx, contribution)` | a named, typed thing only the app can supply |
| **C** | the app writes the route | the app-specific part *is* the route |

> **`events` is on the CONTRIBUTION and not on AppContext, and the difference
> from `workspaces` / `uploads` is the rule working rather than an
> inconsistency.** Those two are read by several entry points — the request
> layer, `/api/meta`, upload attribution — so an app must answer for them before
> it serves anything. The event source is read by exactly ONE route, and an app
> that does not mount the activity feed should not have to say where its events
> live. Required *within* the contribution, though: a default of
> `platform.events` would mean an app serving another app's feed for a workspace
> id that means a different team.

**Class B takes a second argument — AppContext does not grow callbacks.**
AppContext is what every app supplies for every route, so a field two routes read
is a tax every future app pays to mount neither of them, and omitting it fails
invisibly. A second argument is explicit, typed, local to the route, and free to
an app that does not mount it. Two worked examples, and they are worth reading as
a pair because the contribution is a different KIND of thing in each:

| Route | Contribution | Why only the app can supply it |
|---|---|---|
| `.../activity` | `events` + `resolveEntitySeqs` | the feed's TABLE is `platform.events` for issues and `sales.events` for sales; and turning an `entity_id` into a #number means reading `issues`/`tasks`/`projects` |
| `/api/me/password/request-otp` | `sendPasswordResetEmail` | a message carries an app's name, from-address and branding. There is no platform-branded email |
| `.../invitations` (POST) | `sendInvitationEmail` | same reason. A person invited from sales must not receive "Blackcode Issues invited you" |

Two of the three are an email, and both times **only the sending is contributed.**
The OTP's length, expiry, attempt cap and rate limit are platform; so are the
invitation row, its token, the whitelist gate and the event. One login and one
workspace serve every app, so letting each write its own rules against one shared
credential means the weakest sets the floor. **Contribute the part that is
genuinely yours, not the operation around it.**

> **A convention can be cheaper than a contribution.** The invitation accept link
> is `<the serving app's origin>/invitations/{token}`, built by the factory — not
> a second knob. An app that mounts the route owes that page. Adding a parameter
> for a value no app has yet wanted differently is the "parameter added to make it
> generic" case; the day one does want it, it becomes a contribution then.

**Class C is `/api/meta`.** Its vocabulary is not a contribution to a shared
route; it is the reason the route exists, and §7.4 requires that two apps'
vocabularies never merge into one list. Each app writes the route and calls
`platformMetaBlock(ctx, req, user, { currentApp })` for the identical half.
The app builds its own `vocabulary`/`limits`/`media` object once and uses it in
both the nested and the deprecated top-level position, so the two are the same
reference by construction rather than by discipline.

Why factories at all: every platform verb's route used to live physically inside
`apps/issues/app/api/**`. With one app that was invisible; with two it means an
app 404s on its own `/api/me`, `bk upload` attributes files to whichever app
served the request, and a user granted one app and not another gets 403 on
`bk issues search`. See `docs/sales-app-plan.md` B-2 / D-2.

#### The error model

`apiHandler(fn)` wraps a route handler and converts any thrown error into a
canonical JSON body:

```jsonc
{ "error": "human message", "code": "machine_code", "suggestion"?: "...", "details"?: {...} }
```

- Throw an `ApiError` (via the `Errors` factory) for expected client errors.
- `4xx` ApiErrors are returned as-is and **not** logged.
- `5xx` and any non-`ApiError` throwable are logged to the `error_events` table
  (with route, method, status, sanitized context — see
  [`sanitize.ts`](#error-responses--sanitization)) and surfaced as a generic
  500.
- Every logged row carries **`app`** — the serving deployment, stamped from
  `AppContext.appSlug`, never from a call site (migration `0044`). It is not
  decoration: `error_events.workspace_id` has no foreign key, and once each app
  owns its workspaces the same id means different things in different apps, so
  the workspace is only readable together with the app. `insertErrorEvent`
  requires it in its parameter type; `apiHandler`'s own writer is raw SQL with
  no type over it and is covered by
  `apps/issues/lib/api/error-events-app.test.ts` instead — it swallows its own
  failures, so a broken INSERT there stops the error log with no other symptom.

The `Errors` factory (`lib/api/errors.ts`):

| Call | Status | Code |
|------|--------|------|
| `Errors.unauthorized(msg?)` | 401 | `unauthorized` |
| `Errors.forbidden(msg?)` | 403 | `forbidden` |
| `Errors.notFound(entity)` | 404 | `${entity}_not_found` |
| `Errors.badRequest(code, msg, details?)` | 400 | _custom_ |
| `Errors.conflict(code, msg, details?)` | 409 | _custom_ |
| `Errors.unprocessable(code, msg, details?)` | 422 | _custom_ |
| `Errors.tooManyRequests(msg?)` | 429 | `too_many_requests` |
| `Errors.internal(msg?, details?)` | 500 | `internal_error` |

## Authentication & authorization

### Two ways to authenticate

`resolveAuth(req)` (`lib/auth/resolve.ts`) returns `{ user, via }` or `null`,
checking in order:

1. **Bearer token** — `Authorization: Bearer bk_live_…`. Verified by
   `verifyToken()` (`@blackcode/platform-auth`, wrapped by `lib/auth/tokens.ts`).
2. **Session cookie** — a NextAuth JWT, validated by `getValidatedSessionUser()`
   (`lib/auth/session.ts`).

`resolveUser(req)` is the convenience wrapper that returns just the `User`.

### NextAuth (`lib/auth.ts`)

- **Strategy:** JWT (no server session table).
- **Providers:**
  - **Credentials** — email + password. Verifies with `verifyPassword()`
    (bcrypt) and stamps `last_login`.
  - **Google** — registered **only if** `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET` are set.
- **On first sign-in** the `signIn`/`jwt` callbacks upsert the user, ensure a
  default workspace, and materialize any pending email invitations.
- The JWT carries `id`, `pwStamp` (a snapshot of `password_changed_at`), and `isSuperAdmin` (derived from the `SUPER_ADMINS` env var at sign-in time).

**Session invalidation on password change:** `getValidatedSessionUser()`
re-checks that the user still exists, is not soft-deleted, and that the token's
`pwStamp` still matches `users.password_changed_at`. Resetting a password bumps
that column, so **every existing browser session is invalidated**. API tokens
are a separate credential and are unaffected.

### API tokens (`@blackcode/platform-auth`)

- Plaintext format: `bk_live_` + 32 random bytes (base64url). **Shown once.**
- Stored as `token_hash` (SHA-256) plus a `token_prefix` for display; verified
  with a timing-safe comparison; `last_used_at` is updated on use; optional
  `expires_at` is honored.
- Sent as `Authorization: Bearer <token>`.

**CLI authorize flow** (`POST /api/cli/authorize`,
`app/api/cli/authorize/route.ts`): the browser, already signed in, posts a
loopback `callback` + `state`; the server mints a token and returns a
`redirect_url` pointing back at the CLI's local listener with the token. Only
`http://localhost` / `127.0.0.1` / `[::1]` callbacks are accepted.

### Passwords & reset

- `@blackcode/platform-auth` — `hashPassword`/`verifyPassword` (bcryptjs, 12
  rounds), plus length validation (8–200 chars).
- `lib/db/queries/password-reset.ts` — OTP flow. A short code is emailed (via
  Resend), stored only as a hash in `password_reset_otps`, capped at 5 attempts,
  rate-limited per email, and expires fast. Drives both the logged-out
  "forgot password" flow and the in-app Settings → Account flow.

### Workspace authorization

`resolveWorkspace(req, wsSlugOrId)` (bound in `lib/api/workspace-context.ts`;
implemented in `packages/platform-api/src/handler.ts`) returns:

```ts
{ user: User, workspace: Workspace, role: 'owner' | 'member' }
```

It authenticates the user, then loads the workspace **and the caller's
membership** in one step. If the workspace doesn't exist *or* the user isn't a
member it throws `notFound` (404, not 403 — so we don't leak existence).
`requireOwner(ctx)` throws `forbidden` unless `ctx.role === 'owner'`.

Membership is the whole of it. A **second gate** ran here from Phase 4 until
2026-08-10 — `requireAppAccess`, a 403 `app_access_denied` unless the caller could
use *this app* in that workspace — and it went with `platform.app_access`: these
are this app's own workspaces, so a member of one is a user of this app. See
"Per-app access — REMOVED" below.

> **Super admin** is env-based, not DB-based. Set `SUPER_ADMINS=email1,email2` in
> the environment. Super admins bypass the access whitelist and get a "Super Admin"
> section in the sidebar with platform-wide views. Guard API routes with
> `requireSuperAdminUser(req)` from `lib/api/super-admin-guard.ts`.
>
> All workspace-level authority is workspace membership +
> `workspace_members.role` (`owner` | `member`). The old `users.role` column
> was dropped in migration `0012`.

## Database schema

Defined in `lib/db/schema.ts` (Drizzle). Grouped by concern below; see the file
for exact column types, indexes, and check constraints.

### Identity & access

| Table | Purpose / notable columns |
|-------|---------------------------|
| `users` | `email` (unique), `password_hash`, `google_id`, `avatar_url`, `tagline`, `active_workspace_id` (soft FK), `password_changed_at`, `deleted_at` (soft delete — email can be reused) |
| `workspaces` | `name`, `slug` (unique), `owner_id`, `logo_url`, `deleted_at` |
| `workspace_members` | `(workspace_id, user_id)` unique; `role` ∈ `owner` \| `member` |
| `workspace_counters` | per-workspace sequence allocators: `last_issue_seq`, `last_project_seq`, `last_task_seq` (allocated in-transaction by `allocateNext*Seq`) |
| `workspace_invitations` | `email`, `token` (unique), `role`, `status` ∈ `pending`/`accepted`/`revoked`/`expired`/`declined`, `expires_at`, `app` (**no reader since 2026-08-10** — it named the app to also grant on accept; new rows are NULL, historical rows kept) |
| `apps` | the app ADDRESS BOOK (migration `0034`). `slug` PK — the same slug used in the CLI namespace and guide folders, so a surrogate id would just make every one of those unreadable. `name`, `description`, `base_url`, `enabled` (platform-wide kill switch), `maintains_blob_index`. This is what `/api/meta`'s `apps` block and `bk app list` report |
| ~~`workspace_apps`~~, ~~`app_access`~~ | **DROPPED 2026-08-10** (migration `0045`). The per-app gate — see "Per-app access — REMOVED" below |
| ~~`transaction_log`~~ | **DROPPED 2026-08-10** (migration `0045`). No writer since before the monorepo; `/api/undo` has been a 410 since 2026-08-05 |
| `api_tokens` | `token_hash` (unique), `token_prefix`, `scopes` (default `['full']`), `expires_at`, `last_used_at` |
| `password_reset_otps` | `email`, `otp_hash`, `expires_at`, `consumed_at`, `attempts` |
| `email_whitelist` | Platform access control (migration `0023`). `type` ∈ `email` \| `domain`; `value` is the address or domain; `added_by` FK to users. Active only when `SUPER_ADMINS` env var is set. |

### Shared content tables

These look like issue-tracker tables and are not — a sales app would need every
one of them unchanged, which is the test that put them in `platform.*`.

| Table | Purpose / notable columns |
|-------|---------------------------|
| `comments` | **polymorphic and app-qualified**: `parent_type` is `<app>:<noun>` (`issues:issue`, `sales:prospect`) since `0041`, plus `parent_id`; `content`, `mentions` (int[]), `edited_at`. The CHECK validates the shape, not the vocabulary — see `packages/platform-db/src/qualified-type.ts`. **Routes still return the BARE noun** (`parent_type: "issue"`): the path already names the app, and `deletion_batches.root_type` is compared client-side against a bare `type`. The legacy bare values are accepted for one more release. The legacy `issue_id` column was dropped in migration `0032` — it was a platform→app FK that would have broken `pg_dump --schema=issues` |
| `uploads` | **upload ledger** — one row per file stored through our pipeline, written at upload time: `workspace_id` (nullable), unique `url`, `pathname`, `filename`, `size` (bigint), `mime_type`, `uploaded_by`, `app` (FK → `apps.slug`, nullable, `ON DELETE set null`). Metadata only — never the authority for deletion (a live reference scan is); source for the Storage page. `app` is the ATTRIBUTION — never derive it from `pathname`, which records where a file physically is (pre-Phase-7 files sit flat at the store root) |
| `labels` | **workspace-level and app-scoped** (`workspace_id`), `name`, `color`, `created_by`, `app` (FK → `apps.slug`, nullable, `ON DELETE set null`, since `0043`). Set = scoped to that app; `app IS NULL` = **shared** with every app in the workspace. `0043` backfilled every existing row to `issues`, so NULL has no instances today — sharing is a deliberate `SET app = NULL` on one label, never a default. Every label read on a deployment is filtered to `app IS NULL OR app = <that app>` — **all** of them, not only the list route, or `bk <app> label` promises a scoping the data does not do |

### Cross-app primitives (Phase 6)

Two tables and one generalisation. These are what make a second app worth
having: everything before them was rearrangement, this is the first capability
that cannot exist with one app per database.

| Table | Purpose / notable columns |
|-------|---------------------------|
| `entities` | the cross-app index of what exists. `urn` PK (`bc:<app>:<workspace-slug>/<entity-type>/<number>`), `app`, `workspace_id`, `entity_type`, `number` (the workspace #number, never the row id), `title`, `url`, `updated_at`, `deleted_at`. **A projection** — each app's own tables are the truth |
| `links` | typed relations between two URNs, in any two apps. PK `(from_urn, to_urn, rel)`; both ends FK into `entities` **ON UPDATE CASCADE ON DELETE CASCADE**; `created_by`, `created_at`; CHECK forbids a self-link |
| `events` | gains `app` (nullable, FK → `apps.slug`) and `subject_urn` (nullable, **no FK**). See below |

**`entities` has two keys, and the distinction is load-bearing.** `urn` is the
primary key because it is what links point at and what agents pass around. But a
URN embeds the workspace slug and slugs are editable, so the *stable* identity is
the unique `(workspace_id, app, entity_type, number)` — and that is what upserts
conflict on. Renaming a workspace therefore **rewrites** the existing row's URN
rather than creating a second one, and `links`' ON UPDATE CASCADE carries the
relations along. "A link survives a rename" is a property of the schema, not of
any code path remembering to do it.

**`links` cascades on delete, `entities` does not.** A soft delete (the recycle
bin) sets `entities.deleted_at` and keeps the row, so a link into the bin still
resolves and comes back on restore. Only a **purge** removes the `entities` row,
and its links go with it — a relation to something that exists nowhere is a
dangling pointer, not a fact.

**`events.app` is nullable on purpose.** Migration 0035 lands *before* the deploy
that writes the column (the cutover pattern), so for the length of that window the
old code is still inserting rows that do not know it exists. `NOT NULL` would fail
every one of those inserts; `DEFAULT 'issues'` would hardcode one app's name into
a platform table, which is the coupling this work removes. It is backfilled, all
current code sets it, and it tightens to `NOT NULL` in a later release once no
deployed code can write a NULL — expand → migrate → contract
(platform-architecture.md §4.7). `subject_urn` has **no** foreign key because
events are append-only history and must outlive a purge of their subject.

The data-layer helpers are in `packages/platform-db/src/{urn,entities,links}.ts`.
The app's half — its URL scheme, its source tables, and the reconciler — is
`apps/issues/lib/db/queries/entities.ts` plus the pure
`apps/issues/lib/entity-address.ts`. Platform must never learn where an issue
lives in the dashboard, which is why `path` is supplied by the app and only the
`base_url` glue is shared.

**The rule for every write path:** `projectEntity` and friends take the caller's
transaction handle and never open one. A projection written outside the source
write's transaction commits even when that write rolls back, and the result is an
index row for something that does not exist — invisible until somebody clicks
through to a 404 weeks later. `entities.integration.test.ts` asserts the
rolled-back case directly.

**Formatting a URN on a write path uses the fail-soft variants**
(`formatUrnOrNull` / `entityUrnOrNull`). The index must never be able to take
down the thing it indexes: a strict formatter deep inside `recordEvent` turned an
ordinary delete into a 500 during Phase 6 verification. An unaddressable row
loses its projection and is reported as `missing` by the reconciler; it does not
fail the write.

**Reconciliation.** `reconcileEntities()` re-derives the projection from the
source tables and reports `missing` / `stale` / `orphaned`, optionally repairing.
Exposed at `GET`/`POST /api/super-admin/entity-drift` → `bk super-admin
entity-drift [--repair] [--workspace <slug>]`. It shipped in the same phase as
the projection because there is exactly one writer today — the only window in
which a difference it reports is unambiguously a bug in that writer rather than a
race with another one. **A repair that changes something is a bug report, not
maintenance.**

### The blob reference index (Phase 8)

| Table | Purpose / notable columns |
|-------|---------------------------|
| `blob_references` | who points at which stored file, across apps. PK `(app, source_type, source_id, url)`; `workspace_id` (nullable, no FK). `app` is `'platform'` for platform-owned content (comments), which belongs to no single app |

**Why it exists.** Phase 7 made blob deletion require a proven negative from
*every* enabled app. Per-app Postgres roles make that proof unobtainable across
deployments — the `issues` deployment cannot read `sales.*` — so with a second
app, deletion would have refused everything. This index is how an app proves its
own references to the others without exposing its tables. `platform.apps
.maintains_blob_index`, set by the app's own migration, is the declaration that
it does so; an app with neither a locally-registered scanner nor that flag is
still an **error**, never a `false`.

**It is maintained by Postgres triggers, and that is not an implementation
detail.** The reflex is to write it from application code in the source write's
transaction — the `entities` pattern above. The risk profiles are not the same:

| Projection | Drift costs |
|---|---|
| `entities` | a stale title in `bk issues search`. Cosmetic |
| `blob_references`, **extra** row | a refused delete. Leaked bytes, never data |
| `blob_references`, **missing** row | a file still in use is reported as an orphan and **deleted**. Vercel Blob `del()` has no undo |

So the dangerous direction is "a write path forgot", and application-level
maintenance makes that both possible and silent. Triggers fire for every write
regardless of which code, ORM or psql session did it, so no write path can be
forgotten. What stays forgettable is adding a *new content column* without a
trigger — a one-time, checklist-sized surface (`docs/adding-an-app.md`).

The price is one duplication: migration `0037` reimplements the URL recognizer
from `packages/platform-storage/src/assets.ts` in SQL
(`platform.extract_uploaded_urls`, `is_uploaded_asset`, `blob_url_host`).
`apps/issues/lib/storage/sql-parity.integration.test.ts` runs one adversarial
corpus through both and fails on a single disagreement. Change one, change the
other.

**App roles hold `SELECT` and nothing more.** The trigger function is
`SECURITY DEFINER` and owned by the migrator, so the only writer is the trigger
and no app can forge or erase another app's references. `docs/sql/app-role.sql`
step 5b revokes the DML that `ALTER DEFAULT PRIVILEGES` would otherwise hand a
new app role. The single sanctioned delete is
`platform.blob_refs_purge(app, type, id)`, which the reconciler uses for orphans
and which refuses a caller naming an app that is not its own.

**Reconciliation.** `reconcileBlobReferences()` (`apps/issues/lib/storage/drift.ts`)
compares the index against a live scan, at `GET`/`POST /api/super-admin/blob-drift`
→ `bk super-admin blob-drift [--repair] [--workspace <slug>]`. It matters more
than `entity-drift`: every future app will have the index and no scanner, while
`issues` has both, so this is the standing proof — run by the only app that can
run it — that the mechanism everything else depends on works. A `missing` row is
repaired by re-triggering the source (`UPDATE t SET col = col`), which is the only
repair that cannot disagree with the trigger, because it *is* the trigger.

The report also carries `unreconciled_count`: index rows no workspace pass could
reach (`workspace_id` null, or a workspace that is gone). Not drift — rows nobody
looked at. It exists because every `attachment` row was in exactly that state when
the index was first built (`issues.attachments.workspace_id` had never been
backfilled; `0037` repairs it), and the report cheerfully said "no drift" over a
fifth of the index.

### App-owned tables

The ten work-item tables (`issues`, `tasks`, `projects`, `project_updates`,
`issue_assignees`, `issue_watchers`, `issue_labels`, `project_labels`,
`project_members`, `attachments`) live in the **`issues` Postgres schema** and
are documented in **`apps/issues/docs/backend.md`**, not here — root docs do not
describe an app's internals (platform-architecture.md §7.5). The same goes for
their status/priority vocabularies.

An app may FK into and query `platform.*` freely; it may not read or write
another app's schema, and the per-app Postgres roles make that a database
guarantee rather than a convention.
## Per-app access — REMOVED 2026-08-10 (multiAppFinalRefactor Phase 5)

**Membership is the whole gate.** Two levels decide what a person can reach:

| Level | Table | Means |
|---|---|---|
| identity | `platform.users` | your account — one login, every app |
| membership | `platform.workspace_members` | you are in one of THIS app's workspaces |

`platform.workspace_apps` and `platform.app_access` are **dropped** (migration
0045), along with `requireAppAccess`, `WorkspaceSource.assertAppAccess`,
`isAppAccessEnforced`, the `PLATFORM_ENFORCE_APP_ACCESS` switch, the four
`/api/workspaces/{ws}/apps**` routes, `listMyWorkspaces`' `{ app }` filter, the
`scopedToApp` argument, and `?all=1` on `GET /api/workspaces`.

**Why, in one sentence.** They gated an app INSIDE a workspace that several apps
shared; each app owns its workspaces now, so a workspace belongs to exactly one
app and its members ARE that app's users. The gate was approximating an
equivalence that has since become structural.

It was not merely redundant by the end. A grant row named a `platform.workspaces`
id for an app whose workspaces had moved to its own schema, so `/api/meta` told a
brand-new issues signup that `apps.sales.workspaces` held their platform
workspace — a workspace `apps/sales` itself answers 404 for.

**This app's identity** is still `APP_SLUG` in `lib/app.ts` (`'issues'`), and it
still lives in the app rather than in a platform package: a platform package that
knew the slug would be a platform package that knew about one app. What changed is
that `platformWorkspaceSource(db)` no longer takes it — nothing inside was per-app
once the gate went, and a parameter every caller supplies and nobody reads is the
friendly shape of the problem CLAUDE.md is about.

**The package split the gate established still stands**, and it is the rule for
anything added later: **`platform-db` queries · `platform-api` enforcement and
errors · `platform-auth` identity only, no HTTP.** (`requireAppAccess` moved from
platform-auth to platform-api on 2026-08-06 because `platform-auth` importing
`Errors` was the one edge that made the package graph a cycle.)

### What replaced the invariants

The gate carried three guarantees. Two are gone because what they guarded is
gone; one moved down a layer and got stronger.

- ~~*A membership row that commits without its `app_access` row is a person who
  is a member of a workspace they cannot open.*~~ There is no second row. The
  `workspace_members` INSERT is the whole of joining, so the two INSERT sites
  (`createWorkspace`, `acceptInvitation`) can no longer commit half-done. Both
  dropped their grant call; `acceptInvitation` no longer returns `apps_granted`.
- ~~*Removing a member removes their access; access without membership is
  impossible.*~~ Both were `app_access`'s composite FK to
  `workspace_members(workspace_id, user_id)`, and both are vacuous now.
- **An app cannot read another app's tenancy** — this is the one that matters,
  and it is a Postgres grant, not a check: each app's role has no privilege on
  another app's schema (`docs/platform-db.md`). That is also why reachability is
  no longer derivable centrally, and why `/api/meta`'s `apps` block became the
  address book rather than a grant list.

**`workspace_invitations.app` has no reader.** It named the app an invitee was
being invited INTO, and drove `alsoGrantApp`. The column and its historical rows
are kept — dropping a column on a live table for tidiness is what PLAN.md §2
warns against — but nothing writes it (new rows are NULL) and nothing reads it.
Worth a decision in a later phase, not a silent removal here.

## The event spine

`lib/db/queries/events.ts` defines `recordEvent(tx, input)` — called **inside
the same transaction** as every domain mutation. `EntityType` and `EventAction`
are TypeScript unions (e.g. `assigned`, `status_changed`, `commented`,
`mentioned`, `member_added`, `invitation_created`, …).

Each recorded event is handed to `fanOutEvent(tx, event)`
(`lib/db/queries/fanout.ts`), which materializes per-user `inbox_messages`
according to the event type (assignees, watchers, mentioned users, invitees).
`createInboxMessage` writes those rows with a short dedup window so rapid status
flips don't spam the inbox.

### The seam: two recorders, one table (D-23)

`platform.events` is one table, but writing to it splits cleanly in two, and
since 2026-08-06 it is split:

| | writes | lives in |
|---|---|---|
| **`recordPlatformEvent(tx, { app, … })`** | `workspace`, `workspace_member`, `workspace_app`, `invitation` | `packages/platform-db/src/events-write.ts` |
| **`recordEvent(tx, …)`** | that app's own entity types | each app's `lib/db/queries/events.ts` |

An app's `recordEvent` **delegates** the platform types, in one place, passing
its own `APP_SLUG`. No call site knows which half it reached.

> **An app that owns its own tenancy does not delegate, and that is the seam
> dissolving rather than moving (2026-08-10, Phase 3).** The delegation exists
> because a workspace, a membership and an invitation are PLATFORM subjects. For
> `apps/sales` they are `sales.workspaces`, `sales.workspace_members` and
> `sales.invitations` — its own rows, in its own schema — so its `recordEvent`
> writes every entity type into `sales.events` and calls
> `recordPlatformEvent` not at all. The two VOCABULARIES are still imported from
> `platform-db` rather than restated, for rule 2 below, which is the part that
> was ever load-bearing. `apps/issues` and `apps/_scaffold` are unchanged: their
> workspaces are `platform.workspaces`, so their platform events belong in
> `platform.events`.

**Why the split is clean rather than a compromise.** The app half of the recorder
does exactly two app-specific things, and a platform event needs neither:

- `resolveSubjectUrn` returns null for every entity type except
  issue/task/project — in a literal early return, before it touches a table. So
  `subject_urn` is null for every platform event, and that is the *answer*, not a
  gap: a workspace or a membership has no cross-app address.
- the fan-out rules are written in an app's nouns. The five platform handlers —
  invitation created, member added, member removed, ownership transferred,
  invitation accepted — reference **no** app table, which is why they moved to
  `packages/platform-db/src/fanout-platform.ts` along with `createInboxMessage`.
  All 18 app-table references were in the handlers below that file's
  `--- issue fan-out handlers ---` line, and that is where the switch was cut.

**Two rules that are load-bearing, not stylistic:**

1. **An app must not also route the five platform actions through its own
   `fanOutEvent`.** `recordPlatformEvent` fans out its own events; a case in both
   switches delivers every invitation notification twice.
2. **The platform vocabulary is declared once**, beside the writer
   (`PLATFORM_ENTITY_TYPES` / `PLATFORM_EVENT_ACTIONS`), and the activity route
   imports it. Two copies drift silently, because `parseList` in that route
   *drops* an unrecognised filter rather than rejecting it — so a value the
   writer can produce and the route has not heard of returns the whole feed. That
   is not hypothetical: Phase 4's `app_*` actions were missing there for months.

**`createWorkspace` and `ensureDefaultWorkspace` did NOT move**, and should not.
Each app has an app-specific post-create step — issues inserts
`issues.workspace_counters` — and an app-specific statement inside a shared
function is how the boundary rots. They stay per-app and call the shared
recorder.

The seam is guarded by `apps/issues/lib/db/queries/platform-event-seam.test.ts`.

**Coalescing.** Generic `updated` events (title/description/etc. edits on
issues/tasks/projects) pass `coalesceWindowMs: UPDATE_COALESCE_WINDOW_MS` (10
min) to `recordEvent`. When the same actor records another `updated` on the same
entity inside that window, the existing row is merged in place — earliest
`before`, latest `after`, advanced `occurred_at` — instead of inserting a new
row. This keeps autosave (which PATCHes every ~1.2s while typing) from flooding
the activity feed. Only safe for actions that **don't** fan out to the inbox
(`updated` hits the `default` case in `fanOutEvent`); never enable it for
discrete events like `status_changed` or `assigned`.

**Cross-app tagging (Phase 6).** `recordEvent` sets `app` to this app's slug on
every event, and derives `subject_urn` from `(entityType, entityId)` via
`resolveSubjectUrn`. Both are resolved in `recordEvent` rather than at the ~40
call sites: one of them forgetting would be a hole in the feed that nothing would
ever report. `app` means the **producing** app — a workspace or member event
recorded by this deployment is an issues-app event, because that is what wrote it,
and the same event recorded from the sales deployment is a *sales* event. That
survives the seam above because the app slug is a parameter to
`recordPlatformEvent`, never a default: a platform package with a default app
name would be a platform package that knew about one app.
`subject_urn` is null for subjects that are not projected entities (a comment, a
label, a member, an invitation), which is an answer rather than a gap. Pass
`subjectUrn` explicitly only when the subject row is already gone by the time the
event is recorded — and only for an app's own entity types; the platform half
takes neither `subjectUrn` nor `coalesceWindowMs`, and `recordEvent` throws
rather than dropping either in silence.

This single spine is read by:

- **Activity feed** (`activity.ts`, `/api/workspaces/{ws}/activity`) — now
  cross-app: `?since=24h` (relative window; mutually exclusive with `from`),
  `?app=`, `?subject_urn=`,
- **Inbox** (`inbox.ts`, `/api/me/inbox`),
- **Analytics** (`analytics.ts`),
- **Federated search** (`/api/workspaces/{ws}/search`) — reads `entities`, not
  events, and deliberately touches no app's own tables: another app's schema is
  unreadable to this app's Postgres role, so a per-app fan-out is refused at the
  database rather than merely being slower.

### Analytics contract (`analytics.ts`)

`computeAnalytics(input)` returns one `AnalyticsPayload` for the requested
**view** (`workspace` | `project` | `task` | `member`) + optional target
`id` + date window + faceted filters. Everything is workspace-scoped (no
cross-workspace leakage) and computed live (no materialized views) — fine up to
~100k events/workspace.

Query params on `GET /api/workspaces/{ws}/analytics`:

- `view`, `id` — scope. `id` required for non-workspace views.
- `from`, `to` — ISO timestamps. Omitted ⇒ all-time snapshot, with series/
  throughput defaulting to the last 30 days.
- `interval` — `day` (default) | `week`; controls time-series bucket width.
- `status`, `priority`, `label`, `assignee` — **faceted filters**, repeatable
  and/or CSV (`?status=todo&status=done` or `?status=todo,done`). Appended as
  `AND` clauses to every issue query so all charts stay mutually consistent.
  `priority` is 1–5; `label`/`assignee` are ids.

Payload sections: `summary` (snapshot counts + overdue/unassigned/completion
rate/avg+median cycle time/open estimate), `trends` (created/completed/cycle
time/active members vs. the previous equal-length window — `null` for all-time),
distributions (`by_status`, `by_priority`, `by_assignee` incl. per-assignee avg
cycle, `by_label`, `by_project` for workspace/member views), time series
(`velocity_series`, `activity_series`), histograms (`cycle_time_buckets`,
`aging_buckets`), `activity_by_action`, `top_active_members`, and — task
view only — `burndown_series` (`remaining` vs. a straight-line `ideal`).

## API reference

> **This section is a map for maintainers, not a contract.** These routes are
> private plumbing: the `bk` CLI is their only supported client, and it is the
> only interface agents use. Do not point external consumers at them, and do not
> treat any shape here as stable — the whole point of retiring the OpenAPI spec
> was that changing a route and its CLI command together, in one commit, no
> longer breaks anybody. Every route must be reachable from `bk`
> (`lib/cli-parity.test.ts` fails the build otherwise). See
> [`docs/cli.md`](./cli.md).

### Conventions

- All handlers are wrapped in `apiHandler`. Mutations validate input and throw
  `Errors.badRequest(...)` on bad shapes.
- Workspace-scoped routes resolve `{ ws }` (slug **or** numeric id) via
  `resolveWorkspace`.
- **All list endpoints return `{ data, next_cursor }`** — `next_cursor` is a
  numeric cursor to pass back as `?cursor=`, or `null` when there are no further
  pages (including inherently unpaginated lists). Some lists also include
  `total`. Build the body with `jsonList()` (`lib/api/responses.ts`) so the
  envelope can't drift. Single resources return the bare entity object.
- **Mutations:** create → `201` + the created entity; update → `200` + the
  updated entity; delete → `200` + `{ deleted: true }` (plus `mode` where the
  resource cascades, e.g. projects/tasks).
- **Rich-text fields** (issue/project descriptions, comments, project-update
  bodies) accept **Markdown or HTML** and are normalized to **sanitized HTML** on
  write via `lib/rich-text.ts` (`toRichTextHtml`), applied in the query layer so
  every surface benefits. Markdown is converted (and a common agent mistake —
  literal `\n` instead of real newlines — is tolerated); existing HTML (web
  editor) is sanitized too, and both paths are sanitized again at render by the
  display layer.
- **How "is this HTML?" is decided.** `toRichTextHtml` treats input as HTML only
  when it contains a **block-level** container tag (`<p>`, `<div>`, `<h1>`–`<h6>`,
  `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`, `<table>` & friends) — see
  `HTML_TAG_RE`. This matters: the heuristic used to match *any* `<word>`, so
  ordinary Markdown containing a placeholder like `` `<clinicId>` `` or
  `Promise<void>` was stored verbatim as "HTML" — no headings/lists/tables were
  ever parsed, newlines collapsed on render, and the placeholder was silently
  eaten by the browser as an unknown tag. Inline tags (`<b>`, `<br>`, `<img>`, …)
  deliberately do **not** trigger the HTML path, because Markdown passes raw
  inline HTML through unchanged — so those documents keep both their Markdown
  structure and their inline tags.
- **Sanitizing is lossless for editor content.** The allowlist in
  `lib/rich-text.ts` covers every construct TipTap emits — task lists
  (`ul[data-type=taskList]`, `li[data-type=taskItem][data-checked]`, `label`,
  `input`), mentions (`span[data-type=mention][data-id][data-label]`), tables
  including `colgroup`/`col` widths and `colspan`/`rowspan`, and the
  file-attachment node. `allowedStyles` permits only inert layout properties
  (`width`, `min-width`, `height`, `text-align`). Extend the allowlist whenever a
  new editor extension is added, or its markup will be stripped on write.
- **The two paths sanitize differently on purpose.** The HTML path *discards*
  unrecognized tags (`SANITIZE_OPTS`); the Markdown path *escapes* them
  (`MARKDOWN_SANITIZE_OPTS`, `disallowedTagsMode: 'escape'`). Markdown passes raw
  inline HTML through, so an un-backticked `Promise<void>` or `<uid>` reaches the
  sanitizer looking like a tag — discarding it would silently delete text the
  author typed. Escaping keeps it visible. Consequence to know: a `<script>`
  written in Markdown prose renders as escaped, inert text rather than
  disappearing. Nothing executable survives on either path (`<script>`, `on*`
  handlers, `javascript:` URLs).
- **Embedding uploaded files in rich text.** `toRichTextHtml` also runs
  `upgradeUploadedMedia`: a reference to a file uploaded through our own pipeline
  (Vercel Blob, or `/uploads` in dev) — written as a Markdown image `![](url)` or
  a link `[name](url)` — is rewritten into the TipTap node the editor uses (an
  `<img>`, or a `<div data-type="file-attachment" data-file-url data-filename
  data-content-type>` for video/audio/other). Media type is inferred from the
  url's extension. This is what lets the CLI/API embed files inline with plain
  Markdown — they never construct app-specific markup. **Only our upload-origin
  urls are upgraded**; external links/images are left untouched. The render-layer
  DOMPurify whitelists the same `data-*` attributes, and the server sanitizer
  allowlist permits the `div` node, so the embed survives end-to-end. Covered by
  `lib/rich-text.test.ts`. The node's wire format (tag, `data-type` marker, and
  `data-*` attribute names) lives in **one** place — `lib/file-attachment.ts` —
  imported by both the server emitter/sanitizer (`lib/rich-text.ts`) and the
  editor's parse/render + DOMPurify allowlist (`components/rich-text-editor.tsx`),
  so the two sides can't drift.

### Discovery (for agents & tooling)

**The HTTP API is private plumbing.** Agents reach this product through the `bk`
CLI only; there is no public OpenAPI spec and no browsable API reference. Two
endpoints remain part of the discovery story, and one is a deprecation stub:

```
GET /api/meta           Authenticated bootstrap: { user, active_workspace, workspaces,
                        vocabulary, limits, media, cli, conventions, labels, projects,
                        members }. ?ws=<slug|id> targets a workspace.
GET /api/changelog      PUBLIC (no auth). What changed + the current CLI version floor.
GET /api/openapi.json   410 Gone (retired-surface stub, kept indefinitely).
GET /api/docs           410 Gone (retired-surface stub, kept indefinitely).
```

`GET /api/meta` is the call an agent makes first (as `bk meta`). It returns the
active workspace, the **full `workspaces` list** the caller belongs to (id, name,
slug, role, `is_active`), the canonical issue/project **vocabulary** (statuses,
priorities, project-update health — value/label/color, from `lib/work-items.ts`),
and three derived blocks assembled in **`lib/agent-meta.ts`**:

- **`limits`** — every server-enforced cap, imported from `lib/limits.ts` (the
  file the enforcing routes also import) and `lib/upload.ts`.
- **`media`** — which MIME prefixes render inline, which get View+Download, and
  `blocked_mime_types`; derived from `lib/rich-text.ts` and the upload route.
- **`cli`** — the advertised versions from `@blackcode/platform-agent`.

Nothing in those three may be hand-typed. The rule that makes the whole design
work: **static behaviour ships in the binary (`bk guide`, `//go:embed`-ed under
`cli/internal/guide/topics/`); dynamic data comes from here.** A guide topic that
restated a limit would be wrong the first time we changed it, and the agent would
have no way to tell — so `cli/internal/guide/guide_test.go` fails the build if a
topic hardcodes one.

The `workspaces` list exists so an agent can pick its write target **by
name/slug** — not by the opaque numeric `id`. Writing to the wrong workspace
(because ids carry no meaning) is the most common agent mistake;
`active_workspace` is only a default. `GET /api/workspaces` returns the same list
on its own.

`GET /api/changelog` (`app/api/changelog/route.ts`) is unauthenticated. It
returns `{ cli_latest_version, cli_min_version, entries: [{ date, title,
markdown, html }], reference_moved_to }` (entries newest first). Pass
`?format=markdown` (or `Accept: text/markdown`) for one raw Markdown document.
Source of truth is **`@blackcode/platform-agent`** (`packages/platform-agent/src/changelog.ts`), which merges **`docs/changelog/*.md`**
and renders it with `marked` (gfm, `breaks:false`) + `sanitize-html`. Because that
`.md` must exist at runtime, `next.config.js` sets `outputFileTracingIncludes` for
`/changelog` and `/api/changelog`.

The old `reference` field (a pinned "Platform Reference" snapshot of the whole
surface) is gone — `reference_moved_to` explains where, rather than leaving an
old client with `undefined`. A hand-maintained snapshot of the surface is a copy,
and copies drift; the current surface is `bk guide`.

**Coverage is enforced by a test** (`lib/cli-parity.test.ts`, run by `npm test`).
It replaces the deleted OpenAPI parity test and asks the question that now
matters: *can an agent do this?* It walks `app/api/**`, shells out to
`bk __routes` (the hidden command that dumps each leaf command's `routes`
annotation), and fails if a route has no CLI command, if the CLI claims a route
that doesn't exist, or if a leaf command declares nothing. Genuine non-CLI routes
live in its `EXCLUDED_PATHS` / `EXCLUDED_OPERATIONS` maps, each with a stated
reason.

### Workspace-scoped (canonical)

```
GET    /api/workspaces                          workspaces I can use THIS app in

GET    /api/workspaces/{ws}/search              federated search over platform.entities (?q=, ?app=, ?type=, ?limit=, ?include_deleted=1)
GET    /api/workspaces/{ws}/links               every link touching ?urn=, both directions
POST   /api/workspaces/{ws}/links               relate two URNs ({from,to,rel}); idempotent, 201 with created:false on a repeat
DELETE /api/workspaces/{ws}/links               remove one directed link (?from=&to=&rel= — all three identify it)
                                                (?all=1 → every membership + the
                                                 apps I can reach in each)
POST   /api/workspaces                          create workspace
GET    /api/workspaces/{ws}                     workspace detail
PATCH  /api/workspaces/{ws}                     update (owner)
DELETE /api/workspaces/{ws}                     delete (owner)
POST   /api/workspaces/{ws}/transfer            transfer ownership (owner)
POST   /api/workspaces/{ws}/move                copy/move items to another workspace
POST   /api/workspaces/{ws}/leave               leave workspace

GET    /api/workspaces/{ws}/members             list members
DELETE /api/workspaces/{ws}/members/{userId}    remove member (owner)

GET    /api/workspaces/{ws}/apps                apps this workspace runs (any member)
PATCH  /api/workspaces/{ws}/apps/{app}          enable/disable + default_access (owner)
GET    /api/workspaces/{ws}/apps/{app}/access   every member, flagged with access (any member)
POST   /api/workspaces/{ws}/apps/{app}/access   grant one member ({user_id}) (owner)
DELETE /api/workspaces/{ws}/apps/{app}/access/{userId}
                                                revoke one member (owner)

GET    /api/workspaces/{ws}/invitations         list (owner)
POST   /api/workspaces/{ws}/invitations         invite by email (owner); optional `app`
DELETE /api/workspaces/{ws}/invitations/{id}    revoke (owner)
GET    /api/workspaces/{ws}/invite-candidates    suggested people to invite (owner)




(The projects / tasks / issues routes moved to apps/issues/docs/backend.md.)

GET    /api/workspaces/{ws}/labels              list / POST create
GET    /api/workspaces/{ws}/labels/{id}         label detail
PATCH  /api/workspaces/{ws}/labels/{id}         update / DELETE
DELETE /api/workspaces/{ws}/comments/{id}       edit/delete a comment (author)

GET    /api/workspaces/{ws}/activity            activity feed
GET    /api/workspaces/{ws}/analytics           analytics (view/target/range/interval/filters)

GET    /api/workspaces/{ws}/trash               list binned items (?type=issue|project|task)
POST   /api/workspaces/{ws}/trash/restore       restore items ({items:[{type,id}]|batch_id, dry_run?, resolutions?})
DELETE /api/workspaces/{ws}/trash/purge         permanent delete — owner only ({items|batch_id}); auto-frees unreferenced files
POST   /api/workspaces/{ws}/trash/empty         hard-delete everything in the bin — owner only; auto-frees unreferenced files

GET    /api/workspaces/{ws}/storage             list uploaded files w/ references + usage — owner only
DELETE /api/workspaces/{ws}/storage/{id}        delete an orphaned file — owner only (409 if referenced)
GET    /api/workspaces/{ws}/attachments         workspace-wide attachments table view — owner only
```

**Storage / file cleanup.** Uploaded files are recorded in the `uploads` ledger
(written at upload time on every path — multipart `/api/upload`, the client-direct
`/api/upload/blob` handshake's `onUploadCompleted`, all attributed to an explicit
workspace or the user's active one, and stamped with the writing app). Blob
removal happens in exactly two places, both gated by `isUrlReferencedAnywhere`
(`@/lib/storage`) — a live, cross-app, cross-workspace scan of all content bodies
+ attachment rows, **including trashed items**:

1. **Owner-confirmed delete** — the `storage` routes / Storage page, for any
   0-reference file (including orphans left by editing).
2. **Automatic GC** (`sweepOrphanedUrls`) — fires on terminal deletes:
   `deleteComment` (comment/reply) and `purgeItems` (trash purge/batch/empty, via
   `purgeBatch`/`emptyTrash`). It gathers the URLs the removed content embedded
   (bodies, issue attachments, project updates, cascaded comments), then, after
   the rows are gone, deletes each file nothing else references.

Both call `removeBlobBytes` (`@vercel/blob` `del()`, or `fs.rm` for local
`/uploads`). *Editing* a file out of a still-living body never deletes bytes
(undo/restore stay safe); all blob deletion is best-effort and never fails the
user's action.

**The reference registry (Phase 7).** `packages/platform-storage` owns the ledger,
the path convention and the delete gate; each app registers a **reference
scanner** describing the only thing the platform cannot know — which of its
tables can hold a file url. `apps/issues` registers
`lib/storage/scanner.ts` as an import side effect of `lib/storage/index.ts`.
**Import storage from `@/lib/storage`, never from the package directly** — that
import is what guarantees the registration happened before a delete path runs.

The registry **fails closed**, and this is the property to preserve above any
other in this area:

- Coverage is asserted against `platform.apps`, not against the registry. An
  enabled app with no registered scanner makes every reference answer an
  **error**, never a `false`. "Nobody claimed it" must be a proven fact, because
  the caller of that answer calls `del()` and there is no undo.
- A scanner that throws propagates; it is never downgraded to "no references from
  that app". `sweepOrphanedUrls` catches, logs and **keeps the file**.
- An unknown url counts as referenced.

The deliberate consequence: once a second app is registered in `platform.apps`,
blob deletion in this deployment refuses until that app's scanner is registered in
this process. One app's Postgres role has no grant on another app's schema (§4.3),
so it genuinely cannot prove a file is unused — and a delete it cannot justify is
one it must refuse. A cross-deployment protocol for this is not built.

**Blob paths.** New uploads are written to `<app>/<workspace-slug>/<file>`
(`blobPathname`). Existing files were **not** moved; `pathname` records where each
one actually is. The prefix is for attribution and extraction (an app's files are
a prefix copy), not authorisation — the store has one token per deployment. In
the client-direct flow the *client* chooses the pathname and the Blob SDK gives
the server no way to rewrite it, so `POST /api/upload/blob` calls
`assertOwnPathname` and refuses anything outside this app's prefix.

### Super admin (requires `SUPER_ADMINS` env var)

```
GET  /api/super-admin/users            all platform users (name, email, workspace count, last login)
GET  /api/super-admin/whitelist        list whitelist entries
POST /api/super-admin/whitelist        add entry ({ type: 'email'|'domain', value })
DELETE /api/super-admin/whitelist/{id} remove entry
GET  /api/super-admin/errors           error log (cursor-paginated). Filters: ?status=open|resolved, ?level=, ?from=&to= (ISO), ?cursor=&limit=, ?stats=1 (adds aggregate counts)
DELETE /api/super-admin/errors         bulk delete ({ ids: number[] }, max 500); returns { deleted: <count> }
GET  /api/super-admin/errors/{id}      full event detail incl. stack + context
PATCH /api/super-admin/errors/{id}     toggle triage state ({ resolved: boolean })
DELETE /api/super-admin/errors/{id}    permanently delete one event
GET  /api/super-admin/entity-drift     reconciliation report: re-derive platform.entities from the source tables (?ws=<slug> to narrow)
POST /api/super-admin/entity-drift     same, and repair the drift it finds
GET  /api/super-admin/blob-drift       reconciliation report: platform.blob_references vs a live scan (?ws=<slug> to narrow)
POST /api/super-admin/blob-drift       same, and repair the drift it finds
```

All super-admin routes are guarded by `requireSuperAdminUser(req)` — 401 if
unauthenticated, 403 if the caller's email is not in `SUPER_ADMINS`. The guard
calls `resolveUser`, so it accepts **both** session cookies and `bk_live_…`
bearer tokens — these endpoints are fully usable from the `bk` CLI
(`bk super-admin …`), and a non-super-admin token gets the same 403. There is no
separate "super-admin token" scope: privilege is derived from the token owner's
email at request time.

### Personal, auth & system

```
GET/POST /api/auth/[...nextauth]                NextAuth
POST     /api/auth/register                     email/password sign-up (403 if not whitelisted)
POST     /api/auth/password-reset/request       request OTP
POST     /api/auth/password-reset/confirm       confirm OTP + set password

GET      /api/me                                current user (+ active_workspace_id, via, is_super_admin)
POST     /api/me/active-workspace                set active workspace
GET      /api/me/inbox                            list inbox  (?unread, ?limit)
POST     /api/me/inbox/mark-read                  mark read (ids | all)
POST     /api/me/inbox/archive                    archive ids
POST     /api/me/inbox/unarchive                  unarchive ids
GET      /api/me/pending-invitations             invitations for my email
POST     /api/me/password/request-otp            in-app password change (OTP)
POST     /api/me/password/confirm

POST     /api/invitations/accept                 accept by token
POST     /api/invitations/decline                decline by token

GET/POST /api/tokens                             list / mint API tokens
DELETE   /api/tokens/{id}                         revoke
POST     /api/cli/authorize                       mint a token for the CLI

POST     /api/upload                              multipart file upload (local dev / small files)
POST     /api/upload/blob                          Vercel Blob client-upload token handshake (prod; large files)
GET      /api/status                              public health probe
GET      /api/status/errors , /errors/{id}        error log (owner-gated detail)
POST     /api/errors/client                       client error beacon
```

### Legacy non-workspace shims

The implicit-active-workspace duplicates of the core entities —
`/api/projects`, `/api/issues`, `/api/tasks` and all their `/{id}`
children (incl. `/api/issues/{id}/comments`, `/attachments`, `/activity` and
`/api/projects/{id}/members`) — have been **removed**. Both the web app and the
`bk` CLI now call the canonical `/api/workspaces/{ws}/...` routes exclusively.
The scoped routes for issue attachments, issue activity, and project members
were added as part of that consolidation.

The non-entity legacy duplicates `/api/activity` and `/api/analytics` have also
been **removed** — both the web app and the `bk` CLI now use
`/api/workspaces/{ws}/activity` and `/api/workspaces/{ws}/analytics`. The former
`/api/users/me` auth-probe was folded into `GET /api/me`, which now also returns
`via` (`session` | `token`). `/api/users` (the visible-users list behind
`bk issues user list`) is **not** a duplicate of any scoped route and remains.

`bk analytics` keeps full web-dashboard parity through the scoped route: pass the
workspace in the path (`/api/workspaces/{ws}/analytics`) and the same `view`,
`id`, `from`, `to`, `interval`, and `status`/`priority`/`label`/`assignee`
filters (all via `parseAnalyticsParams`).

## Query layer

Everything that touches the database lives in `lib/db/queries/`. Routes call
these; they never write SQL inline.

| File | Responsibility |
|------|----------------|
| `workspaces.ts` | `createWorkspace` / `ensureDefaultWorkspace` (app-local: each has its own post-create step), `updateWorkspace`, `transferOwnership`, issue-seq allocation. The reads and `removeMember` are re-exports from `platform-db` |
| `members.ts` | project member listing |
| `invitations.ts` | accept/decline (Tier 2). Create, revoke, list, the token generator and pre-signup materialization are re-exports from `platform-db` — an invitation is to a WORKSPACE, not to an app |
| `invite-candidates.ts` | suggested invitees — members of the owner's other workspaces (with shared-workspace context), plus all platform users for super admins; flags `already_member` / `invited` |
| `users.ts` | password sign-up, and this app's bindings to `platform-db` for the rest: `getVisibleUsers` (workspace-mates only — privacy guard), the account reads/writes behind `/api/me`, and the four sign-in callbacks |
| `projects.ts` | project CRUD; list joins lead + latest update health |
| `project-relations.ts` | project ↔ member and project ↔ label sets |
| `project-updates.ts` | status-update feed (on_track/at_risk/off_track) |
| `tasks.ts` | task CRUD (project optional); list/get join the task lead; PATCH `lead_user_id` writes `lead_id` and records an `assigned`/`unassigned` event |
| `issues.ts` | issue CRUD, seq allocation, field-level events, auto-watchers |
| `comments.ts` | polymorphic comments + `@email` mention resolution |
| `labels.ts` | workspace labels; case-insensitive unique names |
| `attachments.ts` | issue attachments; `getWorkspaceAttachments` (owner-wide view) |
| `uploads.ts` | this app's binding to the shared upload ledger — the queries live in `@blackcode/platform-storage`; what stays here is stamping `APP_SLUG` on every `recordUpload` |
| `watchers.ts` | issue watchers (manual/assigned/reporter) |
| `events.ts` | this app's half of the event spine — `recordEvent`, `EntityType`/`EventAction`. Platform entity types are delegated to `recordPlatformEvent` (D-23) |
| `fanout.ts` | event → per-user inbox materialization, **for this app's events only**. The five platform handlers live in `platform-db` |
| `inbox.ts` | inbox listing and read state. The write (`createInboxMessage`, dedup window) is re-exported from `platform-db` |
| `activity.ts` | activity feed reads |
| `analytics.ts` | workspace/project/task/member analytics — see below |
| `deletion.ts` | soft-delete engine — `softDelete*`, `previewDeletion`, `listTrash`, `previewRestore`, `restoreItems/Batch`, `purgeItems/Batch`, `emptyTrash` |
| `move.ts` | cross-workspace transfer — `moveItems` (copy or move projects/tasks/issues + all satellite data into another workspace). **One transaction:** copies into the target (fresh `seq`, labels matched/created by name, comments/attachments/watchers/assignees/members/updates carried) then, for `mode='move'`, soft-deletes the source into one recycle-bin batch. Any failure rolls back everything — source untouched, no partial target rows, no data loss. User refs not in the target's membership (assignee/reporter/lead/owner/watcher/member/@mention) are dropped and returned under `adjustments`; a parent link (project/task) not in the same transfer is cleared. Backs `POST /api/workspaces/{ws}/move`. |
| `error-events.ts` | error log reads (public list redacts; detail is gated) |
| `password-reset.ts` | OTP issue/verify/consume |
| `whitelist.ts` | `isEmailAllowedByDb`, `listWhitelist`, `addWhitelistEntry`, `removeWhitelistEntry` |
| `admin.ts` | `listAllPlatformUsers` — cross-workspace user listing for super admin view |

## Cross-cutting concerns

### Response headers (version + self-service breadcrumbs)

`apiHandler` (`withStandardHeaders`) stamps four headers on **every** API
response, success or error:

- `X-BK-CLI-Latest` — newest published `bk` CLI. The CLI shows a throttled
  "update available" notice when the caller is behind it.
- `X-BK-CLI-Min` — minimum CLI the API supports. The CLI hard-refuses (exit code
  8) below this. **Raise `CLI_MIN_VERSION` whenever a server change breaks older
  CLIs** (e.g. the milestone→task / key-removal rename) so stale clients get a
  clear "please upgrade" instead of cryptic 404s.
- `X-BK-Help` — the get-current guide (`/agent-updator`).
- `X-BK-Changelog` — the changelog (`/api/changelog`). Points at the JSON route, not a page: the human `/changelog` page was removed on 2026-08-03 and these headers are read by agents.

The version headers come from `@blackcode/platform-agent` (override via `BK_CLI_LATEST` /
`BK_CLI_MIN` env, no redeploy); the two breadcrumb headers come from
`lib/agent-manifest.ts` `discovery`, so they can't drift from `/llms.txt`. The
breadcrumbs are out-of-band (never in the body), so a client that ignores them
pays nothing — but an agent that hits a wall can follow them back to the
changelog. The `bk` CLI complements these with a one-line `hint:` on stderr for
drift-smelling failures (auth, `400`/`404`/`422`, unknown command/flag).

### Middleware (`middleware.ts`)

NextAuth `withAuth` guarding `matcher: ['/dashboard/:path*']` — unauthenticated
browser visits to the dashboard redirect to `/login`. **API routes are not
guarded here**; each route authenticates itself via `resolveAuth`/
`resolveWorkspace` (so bearer-token clients work).

### Event spine, inbox & activity

See [The event spine](#the-event-spine). Anything user-visible that "happened"
should `recordEvent` so it shows up in activity and (where appropriate) the
inbox — don't write to `inbox_messages` directly from a route.

### Transaction log / undo — REMOVED 2026-08-05

`transaction.ts` and `/api/undo` are gone, along with `bk undo`. The feature
never worked: `logTransaction` had no callers, so `platform.transaction_log` was
empty in production (0 rows, against 3,630 in `platform.events`) and every `undo`
returned zero operations. A documented agent-facing feature that does nothing is
worse than a missing one.

Recovery is the recycle bin (`deletion.ts`, `bk trash`), which is what users and
agents have actually been using. History is the event spine.

**The `platform.transaction_log` table was DROPPED on 2026-08-10** (migration
`0045`), which is the separate change this paragraph anticipated. Do not
recreate it — if per-field undo is ever wanted, build it on `platform.events`,
which already records every mutation.

The drop is gated on `max(created_at)`, not on `count(*) = 0`: the migration
refuses if any row is newer than 30 days, because a recent row would mean a
writer this audit did not find, and that is more interesting than the table.

> **Correction, 2026-08-10: "empty" above is a claim about production on
> 2026-08-05, and it is not the gate to drop the table on.** Local dev has **4
> rows**, newest `created_at` 2026-05-22 — stale residue from before undo was
> retired, not a live writer. So the question at drop time is *"is anything
> still WRITING it?"* (`SELECT count(*), max(created_at)`), not *"is it
> empty?"*: a recent `max(created_at)` means an undiscovered writer and is a
> reason to stop; an old one means residue and rows are expected. Confirmed
> against the catalog rather than by grep — the only trigger in the whole
> `platform` schema is `trg_blob_refs` on `comments`, and **a Postgres trigger
> is not code any grep of `apps/` would find.** See
> `multiAppFinalRefactor/PLAN.md` §4b.

### File uploads (`app/api/upload/route.ts`, `app/api/upload/blob/route.ts`)

Two paths, chosen by the client (`lib/upload.ts` → `uploadFile`, the single
helper used by every editor/avatar uploader). The size cap (`MAX_UPLOAD_BYTES`,
**100 MB**) lives in `lib/upload.ts` and is imported by both routes.

- **Production (Blob configured)** — `uploadFile` uploads **client-direct** to
  Vercel Blob; only the token handshake hits `POST /api/upload/blob`
  (`@vercel/blob/client` `handleUpload`). This bypasses the serverless ~4.5 MB
  request-body limit, so files up to 100 MB work in prod. The handshake auths the
  user, blocks SVG, and sets `maximumSizeInBytes` (Blob enforces it).
- **Local dev (no `BLOB_READ_WRITE_TOKEN`)** — `uploadFile` POSTs multipart to
  `POST /api/upload`, which writes to `public/uploads/`.

The client picks the path from `GET /api/upload` (memoized), which also returns
`app` and the caller's `workspace` slug so the client-direct flow can build the
same `<app>/<workspace>/<file>` pathname the server would — and which the
handshake then re-checks.
Both reject `image/svg+xml` (XSS). `POST /api/upload` returns
`{ url, filename, size, contentType }`. No new env var is needed —
`BLOB_READ_WRITE_TOKEN` (already required for Blob) activates the prod path.

### Email (`lib/email/`)

Resend client (`lib/email/client.ts`), lazily constructed and **only enabled
when both `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set** (`emailEnabled()`).
`fromAddress()` sends as `"Blackcode Issues" <RESEND_FROM_EMAIL>` (falls back to
a bare `no-reply@example.com` if unset — should never happen once configured).
`lib/email/send.ts` wraps every send in try/catch — sending is always
best-effort and never breaks the triggering action; failures log a `warn`-level
`error_events` row (recipient domain only, never the full address) and the
caller still succeeds. Templates (`lib/email/templates.ts`) are plain
subject/html/text builders — inline-styled, single shared layout, brand logo
pulled from `NEXTAUTH_URL`/logo.png — not React Email components.

Three transactional stages send today; everything else (mentions, assignments,
activity) stays in-app-only via the inbox:

1. **Password reset (logged out)** — `app/api/auth/password-reset/request/route.ts`,
   from the "forgot password" flow on `/login`. Sends `passwordResetEmail` (OTP
   + expiry). Always responds `{ ok: true }` regardless of send outcome, to
   avoid leaking which emails have accounts.
2. **Password set/change OTP (logged in)** — `app/api/me/password/request-otp/route.ts`,
   from account settings (including Google-only users adding a password). Same
   `passwordResetEmail` template.
3. **Workspace invitation** — `app/api/workspaces/[ws]/invitations/route.ts`,
   when an owner invites someone by email. The invitation row is committed to
   the DB first, then `sendInvitationEmail()` fires (workspace name, inviter,
   accept URL). A bounced email doesn't invalidate the invite — it's still
   reachable via the in-app inbox or a copyable link.

### Error responses & sanitization

`lib/api/sanitize.ts` recursively redacts sensitive keys (`password`, `token`,
`authorization`, `cookie`, `secret`, `api_key`, …), caps depth/length/array
size, and is applied before any error context is written to `error_events`.
Combined with `apiHandler`, this means 5xx errors are captured for the
`/status` page without leaking credentials.

## Adding new functionality

### A new API endpoint

1. Create `app/api/.../route.ts`, export `GET`/`POST`/… wrapped in `apiHandler`.
2. Call `resolveWorkspace(req, ws)` (or `resolveUser`) to authenticate.
3. Validate the body; throw `Errors.badRequest(...)` on bad input.
4. Delegate to a function in `lib/db/queries/` — don't inline SQL.
5. In that query function, `recordEvent(tx, …)` inside the mutation's
   transaction if it's user-visible.

### A new column

Edit the app's `lib/db/schema.ts` → `npm run db:generate:<app>` → review the SQL
in that app's `lib/db/migrations/` → `npm run db:migrate:<app>`.

> **Name the app.** Every app has its own schema, its own migrations directory
> and its own Drizzle ledger (D-34). The root scripts were `db:generate` /
> `db:migrate` while there was one app; they are `…:issues` and `…:sales` now,
> because an unqualified name silently generated into `apps/issues` no matter
> which app you were working on. Running the old name fails with
> "missing script", which is the point.

### A new table

Add the `pgTable` to `schema.ts` (with `workspace_id` if it's tenant data),
export its `$inferSelect`/`$inferInsert` types, generate + apply the migration,
then add a `lib/db/queries/<thing>.ts` module. `project_updates` (migration
`0018`) is a recent, minimal end-to-end example.

## Operational notes

### Local development

```bash
docker compose up -d        # Postgres 16 on localhost:5434
npm install
npm run db:migrate:issues   # or :sales
npm run dev                 # issues on http://localhost:3000
                            # npm run dev:sales for the sales app
```

### Database client (`lib/db/client.ts`)

A `pg` `Pool` (max 10) built from `DATABASE_URL`, wrapped by Drizzle and cached
on `globalThis` so hot reload doesn't leak connections. The
`@neondatabase/serverless` driver is a dependency for serverless Postgres
compatibility, but the default client uses `pg`.

### Migrations

Managed by `drizzle-kit` (config in `drizzle.config.ts`):

```bash
npm run db:generate:issues   # author a migration from schema diffs
npm run db:migrate:issues    # apply pending migrations
npm run db:push:issues       # push schema directly (prototyping only)
npm run db:studio:issues     # browse data

npm run db:generate:sales    # the same, per app
npm run db:migrate:sales
```

Migration files are numbered `0000_…` upward in `lib/db/migrations/`, with
snapshots under `meta/`. Don't hand-edit applied migrations; add a new one.

### Access whitelist (opt-in)

When `SUPER_ADMINS` is set, the whitelist feature activates:

- **Registration** (`POST /api/auth/register`) returns `403 not_in_whitelist` if
  the email doesn't match an `email_whitelist` row or the `SUPER_ADMINS` list.
- **Google OAuth sign-in** redirects to `/blocked` instead of creating an account.
- **Invitations** (`POST /api/workspaces/{ws}/invitations`): if the invitee is not
  whitelisted, non-super-admins get a 403; super admins auto-add the email and proceed.

When `SUPER_ADMINS` is not set (or empty), all emails are allowed and the
whitelist table is ignored entirely.

Helper utilities: `@blackcode/platform-auth` (`isSuperAdmin`, `isEmailAllowed`,
`isWhitelistEnabled`) and `lib/api/super-admin-guard.ts` (`requireSuperAdminUser`).

### Bootstrapping

Set `SUPER_ADMINS=your@email.com` in the environment before the first user signs
up. Super admins can then add domains (`blackcode.ch`) or individual emails to
the whitelist via `/dashboard/super-admin/whitelist`, unlocking registration for
the rest of the team. Without `SUPER_ADMINS`, any email can sign up.
