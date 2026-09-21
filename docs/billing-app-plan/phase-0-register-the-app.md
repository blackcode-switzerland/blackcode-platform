# Phase 0: Register the app

**Goal:** an empty `apps/billing` that builds, lints, passes every guardrail in
the repo, deploys to `billing.blackcode.ch`, and answers
`bk billing workspace list`. No invoicing exists yet.

- **The problem** — nothing about invoicing can be built against an app that has
  no Postgres schema, no role, no row in the address book, no command group and
  no deployment. Registering a new app on this platform touches roughly twenty
  files outside its own directory, most of them hand-maintained lists that no
  code derives, and the failure mode for almost every one of them is silence:
  the app builds, the suite is green, and the thing is simply not checked or not
  served.
- **What this phase does** — walks [`adding-an-app.md`](../adding-an-app.md) top
  to bottom for the slug `billing`: copies the scaffold, renames the six places
  the slug lives, writes three migrations, provisions the role, registers the
  app, mounts the account surface books already proved is needed, adds the CLI
  group and one guide topic, and edits every hand-maintained per-app list in the
  repo. Almost none of it is thinking; all of it is checklist.
- **Expected result** — `npm run typecheck && npm test && npm run lint && npm run build`
  and the Go equivalents are green, the boundary probe has been run as
  `billing_app` with its transcript recorded, `bk login --server https://billing.blackcode.ch`
  round-trips, `bk billing workspace create` then `list` works, and the empty
  dashboard opens in a browser and says what it is.

## In one look

| | |
|---|---|
| **Data** | Only what every app on this platform has: `billing.workspaces`, `workspace_members`, `invitations`, `counters`. Plus a `billing_app` role and a row in `platform.apps`. |
| **Logic** | None of its own. It binds the shared request layer — `apiHandler`, `resolveWorkspace`, token and session auth, the error log, the version headers. |
| **UI** | The login page and an empty dashboard, copied from the scaffold and renamed. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘
```

```
┌─ UI ────────────────────────────────────────────────────────
│  app/login/page.tsx, components/login-form.tsx     copied
│  app/dashboard/page.tsx      empty state, renamed  copied
│  app/cli/authorize/page.tsx  the browser half of login  new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/billing/billing.go   group + appverbs         new
│  client/billing.go             the typed client         new
│  guide/topics/billing/00-billing.md                     new
│  commands/root.go              one line               altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  lib/app.ts, lib/api.ts        identity + AppContext  copied
│  app/api/**                    the account surface    copied
│  lib/db/queries/workspaces.ts, invitations.ts,
│                   footprint.ts                        copied
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts           tenancy + counters          new
│  migrations/0001            schema, tenancy, counters
│  migrations/0002            blob index + purge grant + flag
│  migrations/0003            what billing_app may do
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.** If something here looks like it
needs a change in `packages/platform-*`, re-read the boundary rules first. The
one package this build does change is `platform-email`, and that is phase 3.

**Shared files this phase alters:** many. The full list is in "Everything outside
the app directory" below, and it is the part of this phase that is actually easy
to get wrong.

## The slug

`billing`, and it is one string that must agree in six places:

1. `apps/billing/lib/app.ts` → `APP_SLUG`
2. the directory `apps/billing/`
3. the Postgres schema, `CREATE SCHEMA billing`
4. `platform.apps.slug`
5. the CLI namespace, `bk billing …`
6. `cli/internal/guide/topics/billing/`

Nothing derives it from anything else, deliberately.

**The collision check, recorded.** `grep -rw billing` over the repo on
2026-09-16 returned five files, all prose: a books seed source named
"GitHub billing", one comment in `apps/books/lib/vocabularies.ts:66`, an icon
keyword list, and two migration comments. No entity, no variable, no directory.

That check is not ceremony. The scaffold's slug used to be `template`, which was
also a sales entity, a Go local and a word every migration uses in prose; three
guards mis-fired on the collision in one phase and every one of them looked
correct.

## Build

### 1. Copy the scaffold

```bash
rsync -a --exclude '.turbo' --exclude 'tsconfig.tsbuildinfo' \
      --exclude 'node_modules' --exclude '.next' --exclude 'next-env.d.ts' \
      apps/_scaffold/ apps/billing/
```

Then rename. **The three lines the copy gives you and a careless rename takes
away, each of which fails silently:**

| File | Change |
|---|---|
| `package.json:2` | `"name": "scaffold"` → `"billing"`. **Do this first** — two workspaces with the same name breaks `npm install` for the whole repo. |
| `package.json` scripts | Add `"dev": "next dev -p 3300"` and **`"postbuild": "node ./scripts/migrate-if-enabled.mjs"`**. See "what the scaffold does not give you" below. |
| `lib/app.ts:15` | `APP_SLUG = 'billing'`; add `APP_NAME` and `EMAIL_ACCENT`. **Delete the underscore note at lines 17–38** — it is about the scaffold's own name and is not true of a real app. **`APP_NAME` reads `process.env.BILLING_DISPLAY_NAME ?? 'b/billing'`** and `EMAIL_ACCENT` reads `BILLING_EMAIL_ACCENT` with the computed default, because a standalone copy carries another company's name ([`integration-surface.md`](integration-surface.md) §5). The slug is never environment. |
| `app/layout.tsx:11` | `metadata.title` is the literal `'Scaffold app'`. Read `APP_NAME`; it is the first place the environment-driven name shows, and a literal here is the first thing a customer sees wrong. |
| `lib/db/schema.ts:15` | `pgSchema('billing')`, `billingSchema`. **Keep the TS prefixes** (`billingWorkspaces`, not `workspaces`): line 33 re-exports the platform schema, so a bare `export const workspaces` shadows `platform.workspaces` at every import site in the app, silently. |
| `drizzle.config.ts:50` | `table: '__drizzle_migrations_billing'`. Drizzle's default ledger is one high-water mark for the whole database, so a shared ledger **silently skips** your migrations. |
| `next.config.js:53` | `allowedOrigins: ['localhost:3300']`. Add `@blackcode/platform-i18n` and `@blackcode/platform-email` to `transpilePackages`. |
| `app/globals.css:32` | **Leave the `@source` line exactly as it is.** `transpilePackages` makes the TypeScript compile; `@source` makes the CSS exist. Neither implies the other and only one fails loudly — 151 classes were missing in production for months. |
| `middleware.ts:35` | **Leave `cookies: sessionCookieConfig()` exactly as it is.** Edit only the matcher, and it must not cover `/api/*`. |
| `vercel.json` | **Nothing.** Four settings, three of which are invisible when wrong. |
| everywhere | Delete the scaffold's `notes` entity: the table, the route, `lib/db/queries/notes.ts`, and the CLI command. Phase 1 replaces it. Note that 0002's blob trigger names it, so 0002 is rewritten rather than copied. |

`EMAIL_ACCENT` is **not** the app's `--primary`. `EmailIdentity.accent` always
carries white text, and the mockup's signal green `#3ecf8e` is about 1.9:1
against white. Compute a darker green that clears 4.5:1 by the WCAG
relative-luminance formula, the way `apps/books/lib/app.ts:42-61` records doing,
and write the measurement into the comment.

### 2. What the scaffold does NOT give you

Three real gaps, verified 2026-09-16. None is mentioned in the checklist.

1. **No `postbuild` hook and no `scripts/migrate-if-enabled.mjs`.**
   `apps/_scaffold/package.json` has neither; issues, sales and books all do.
   Copy `apps/books/scripts/migrate-if-enabled.mjs` verbatim (change the two
   `--workspace=books` strings in its messages) and add the `postbuild` line.
   Its own header records that books shipped without it, which would have made a
   production deploy succeed, serve traffic, and apply **zero** of nineteen
   migrations. The check is the deploy log: it must say "applying Drizzle
   migrations" and "migrations applied", never "skipping migrations".
2. **`lib/app-isolation.test.ts` has only two of its three cases.** The third —
   the one that bans importing the platform tenancy readers — exists only in
   `apps/sales/lib/app-isolation.test.ts:109-250`. Copy it, with its
   `PLATFORM_TENANCY_READERS` list and both the named-import and
   namespace-import scans. It is the guard for the bug that 404'd the entire
   sales dashboard for every sales-only account across four phases while every
   API route returned 200.
3. **`OTHER_SCHEMAS` is already asymmetric in all four apps.** Verified:

   | File | Today | Should be |
   |---|---|---|
   | `apps/issues/lib/app-isolation.test.ts:36` | `['scaffold', 'sales']` | + `books`, + `billing` |
   | `apps/sales/lib/app-isolation.test.ts:39` | `['issues', 'scaffold']` | + `books`, + `billing` |
   | `apps/books/lib/app-isolation.test.ts:38` | `['issues', 'sales']` | + `scaffold`, + `billing` |
   | `apps/_scaffold/lib/app-isolation.test.ts:38` | `['issues', 'sales']` | + `books`, + `billing` |

   A one-sided guard only catches the app that remembered. Fix all five in this
   phase, in one commit.

### 3. Migrations

Hand-written SQL with `--> statement-breakpoint`, and the journal hand-edited in
the same commit. **`npm run db:generate` does not work for a new app here:**
`lib/db/schema.ts` re-exports the platform schema, so drizzle-kit emits
`CREATE TABLE platform.users` and the app ends up owning the shared schema.
The giveaway that every migration in this repo is hand-written is
`CREATE TABLE IF NOT EXISTS`, which drizzle-kit never emits.

| Migration | Contents |
|---|---|
| `0001_billing_init.sql` | `CREATE SCHEMA IF NOT EXISTS billing`; `workspaces`, `workspace_members`, `invitations`, `counters`. Copy the bodies from `apps/books/lib/db/migrations/0001_books_init.sql` — which already squashes the scaffold's 0001 + 0003 so the foreign keys point at `billing.workspaces` from the first statement. **Do not carry the scaffold's 0003 DO-block**; there is no history to repoint. |
| `0002_blob_reference_index.sql` | Adapt `apps/books/lib/db/migrations/0002` — **not** the scaffold's, whose comment wrongly claims the purge grant is order-independent. This app references no uploaded files, so there is no trigger to install and no backfill: the file is the `blob_refs_purge` grant loop, then the flag, plus a header saying the index is empty on purpose and why the flag is still required. |
| `0003_app_role_grants.sql` | Adapt `apps/books/lib/db/migrations/0005`: `GRANT USAGE`, DML on all tables and sequences in `billing`, `ALTER DEFAULT PRIVILEGES` for future tables, re-assert `platform.blob_references` as read-only, `REVOKE ALL ON SCHEMA drizzle`, set `search_path`. Guarded on the role existing, raising a loud `WARNING` if not. The `REVOKE DELETE` list is empty in this phase and gains its rows in phase 1. |

**`counters` is `(workspace_id, entity_type, last_value)`,** not the scaffold's
single-column `note_counters`. `platform.workspace_counters` cannot be used —
it has fixed columns named for issues' entity types — and a per-entity-type row
is what lets phase 1 add `invoice`, `company`, `recurrence` and `history`
without another migration.

The journal, `lib/db/migrations/meta/_journal.json`, is hand-edited: `tag` is the
filename without `.sql`, `idx` is sequential, and **`when` must be strictly
greater than the previous entry's**, because drizzle-kit applies by timestamp
rather than by filename. Five sales migrations shipped with no journal entries
on 2026-08-17; `postbuild` printed "migrations applied", exited 0, applied none,
and four routes 500'd.

### 4. Provisioning

The order, the commands and the probe are in
[`local-database.md`](local-database.md). The two files this phase writes:

- **`docs/sql/billing-app-role.sql`** — a substituted copy of
  `docs/sql/books-app-role.sql`, opening with `\set ON_ERROR_STOP on`. **Do not
  run `docs/sql/app-role.sql`**, whose second half carries literal `issues` /
  `issues_app` at lines 82–109 and would silently configure issues instead.
- **`docs/sql/billing-app-register.sql`** — a substituted copy of
  `docs/sql/books-app-register.sql`: part 1 inserts the row with
  `enabled = false` and `ON CONFLICT DO UPDATE` on name, description and
  `base_url` only, never `enabled`; part 2 enables the app guarded on
  `maintains_blob_index = true`. Run the whole file twice, before and after the
  migrations.

`base_url` is load-bearing. With it NULL, every `bk billing …` command on every
machine fails with "no server known for app billing".

Also add `docs/sql/billing-0001-rollback.sql` and one per migration, matching the
`books-NNNN-rollback.sql` convention.

### 5. The account surface

The scaffold mounts nine method exports across seven factory call sites. Books
proved four more are needed; mount those too, each as its own file with one
export per method (`export const GET = handlers.GET`, never a destructured
export — the parity guard cannot see those).

| Route | Factory | Why |
|---|---|---|
| `/api/cli/authorize` **and `app/cli/authorize/page.tsx`** | `cliAuthorizeRoute` | `bk login --server https://billing…` opens the PAGE in a browser and the page posts to the route. Mount only the route and the browser 404s while the terminal waits forever on a loopback listener, with no error at either end. Books found this gap. Use `platform-auth`'s `/cli-callback` subpath. |
| `/api/me/footprint` GET **and** DELETE | `footprintRoute` | Not optional. Without it, closing a blackcode account **strands** this app's data — owned by an account that can no longer sign in. Requires a real `billingFootprintSource`; `AppContext.footprint` has no default so it fails to compile rather than silently. |
| `/api/auth/password-reset/{request,confirm}`, `/api/me/password/{request-otp,confirm}` | the four password routes | The app has its own login, so it owes its own recovery. `apps/sales` used to send people to `apps/issues` to change a password both apps share. |
| `/api/tokens`, `/api/tokens/{id}` | `tokensRoute` | An agent needs a token minted from this app. Throws at mount time without `resolveSessionUser`. |
| `/api/meta` | **its own route**, not a factory | `platformMetaBlock(appContext, req, user, { currentApp: { vocabulary: … } })`. Class C: an app's vocabulary is the reason the route exists. Serving no `apps` block is what made `bk login` against books write an empty registry. Use the spelling `vocabulary`, singular, matching issues and sales — books' `vocabularies` forced a two-spelling parser at `cli/internal/commands/platform/meta_vocab.go:94`. |

**Do not mount** `searchRoute`, `usersRoute`, `linksRoute`,
`workspaceInvitationsRoute` or `workspaceInvitationRoute`. Each queries a
`platform.*` table that became one app's, and the reasons are in
`apps/billing/app/api/README.md` (copied from the scaffold — keep it, and update
it for this app). The rule they share: **a shared factory is only shared if the
table under it is.**

`/api/me/footprint`'s `holds` array is this app's nouns, in the plural a person
would recognise losing. In this phase it is empty; phase 1 gives it companies and
invoices, and phase 1 must not forget to come back for it.

### 6. The CLI group

```bash
cp -R cli/internal/commands/scaffold cli/internal/commands/billing
cp cli/internal/client/scaffold.go   cli/internal/client/billing.go
```

Rename the package, the `Use:`, `Slug`, and the client's types. Delete the
`note` commands. Register the group at `cli/internal/commands/root.go:231`:

```go
for _, group := range []*cobra.Command{
    issues.NewGroup(), sales.NewGroup(), books.NewGroup(),
    billing.NewGroup(), scaffold.NewCmd(),
} {
    pinApp(group, group.Name())
    root.AddCommand(group)
}
```

`pinApp` applies the server pin to the whole subtree, so no spelling under
`bk billing` can reach the wrong deployment. Also extend the hand-written app
tour in the root help at `root.go:119-120`.

The verb set — books' exactly, and the omissions are the decision:

```go
cmd.AddCommand(appverbs.New(appverbs.Config{
    App:             Slug,
    Workspace:       true,
    WorkspaceCreate: true,   // a workspace can be made here, never deleted
    Members:         true,
    Invites:         true,
}).All()...)
```

Off, each because the route does not exist and never will: `Uploads` (no
`/api/upload`), `Trash` and `Labels` (an invoice is voided, never binned — there
is no purge path to expose), `InviteCandidates`, `InviteAccept`,
`WorkspaceAdmin`, `MemberLeave`, `Users`, `Search`, `Activity`, `Inbox`,
`Storage`. **These booleans are a declaration of what `app/api/**` has, never a
wish list**: turn one on and `lib/cli-parity.test.ts` immediately reports a claim
on a route with no file.

Every leaf command needs a `routes` annotation or the literal `"none"`.

### 7. The guide topic

`cli/internal/guide/topics/billing/00-billing.md`: an H1, a two-to-four line
"what this is", a `Related commands:` line, and a fenced runnable sequence.

**This directory is also what attributes routes to the app.** Route attribution
is read from the guide section list, so without it `appOwnClaims` is empty and
`lib/cli-parity.test.ts` fails — which is the correct outcome, and is exactly
the failure that once let deleting sales' topics directory drop its attribution
from 68 routes to 0 while the suite stayed green.

A topic must never restate a dynamic value, and a topic under `topics/billing/`
may not describe another app.

### 8. Everything outside the app directory

The hand-maintained lists. Every one was verified on 2026-09-16.

| File:line | Edit |
|---|---|
| `cli/internal/commands/root.go:231`, `:119` | register the group; extend the help tour |
| **`cli/internal/guide/guide_test.go:163`** | add `"billing": "apps/billing/lib/vocabularies.ts"` to `vocabularySources`. **This is finding #22.** The map is what stops a guide topic hardcoding a status or a limit, and books went to production with no line here, so all eight of its topics had a free pass for their whole life while the section header read `--- PASS`. Add the line in the same commit as the first topic. |
| `cli/internal/commands/help_flag_drift_test.go:85` | add `"billing"` to `helpAppPlaceholders` |
| `devops/release.sh` `app_registry()` | add `billing\|bc-billing\|<prj_id>\|https://billing.blackcode.ch`. Re-read "releasing the CLI" in `usage()` afterwards: the version gate is served by every app, so step 3 of a CLI release is one `web <app>` per line here. |
| `devops/db-ledger/lib-db.sh:105` | `TRACKED_SCHEMAS` — add `'billing'` **and the missing `'books'`**, then re-run `capture-baseline.sh` |
| `packages/platform-testing/test/retired-cli-spellings.test.ts:105` | `SCAN_ROOTS` is `['issues', 'sales', '_scaffold']` — add `billing` **and the missing `books`** |
| the four sibling `lib/app-isolation.test.ts` | `OTHER_SCHEMAS`, see the table above |
| root `package.json` | `dev:billing`, `db:generate:billing`, `db:migrate:billing`, `db:seed:billing`. The `workspaces` globs are `apps/*` and `packages/*`, so there is nothing to register there. |
| `docs/changelog/billing.md` | new file. Discovery is a `readdirSync`, so there is genuinely no registry to update — but the file itself is a step. |
| `docs/sql/billing-*.sql` | the role, the register and one rollback per migration |
| `CLAUDE.md`, `AGENTS.md` | the app roster, the schema list, the tree map, the topics-dir list |
| `docs/platform-architecture.md:9`, `:131` | "Three apps are in production" and the `platform-i18n` note |
| **`docs/platform-db.md:241`** | says to create the role *after* the first migration, which contradicts `adding-an-app.md:357` and `docs/sql/books-app-role.sql:23`. **Fix it to the books order** and note the correction. |
| `docs/env.md`, `docs/devops.md`, `docs/cli.md`, `docs/backend.md`, `docs/frontend.md` | the per-project env matrix, the local-port table, the deploy table, the prose naming three apps |
| `apps/billing/docs/{backend,frontend}.md` | new, this app only |

**Verified as needing no edit** — these derive their app list rather than
declaring it: `turbo.json` (cross-cutting globs), root `package.json` workspaces,
`.vercelignore` (repo-root only — **never add a per-app one**),
`packages/platform-agent` (changelog is a directory read; the CLI version
constants are shared, not per app), `cli/cmd/bk/main.go`,
`cli/internal/commands/deprecations.go` (only if the slug is ever renamed),
`platform-route-coverage.test.ts`, `cited-tests-exist.test.ts`,
`package-isolation.test.ts`, `migration-ledger.test.ts`, and any migration —
**no migration inserts the `platform.apps` row**, it is a human `psql` step.

### 9. Vercel

Project `bc-billing`, root directory `apps/billing`, existing Neon project, **no
blob store** (this app stores no files). Then:

1. `RUN_MIGRATIONS=1` **Production only.** On Preview it writes to the
   production database.
2. `MIGRATE_DATABASE_URL` = the migrator. Missing in Production means every
   deploy fails at postbuild with `permission denied for schema drizzle`.
3. `NEXTAUTH_SECRET` — **cannot be copied** from another project; stored
   sensitive values read back as `[SENSITIVE]`. Rotate one value onto every app.
4. `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Without them the app builds,
   deploys, and answers `503 email_not_configured` on every password reset.
5. Domain, then `NEXTAUTH_URL`, then `AUTH_COOKIE_DOMAIN=.blackcode.ch`
   Production only — **in that order**. A startup throw in
   `packages/platform-auth/src/session-cookie.ts` enforces it, and it will fail
   the build if another app's `NEXTAUTH_URL` is still a `*.vercel.app` address,
   which is correct.

## Routes and CLI

Every route below is a platform factory or the copied account surface. The only
app-owned route in this phase is the scaffold's `notes`, and it is deleted.

| Route | Command |
|---|---|
| `GET /api/workspaces` | `bk billing workspace list` |
| `POST /api/workspaces` | `bk billing workspace create` |
| `GET /api/workspaces/{ws}` | `bk billing workspace show`, `use` |
| `GET /api/workspaces/{ws}/members` | `bk billing member list` |
| `GET,POST /api/workspaces/{ws}/invitations` | `bk billing invite list`, `send` |
| `DELETE /api/workspaces/{ws}/invitations/{id}` | `bk billing invite revoke` |
| `GET,PATCH /api/me` · `POST /api/me/active-workspace` | bare `bk profile`, `bk whoami` |
| `GET /api/meta` | bare `bk meta` |
| `GET /api/changelog` | bare `bk changelog` |
| `GET,POST /api/tokens` · `DELETE /api/tokens/{id}` | bare `bk token` |
| `GET,DELETE /api/me/footprint` | **none** — `EXCLUDED_PATHS`, with the reason |
| the four password routes, `/api/auth/*`, `/api/cli/authorize` | **none** — `EXCLUDED_PATHS`, with the reason |

`lib/cli-parity.test.ts` needs eight `EXCLUDED_PATHS` entries (the scaffold's
three plus books' five) and three `UNSERVED_OPERATIONS` entries. Copy them with
the routes, verbatim including their reasons — `apps/books/lib/cli-parity.test.ts:35-150`
is the worked example. Note `UNSERVED_OPERATIONS`, not `EXCLUDED_PATHS`, for a
method you do not serve on a path you do mount: an exclusion would remove the
path from the set drift compares against.

## Done when

- [ ] `npm run typecheck && npm test && npm run lint && npm run build` green from
      the repo root. **Not `npx tsc --noEmit`** — there is no root tsconfig, by design.
- [ ] `cd cli && go build ./... && go vet ./... && go test ./... && make routes` green
- [ ] The role exists, the app is registered and enabled, and
      `SELECT slug, enabled, maintains_blob_index FROM platform.apps WHERE slug='billing'`
      returns `billing | t | t`
- [ ] **The boundary probe has been run as `billing_app`**, its positive checks
      (1), (4a) and (4e) read first, check (4d) naming `blob_refs_purge`'s own
      refusal, and the transcript is in `apps/billing/docs/backend.md` stamped
      with a commit
- [ ] `billing_app` owns nothing and holds no DDL-implying privilege — the two
      one-query assertions at the foot of `docs/sql/billing-app-role.sql`
- [ ] The first deploy log says **"applying Drizzle migrations"**, not "skipping"
- [ ] `bk login --server https://billing.blackcode.ch` round-trips through the
      browser page, and `bk app list` shows `billing` with its `base_url`
- [ ] `bk billing workspace create` then `list` works, and the created
      workspace's rows are **in `billing.workspaces`** — checked in the
      database, not inferred from a 201
- [ ] The login page and the empty dashboard open in a browser, in FR and EN,
      with zero console errors
- [ ] `BILLING_DISPLAY_NAME=Acme npm run dev` changes the tab title and the
      landing heading, and `/api/meta` still reports the slug `billing`
- [ ] No RENDERED string carries the product name, asserted by
      `lib/no-brand-literal.test.ts` and watched failing on the literal in JSX
      text, on the literal in a string, and on an empty file list.
      **The plain `grep -rn "b/billing" apps/billing/app apps/billing/components`
      this list used to ask for is over-broad and cannot pass**: run on
      2026-09-17 it returned five hits, all of them comments explaining why the
      name is environment-driven. A criterion nobody can satisfy is one somebody
      ignores, and the granularity of a text scan is part of what it checks
      (finding #11). The test strips comments first
- [ ] **These guards were watched failing, then restored:** the parity test with
      the guide topics directory renamed away; `app-isolation`'s third case with
      `import { listMyWorkspaces } from '@blackcode/platform-db'` added to a
      page; `migration-journal` with one journal entry removed;
      `migration-ledger` with the ledger table name reverted to the default

## Frontend gets

Nothing to build against yet. The login page and the empty dashboard exist so
there is somewhere to land, and the empty dashboard's copy matters more than it
looks: **a new tenant's first hour is entirely empty states**, and this one has
to say what the app is for and what would fill it.

## Notes

**The empty-state question this app has to answer deliberately.**
`docs/2026-08-multi-app-refactor.md` §9.1 is still open: a person arriving on a
session cookie from another blackcode app gets a valid session here and **no
workspace**, because `ensureWorkspaceForUser` runs only in the sign-in callback
and in `POST /api/auth/register`, and a cookie-arriving visitor takes neither
path. Their only way out is to sign out and back in.

Three candidate answers exist and none has been taken: bootstrap on first
authenticated request (cheap, but then any app silently mints tenancy for anyone
with an account), an explicit "get started" button calling one route, or decide
the app is invite-only and the empty state is correct. **Pick one in this phase
and write it down.** The scaffold's empty state names the situation rather than
pretending it cannot happen, which is the minimum.

**`/api/me/footprint` must name itself in its reply.** Point one
`platform.apps.base_url` at another app in the suite and the account census
reports both as reachable, with the same data under two names; a whole-account
close then purges one origin twice and closes the account over untouched data.
The fix already in the platform is to reject a reply whose `app` is not the app
addressed — on the census **and** on the purge. So: answer with your own slug,
and treat `base_url` as something to verify rather than trust.

**`ON DELETE RESTRICT` on `billing.workspaces.owner_id` stays, and it is inert.**
It cannot fire against the `UPDATE` that soft-deletes a user. What actually
protects the data is `footprint`. Keep the constraint, and know what it does not
do.

**A per-app copy is not a copy.** Dropping the columns that only existed because
a platform table was shared is part of copying it: no `app` column anywhere (the
schema name is the answer), and no `workspaces.deleted_at`, which has never had
a writer in any app and would acquire a second meaning by being carried forward.

**Do not add an ESLint rule for cross-app imports.** One existed, was inert
against the real escape shape, survived its own diagnosis for four days, and was
deleted on 2026-08-06. `lib/app-isolation.test.ts` is the boundary. If you want
more confidence, add a case there.
