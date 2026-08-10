# Adding an app

**The authoritative guide.** Self-contained: you should be able to follow this
top to bottom without having seen this repo before. For *why* the platform is
shaped this way, see [`2026-08-platform-migration.md`](2026-08-platform-migration.md);
for the current design rules, [`platform-architecture.md`](platform-architecture.md).
Neither is required reading to finish this document.

**A second app has now been built from this document.** `apps/sales` was written
between 2026-08-06 and 2026-08-07 and it is the reason this file changed shape:
roughly thirty things in it were wrong, missing, or true only of the app that
wrote them. What the second app actually cost, and which parts of that were
platform debt rather than app work, is at the bottom — **read that section before
estimating anything.**

> **Copy `apps/_scaffold`.** It is a real app: one entity, one route, its own
> migrations, the platform route factories, an entity projection and its
> reconciler, a CLI command group, a guide topic and a page. It builds, lints and
> passes every guardrail. Do not start from `apps/issues` — you will inherit
> eleven tables and a dashboard you then have to delete.

Three rules before you start:

- **The slug is one string in six places.** Directory, `lib/app.ts`, Postgres
  schema, `platform.apps.slug`, the CLI namespace, the guide topics directory.
  Nothing derives it from anything else, deliberately — a slug inferred from a
  directory name is a slug that changes when someone moves a folder.
- **Choose a slug that means ONE thing, and grep for it first.** Your slug is
  matched against text by guards you did not write. The scaffold's used to be
  `template`, which is also a sales ENTITY (`bk sales template`), a Go local, and
  a word every migration uses in prose — four guards mis-fired on the collision
  and every one of them looked correct. Run `grep -rw '<slug>' . ` before you
  commit to it; a rename later is five places plus a deprecation row.
- **Nothing here is optional except where it says so.** Every step exists
  because skipping it fails later and further away.

---

## 0. What you are building on

### What the platform gives you

Seven packages under `packages/platform-*`. **Apps import these; apps never
import each other.**

| Package | What it gives you |
|---|---|
| `platform-db` | The Drizzle schema and client factory for the `platform.*` tables — users, workspaces, members, app access, uploads, comments, labels, events, entities, links, the blob-reference index. Plus the platform-owned WRITES you must not reimplement: `recordPlatformEvent` + the platform fan-out (D-23), `createInboxMessage`, and the four sign-in callbacks (`getUserByEmail`, `touchLastLogin`, `upsertUserFromOAuth`, `materializePendingInvitationsForUser`) |
| `platform-api` | The HTTP plumbing: the shared `apiHandler` / `resolveWorkspace` behind an `AppContext`, **the platform route factories** (`@blackcode/platform-api/routes`), per-app access enforcement (`requireAppAccess` — the 403 with a hint), the `Errors` envelope (`{ error, code, suggestion? }`), `jsonList()` → `{ data, next_cursor }`, cursor pagination, log sanitisation, platform-wide limits |
| `platform-auth` | Identity, and only identity: API tokens, password handling, the platform whitelist. No HTTP — `requireAppAccess` moved to `platform-api` on 2026-08-06, because its whole job is constructing a 403 |
| `platform-ui` | The design system: `components/ui/` primitives, the TipTap rich-text editor and its media companions. **Two lines, not one:** `transpilePackages` in `next.config.js` makes it compile, and `@source "…/packages/platform-ui/src"` in your Tailwind stylesheet makes its CSS exist. Neither implies the other and only the first fails loudly — see step 1 |
| `platform-storage` | The upload ledger, app-prefixed paths, the per-app reference-scanner registry, and the GC **that will not delete a file any app still references** |
| `platform-agent` | The merged changelog feed and the advertised CLI version floor |
| `platform-testing` | The two guards every app copies: the CLI-parity harness and the app-isolation checks (`findCrossAppImports`, `findCrossSchemaQueries`) |

**When does something belong in a package rather than your app?** One question:

> **Would another app need this *unchanged*?**

Yes → `packages/platform-*`. No → keep it in your app. "Nearly unchanged" is a
no. The test is **two real apps needing it unchanged**, not one app and a guess.

`apiHandler` and `resolveWorkspace` are the worked example of that rule running
its full course. They were deliberately duplicated in the scaffold for one whole
app's lifetime, under a header saying so and naming the trigger — "when a REAL
second app lands". On 2026-08-06 it landed, and they moved to `platform-api`
behind an `AppContext` (`docs/sales-app-plan.md` Phase 1a, D-2). Waiting cost
nothing; extracting early would have baked one app's shape into the interface.

**So you inherit them, and you no longer write them.** Your `lib/api.ts` is the
four lines of `appContext` and two binds — copy `apps/_scaffold/lib/api.ts`.

This cuts the other way too, and the migration learned it the expensive way:
before reshaping a shared table so more apps can use it, ask whether they should
be sharing it at all. `workspace_counters` was going to become
`(workspace_id, app, entity_type, last_seq)`; it moved to
`issues.workspace_counters` instead, because sharing a counter buys nothing and
costs a shared write point and a shared migration per entity type.

### What you no longer have to do

This section exists because the list below **used to be checklist items**, and a
thing on a checklist is a thing an app can forget. Every row is work `apps/issues`
did by hand and `apps/sales` did not have to.

| You inherit | What it used to mean | Where it lives now |
|---|---|---|
| `apiHandler` and `resolveWorkspace` | ~60 lines copied per app, including the 401/404/403 gates, which are easy to get subtly wrong in the 404-vs-403 direction | `platform-api`, behind your four-line `AppContext` |
| **The error log** | Wiring `platform.error_events` yourself. An app that forgot had no error log and nothing went red | the shared `apiHandler`. `bk super-admin errors` covers you from your first commit |
| The agent breadcrumb and CLI-version headers | Remembering to set `X-BK-*` on every response | the shared `apiHandler` |
| Cursor pagination, `jsonList()`, the `Errors` envelope | Re-deriving the `{ data, next_cursor }` shape and hoping it matched | `platform-api` |
| Per-app access enforcement | Writing your own 403, without the hint | `requireAppAccess`, called by `resolveWorkspace` |
| The four sign-in callbacks | A second copy of `materializePendingInvitationsForUser`, i.e. a second chance to swallow somebody's pending invitations | `platform-db` |
| The platform event fan-out | Handling invitation/membership events yourself, and delivering every notification twice | `recordPlatformEvent` (D-23) |
| The cross-app entity index, links and search | There was no cross-app anything | `platform.entities`, `platform.links`, the `searchRoute`/`linksRoute` factories |
| The two guards | Writing your own parity and isolation checks | copied from the scaffold; the harness is in `platform-testing` |
| The shared-package schema guard | Registering your app somewhere | nothing — it derives app names from each `APP_SLUG` |
| **The session cookie migration** | It signed everyone out once. It is done | `sessionCookieConfig()` (D-16) |

**And what the SCAFFOLD now carries that `apps/sales` had to invent** — every one
of these was written from scratch for the second app, late, because there was
nothing to copy:

- `middleware.ts` with `withAuth({ cookies: sessionCookieConfig() })`. Sales' was
  modelled on the app that had it wrong and produced a permanent login bounce
  with a 200 on every request. There is now also a guard
  (`platform-testing/test/middleware-session-cookie.test.ts`) so the scaffold
  being right is not the only thing standing there.
- `app/globals.css` with the `@source` line (D-30), `postcss.config.js`, and
  React pinned to 18.3.1 to satisfy `platform-ui`'s peer range.
- `drizzle.config.ts` with **its own migration ledger** (D-34).
- `vercel.json` — four settings the dashboard will not give you, three invisible
  when wrong.
- Two migrations, including a blob-reference trigger with the ordering spelled
  out.
- An entity projection wired **inside** the write transaction, and
  `scripts/reproject.ts`, its per-app reconciler.
- Nine platform route factories mounted, and the `UNSERVED_OPERATIONS` mechanism
  in its parity test that you need the moment you mount the first one.

### The boundary rules

Three, and the third is enforced by the database rather than by review.

1. **`platform.*` is shared.** Your app may read, write and FK into it freely.
2. **Your schema is yours.** `sales.*` is unconstrained — nobody else can see it,
   so its migrations need no coordination. Platform-schema changes are the
   opposite: expand → migrate → contract, because apps deploy independently and a
   breaking `platform.*` change breaks every other app for the length of the
   window.
3. **You may not read another app's schema.** Not "should not" — *may not*. Each
   app connects as its own Postgres role, and `sales_app` has no `SELECT` on
   `issues.*`. Cross-app reads go through that app's HTTP API, or through
   `platform.links` / `platform.events`.

Two guards back this up inside the repo, and both are copied into your app:
`lib/app-isolation.test.ts` (no import resolving into another app, no query
naming another app's schema) and `lib/cli-parity.test.ts`. There is deliberately
**no ESLint rule** for the import half — one existed, it was a glob over import
strings, and it never matched the shape that actually escapes an app. Do not add
one back.

### The agent surface

Humans use the web UI. **Agents use one interface: the `bk` CLI.** The HTTP API
under `apps/<app>/app/api/**` is private plumbing with no public contract — do
not document it for external consumers and never add an OpenAPI spec.

Three entry points, and your app inherits all three:

| Entry point | Answers | Lives in |
|---|---|---|
| `bk guide` | *How does this tool behave?* — flags, exit codes, workflows | `cli/internal/guide/topics/`, embedded in the binary |
| `bk meta` | *What is the data right now?* — vocabularies, limits, workspaces | the server, `GET /api/meta` |
| `bk changelog` | *What changed, and how do I adapt?* | `docs/changelog/*.md` |

The rule that keeps them coherent: **a guide topic never restates a value that
`bk meta` carries.** Static behaviour ships in the binary; dynamic data comes
from the server. `guide_test.go` fails the build on a hardcoded vocabulary or
size limit.

**Every change lands in three places, in the same commit:**

> **route → `bk` command (+ its `routes` annotation) → changelog entry.**

Plus a conditional fourth: a guide topic, *only* if agent-visible behaviour
changed. If only a value changed, edit its source — `bk meta` serves it live.

**Commands are namespaced per app**: `bk sales deal create`, never `bk deal
create`. Three tiers decide the spelling (D-11, `bk guide platform/apps`):

| Tier | Verbs | Spelling |
|---|---|---|
| Neutral — same answer from any app | `login` `logout` `meta` `guide` `changelog` `skill` `version` `app` `workspace` `member` `invite` `token` `profile` `inbox` `super-admin` | bare |
| Cross-app — spans every app by design, results tagged | `search` `activity` `link` `storage` | bare |
| App-owned — the answer depends on the app | your nouns, **plus** `upload` `trash` `label` | `bk <app> <verb>` |

The test is *"would two deployments answer differently?"*, never *"is it shared
code?"* — `storage` is shared code AND cross-app, because uploads are one ledger
against one workspace quota (D-28). You upload INTO one app and list ACROSS all
of them.

The app-owned platform verbs are shared code in `cli/internal/appverbs`. Your
group mounts them in one line:

```go
cmd.AddCommand(appverbs.New(appverbs.Config{App: Slug, TrashTypes: […]}).All()...)
```

Forget it and your own `lib/cli-parity.test.ts` fails: `POST /api/upload` is
real in your tree and no `bk` command claims it.

Registering the group in `root.go` is also what PINS its server: everything under
`bk <app> …` resolves through `app_servers[<app>]`, learned from your
`platform.apps.base_url` (§3). Nothing else is needed — but if that column is
NULL, every command in your group fails with *"no server known for app …"*
rather than quietly reaching somebody else's deployment.

---

## 1. The app directory

```bash
cp -R apps/_scaffold apps/sales
cd apps/sales
```

Then rename, in this order:

| File | Change |
|---|---|
| `package.json` | `"name": "sales"` |
| `lib/app.ts` | `APP_SLUG = 'sales'`, and delete the note about the scaffold's underscore |
| `lib/db/schema.ts` | `pgSchema('sales')`, and rename `scaffoldSchema` |
| `lib/db/queries/entities.ts` | your entity types, and `entityPath()` — **your app's URL scheme is the one thing the copy cannot know** |
| `lib/db/migrations/*.sql` | your schema and your triggers; rename the schema in both |
| `lib/db/migrations/meta/_journal.json` | the migration tags, to match |
| `drizzle.config.ts` | `table: '__drizzle_migrations_<slug>'` — **a shared ledger silently skips your migrations (D-34)** |
| `scripts/reproject.ts` | the `<SLUG>_REPROJECT` gate name |
| `app/globals.css` | your palette. **Leave the `@source` line exactly as it is** |
| `middleware.ts` | your authenticated path prefixes. **Leave the `cookies: sessionCookieConfig()` line exactly as it is** |
| `vercel.json` | nothing |
| `lib/cli-parity.test.ts` | nothing — it reads `APP_SLUG`. You will add `UNSERVED_OPERATIONS` entries as you mount factories |
| `lib/app-isolation.test.ts` | `OTHER_SCHEMAS` — list every OTHER app's schema |
| `next.config.js` | `allowedOrigins`, and nothing else unless you add a platform package |

The `@source` line, the `cookies:` line and the ledger table name are the three
the copy gives you and that a careless rename takes away again. Each fails
silently; each has a guard, and the guards exist because the scaffold being right
is not enough on its own.

Add the new app's schema to **every other app's** `OTHER_SCHEMAS` too. That is
the one edit outside your own directory, and it is what makes the isolation
guard symmetric.

> **The `@source` line is not optional and its absence is silent — and the
> scaffold now ships it, so your job is not to delete it.** Tailwind v4
> auto-detects sources from the project root and skips `node_modules`;
> `@blackcode/platform-ui` reaches your app through a workspace symlink in there,
> so without this line every utility class used ONLY inside the package is never
> generated. When it was found on 2026-08-06 that was **151 classes** in
> `apps/issues` — the login page's tab switcher had no active state and the
> landing page's accordion did not animate, in production, for months. There is
> no error, no build failure and no type error; the page just renders slightly
> wrong. `packages/platform-testing/test/ui-package-styling.test.ts` fails if an
> app compiles the package without scanning it, which is why you will find out
> at `npm test` rather than by looking.
>
> **`transpilePackages` makes the TypeScript compile; `@source` makes the CSS
> exist.** Neither implies the other.

```bash
npm install          # only needed if you also added a new packages/ workspace
npm run typecheck    # should pass before you write a line
```

## 2. The Postgres schema, role and grants

Read [`platform-db.md`](platform-db.md) first — it explains the two credentials
and why the app role owns nothing.

**The order below is not the order you will guess, and it was rehearsed on
2026-08-07 because the guessed one silently does not work.** Provisioning is
interleaved with the first deploy; it is not a block of SQL you run up front.

| | Do this | Why here |
|---|---|---|
| 1 | Insert the `platform.apps` row with **`enabled = false`** (step 3) | Your first migration sets `maintains_blob_index` on this row and is guarded on it existing. Register later and the flag is never set — and re-running the migration will not fix it, because Drizzle records it as applied. |
| 2 | `docs/sql/app-role.sql` as `neondb_owner` | Creates the schema, the role and the grants. |
| 3 | **Deploy. The migrations run.** | Tables, triggers, backfill, flag. |
| 4 | The boundary probe, **as the app role** | Only now does the schema have tables for it to read. |
| 5 | Flip `enabled = true` | Only once the app can answer for its own blob references. |

`docs/sql/app-role.sql` **creates the schema itself** — do not do it separately,
and do not move that line. Every grant in the file names the schema, so with the
schema absent five of its ten statements fail:

```
ERROR:  schema "sales" does not exist       (×5, one per grant)
PSQL EXIT=0
```

**`psql` exits 0.** The role comes out with no grants at all and the provisioning
step reports success — CLAUDE.md finding #7 in a new costume. The file now opens
with `\set ON_ERROR_STOP on` for the same reason. `apps/issues` never hit this
because `issues` was created by migration 0033, years before anyone wrote a role
script for it.

**Do not skip step 5b** (revoke write on `platform.blob_references`, leave
`SELECT`) or **5c** (grant `EXECUTE` on `platform.blob_refs_purge` — a new app
role gets none, and `bk super-admin blob-drift --repair` then cannot clear an
orphaned reference).

**Then prove the boundary, as the new role — after the migrations:**

```bash
psql "postgres://sales_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
```

Every deny must be `42501` — **and that is the weaker half of the check.** A role
that was granted nothing at all also denies everything with 42501, and passes six
of the probe's eight denial checks. Read the *positive* lines first — `(1)`,
`(4a)`, `(4e)` — and check that `(4d)` names `blob_refs_purge` rather than
saying *"permission denied for schema platform"*. The probe's header carries the
full transcript of both outcomes side by side.

> **This is a manual provisioning step, and it cannot become a CI test.** That is
> not laziness about automation — the properties it checks are only observable
> from a session **authenticated as** the app role, and CI has no app-role
> credential. `SET ROLE` from the owner is not a substitute and quietly gives the
> wrong answer: `session_user` ignores `SET ROLE` by design, and inside a
> `SECURITY DEFINER` function `current_user` is the function's *owner*, never the
> caller. That exact mistake is why the probe exists — `platform.blob_refs_purge`
> guarded on `current_user` and was therefore true for everybody, so any app
> could purge any other app's blob references. Nothing but running this as the
> real role would have shown it.
>
> So: **run it by hand when you provision the role, and again whenever you change
> a grant.** Check (2) reports `SKIPPED` loudly if yours is the only app schema —
> that is correct, not a pass. See `platform-db.md`.

## 3. The row in `platform.apps`

```sql
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES ('sales', 'Sales', 'Deals and quotes', 'https://sales.blackcode.ch', true);
```

**`base_url` is load-bearing since CLI 3.0.0 (D-1).** It is what `bk login` and
`bk meta` learn each app's address from, and the CLI refuses to guess: with the
column NULL, `bk sales …` fails with *"no server known for app sales"* on every
machine, however correct everything else is. Set it to the real deployment URL in
this row — not later, not in a follow-up. `bk app list` is where you check it.

**Read this before you run it.** The moment this row exists, every deployment's
blob-delete gate asks whether `sales` references a file. Until step 4 gives it an
answer, **blob deletion refuses everywhere** — correctly, because nobody can
prove a file is unused. That is not a bug; it is the gate working.

So either do steps 3 and 4 together, or insert with `enabled = false` and flip it
when the triggers are in.

## 4. Blob-reference triggers — for any content that can hold a file URL

If any column of your app can contain an uploaded file's URL — a description, a
body, a comment, an attachment row — it needs a trigger, in your app's first
migration. Copy the shape from `apps/issues/lib/db/migrations/0037_blob_reference_index.sql`:

```sql
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('sales', 'quote', 'workspace_id', 'scan', 'body');
```

…then, **at the bottom of the same file, after the backfill**:

```sql
UPDATE sales.quotes SET body = body WHERE body IS NOT NULL;   -- backfill by re-triggering
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'sales';
```

Order matters: setting the flag before the backfill advertises an empty index as
authoritative, which is how a file still in use gets deleted.

> **THIS IS THE ONE STEP THAT IS EASY TO FORGET AND EXPENSIVE TO MISS.** The
> index is trigger-maintained precisely so no *write path* can forget it — which
> moves the whole risk to here, to adding a content column without a trigger.
> **Every time you add a column that can hold a URL, add its trigger in the same
> migration.** Nothing will remind you: `bk super-admin blob-drift` compares the
> index against a live scanner, and an app with no scanner has nothing to compare
> against.

## 5. The CLI command group

```bash
cp -R cli/internal/commands/scaffold cli/internal/commands/sales
cp cli/internal/client/scaffold.go cli/internal/client/sales.go
```

- Rename the package and `Use: "sales"`.
- Register it in `cli/internal/commands/root.go` — one line beside
  `issues.NewGroup()`.
- **Every leaf command needs a `routes` annotation**, or the literal `"none"`.
  `cli/internal/commands/routes_test.go` fails the build otherwise.
- Command packages must not import each other (`boundaries_test.go`). Anything
  two need goes in `cmdutil`.

```bash
cd cli && go build ./... && go test ./... && make routes
```

## 6. Guide topics

```bash
mkdir cli/internal/guide/topics/sales
```

At least one topic, with a `# Title`, a summary line and a `Related commands:`
line — `guide_test.go` checks all three. Two more rules it enforces:

- **Never state a dynamic value** (a status name, a byte cap). Write "run
  `bk meta`" instead. A guide ships inside the binary; a value does not.
- **A topic under `topics/<app>/` may not describe another app.** Shared
  behaviour belongs in `topics/platform/`.

This directory is also what gives your CLI routes their app attribution — the
parity guard reads `guide.AppSections()`. An app with no topics directory has its
routes attributed to `platform`, and its parity test will tell you so.

---

> ## ✅ CLOSED — every step walked against a real deployment, 2026-08-10
>
> Steps 1–6 were walked on 2026-08-05 against a throwaway app; steps 7 and 10 on
> 2026-08-07 by `apps/sales`. **Steps 8 and 9 were closed on 2026-08-10 by
> deploying `apps/sales` to production**, which is the first time this checklist
> has been followed end to end by anyone.
>
> **Do not sign this box because the app builds.** Sign it when the proofs below
> have actually been observed, in production, by the person who ran the deploy.
>
> | Step | Status | What closes it — the observation, not the intent |
> |---|---|---|
> | **7** `docs/changelog/<app>.md` | ✅ **closed 2026-08-07**, `apps/sales` | `bk changelog` and `GET /api/changelog` return sales entries with no registry edit. The directory read is the discovery mechanism; adding the file was the whole step. |
> | **8** Vercel project | ✅ **closed 2026-08-10**, `apps/sales` | (a) `./devops/release.sh apps` lists two apps ✓; (b) `release.sh web sales` deployed to `bc-sales` via `VERCEL_PROJECT_ID`, not to the linked project ✓; (c) **not observable, and that is fine** — `vercel.json` sets `git.deploymentEnabled.main = false`, so a push never builds and `turbo-ignore` has nothing to skip. Delete this proof or re-scope it to preview builds; (d) region ✓ — `vercel inspect` shows every lambda `[fra1]`. |
> | **9** Subdomain + cookie domain | ✅ **closed 2026-08-10**, `apps/sales` | Signed in at `issues.blackcode.ch`, opened `sales.blackcode.ch`, **already signed in** — the app rendered the user's identity and workspace list with no login. Note it proves the two apps hold the SAME `NEXTAUTH_SECRET`; it does not prove it was *copied* (here it was rotated onto both, because the value could not be read — see `docs/env.md`). |
> | **10** `apps/<app>/docs/` | ✅ **closed 2026-08-07**, `apps/sales` | `apps/sales/docs/{backend,frontend}.md` exist and describe only sales; the split rule held under a real second app. |
>
> ### What the first real deployment found that this checklist did not say
>
> Four things went wrong on 2026-08-10. None reached a user; all four are now
> covered in the steps below, and they are what a reconstruction could not know.
>
> 1. **The repo had no `.vercelignore`, and Vercel does not read `.gitignore`.**
>    The first upload was **8.5 GB** — `.turbo` (16 GB on disk) and `cli/dist`
>    (1.1 GB). With the file: 66 MB. It lives at the repo root and is shared by
>    every app, so app #3 inherits the fix.
> 2. **`AUTH_COOKIE_DOMAIN` failed the build, correctly.** `NEXTAUTH_URL` on the
>    *existing* app was still the `*.vercel.app` URL. Nothing had ever depended
>    on it — NextAuth derives the origin from the request — so it had been wrong
>    and invisible for months. **Check `NEXTAUTH_URL` is the app's real public
>    URL on EVERY app before setting the cookie domain**, not just the new one.
> 3. **`NEXTAUTH_SECRET` could not be copied.** It is stored sensitive and is
>    unreadable to the dashboard and to `vercel env pull`. Rotation onto every
>    app is the answer; `docs/env.md` now leads with checking which you face.
> 4. **Connecting the Blob store put the PRODUCTION store on the new app's
>    PREVIEW environment too** — a preview build could have deleted real files.
>    Connect production and preview stores separately, and check afterwards.
>
> | | |
> |---|---|
> | Walked | steps 1–6, 2026-08-05, throwaway app · steps 7 + 10, 2026-08-07, `apps/sales` · steps **8 + 9**, 2026-08-10, `apps/sales` in production |
> | Still unverified | **nothing** — but see 8(c) above, which is unobservable by design rather than passed |
> | Closed by | Balathanusan Jeyarasan, `apps/sales`, 2026-08-10. Proofs seen: 8(a), 8(b), 8(d), 9. |

## 7. `docs/changelog/sales.md`

One file. It is discovered by reading the directory, so there is no registry to
update — `bk changelog` and `GET /api/changelog` pick it up automatically.

## 8. Vercel project

- **Point it at the EXISTING Neon project and Blob store.** One database, one
  store, per-app schemas and per-app path prefixes. A second Neon project breaks
  every cross-app query (`bk search`, `bk activity`, the blob index) and a second
  Blob store breaks attribution.
- **Root Directory:** `apps/sales`.
- **Copy `apps/issues/vercel.json` into `apps/<app>/` and change nothing.** It is
  four settings the dashboard will not give you by default, and three of them are
  invisible when wrong: `regions: ["fra1"]` (the database is in Europe — the
  default region puts every query across the Atlantic), `ignoreCommand:
  npx turbo-ignore` (or every commit anywhere in the monorepo rebuilds this app),
  `git.deploymentEnabled.main: false` (or pushing to main deploys outside
  `release.sh`), and `no-store` on `/api/*`. `apps/sales` shipped without this
  file until 2026-08-07; nothing in the checklist mentioned it, because
  `apps/issues` had had one since before the monorepo existed.
- Environment: **the full list is in `docs/env.md`, with which values are
  platform-wide and which are per-project.** `NEXTAUTH_SECRET` must end up
  **identical on every app** (D-39) — see step 9 for why copying it may not be
  possible.
- `RUN_MIGRATIONS=1` **Production only**. On Preview it means a preview build
  writes to the production database.
- **Connect the Blob store to PRODUCTION only, then connect the *preview* store
  to PREVIEW separately.** The dashboard's Connect Project dialog offers
  "Production, Preview" together and that is the wrong answer: it points the new
  app's preview builds at the real file store, where a preview can delete files
  that are still in use. There is no undo. Done wrong on 2026-08-10 and caught by
  looking at `vercel env ls` afterwards, which is the check — the dialog gives no
  hint. Also tick **"Add a read-write token env var"**: without it you get
  `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`, which nothing reads, and not
  `BLOB_READ_WRITE_TOKEN`, which is the one the upload route needs.
- **`.vercelignore` is at the REPO ROOT and is already correct** — you inherit
  it. Do not add a per-app one. Vercel does not read `.gitignore`, and without
  that file the first deploy of any app in this monorepo uploads `.turbo` and
  `cli/dist`: 8.5 GB instead of 66 MB, found on 2026-08-10.

## 9. Subdomain and cookie domain

`sales.blackcode.ch`. The session cookie moved to `.blackcode.ch` in Release 1
(D-16) — that migration is done, and it **signed everyone out once**. A new app
inherits it and does not repeat it.

What a new app must get right, in this order:

1. Attach the domain and wait for Vercel to show **Valid Configuration**.
2. Set `NEXTAUTH_URL` to the real `https://<app>.blackcode.ch`.
3. Only then set `AUTH_COOKIE_DOMAIN=.blackcode.ch`, **production only**.

The order is enforced: `packages/platform-auth/src/session-cookie.ts` **throws at
startup** if `AUTH_COOKIE_DOMAIN` is set and `NEXTAUTH_URL`'s host is not under
it. That is deliberate — a browser silently drops a cookie whose `Domain` it does
not accept, and the symptom is every sign-in succeeding and bouncing back to
`/login` with nothing in the logs. A boot failure is loud and names both values.

Never set `AUTH_COOKIE_DOMAIN` on Preview or Development: a preview runs on
`*.vercel.app`, which is not under `.blackcode.ch`.

**Step 2 is not only about the new app.** On 2026-08-10 the *existing* app's
`NEXTAUTH_URL` was still its `*.vercel.app` URL — wrong for months, invisible
because NextAuth derives the origin from the request, and harmless right up until
a cookie domain depended on it. It failed that app's build, not the new one's.
**Check `NEXTAUTH_URL` on every app before setting the cookie domain anywhere.**

**And `NEXTAUTH_SECRET` must be the SAME on every app (D-39)** — the cookie is
encrypted with it, an app holding a different one cannot read the others'
sessions, and the only symptom is a person being asked to sign in twice.
*Copying* is the cheap way, but **check first that you can**: it is typically
stored sensitive, and then it is unreadable to both the dashboard and
`vercel env pull`, which returns the literal `[SENSITIVE]`. When it cannot be
read, generate ONE new value, set it on every app, and redeploy every app —
which signs everyone out once, so do it on the deploy that was going to sign
them out anyway. `docs/env.md` has both paths.

## 10. `apps/sales/docs/`

`backend.md` and `frontend.md` for this app only. Root docs never describe an
app's internals; an app's docs never describe another app
(platform-architecture.md §7.5).

## 11. What the scaffold deliberately leaves out

The list used to be long. Most of it moved INTO the scaffold on 2026-08-07, for
one reason: every item on it had been forgotten by the second app, and a thing on
a checklist is a thing an app can forget.

What is left is what genuinely cannot be copied, because it needs a decision only
you can make:

- **The entity projection's URL scheme.** The scaffold ships the projection
  wired into its write transaction, plus `scripts/reproject.ts`. What it cannot
  give you is `entityPath()` — where one of your records lives in YOUR UI. That
  one function is the reason the projection cannot live in a platform package.

  **And you need the reconciler even though `bk super-admin entity-drift`
  exists.** That command is bound to one deployment's app and cannot be
  otherwise: an app's Postgres role has no grant on another app's schema. Run
  against a database holding 51 unprojected sales rows, it reported no drift and
  exited 0 — CLAUDE.md finding #14, and worse than a dead test, because a
  reconciler is what you reach for when you already suspect something is wrong.
- **A browser session.** The scaffold authenticates bearer tokens only, which is
  the path agents use, and ships the `middleware.ts` that gates the browser half.
  NextAuth config itself is genuinely app-specific — see the note in
  `packages/platform-auth/src/index.ts`. Until you add one, do not mount
  `/api/tokens`: it requires `AppContext.resolveSessionUser` and throws at import
  time without it, on purpose.

  **When you do add it, do not touch the `cookies:` line in `middleware.ts`.**
  `withAuth` defaults to looking for `next-auth.session-token`; D-16 renamed this
  platform's cookie. A gate that omits it sends every signed-in user back to
  `/login`, forever, with a 200 on every request and nothing in the logs.
  `platform-testing/test/middleware-session-cookie.test.ts` asserts it for every
  app, which is the half that does not depend on anyone noticing.

  **What those callbacks DO to the database is not app-specific, and is already
  written.** `getUserByEmail`, `touchLastLogin`, `upsertUserFromOAuth` and
  `materializePendingInvitationsForUser` come from `@blackcode/platform-db` —
  there is one login for every app, so a second copy is a second chance to
  swallow somebody's pending invitations. What you write yourself is
  `authOptions` (your providers, your cookie, your redirect pages) and your own
  `createWorkspace` / `ensureDefaultWorkspace`, because each app has its own
  post-create step.

- **Anything that records an event.** Use `recordPlatformEvent(tx, { app, … })`
  from `@blackcode/platform-db` for workspace / membership / app-access /
  invitation events; write your own `recordEvent` only for your own entity types,
  and delegate the platform ones to it in ONE place. Two rules, both load-bearing
  (see `docs/backend.md` → *The seam*): pass your `APP_SLUG` rather than a
  literal — `platform.events.app` is the **producing** app — and never handle the
  five platform fan-out actions in your own `fanOutEvent` as well, or every
  invitation notification is delivered twice.

**An error log used to be a third item here.** It no longer is: the shared
`apiHandler` writes to `platform.error_events` for every app that uses it, so
`bk super-admin errors` covers you from your first commit. That is the point of
the extraction — a thing on a checklist is a thing an app can forget, and an app
that forgets its error log has no error log and nothing goes red.

### Which platform routes to mount

`@blackcode/platform-api/routes` exports one factory per shared route. Mount the
ones your app serves, in your own tree — Next routes by filesystem, so there is
no central mount and nothing warns you about one you skipped.
`lib/cli-parity.test.ts` is what catches it.

**They are NOT all "three lines each".** That sentence was in this document, and
it produced a code block in this repo that did not compile. There are three
classes and you have to know which one you are looking at:

| Class | Shape | Examples |
|---|---|---|
| **A — pure** | `export const GET = xRoute(appContext)` | `usersRoute`, `changelogRoute`, `searchRoute`, `workspacesRoute`, `workspaceShowRoute`, `workspaceMembersRoute`, `workspaceAppsRoute` |
| **B — takes a CONTRIBUTION** | `xRoute(appContext, { …your app's part… })` | `activityRoute` needs your entity types, your actions, and a `resolveEntitySeqs` that maps YOUR rows to #numbers; `workspaceInvitationsRoute` needs an `InvitationSender`; `passwordConfirmRoute` needs a `PasswordOtpSender` |
| **C — per-app by design** | you write it; there is no factory | `/api/meta` (D-20) — it serves YOUR vocabularies and limits |

A Class B factory with no contribution does not compile, which is the good case.
The bad case is a contribution that is *shaped* right and *wrong*:
`activityRoute`'s `resolveEntitySeqs` can only read the mounting app's tables, so
an implementation that guesses at a foreign row's number will serve another app's
internal row id with a `#` in front of it. That shipped, from both hosts, and
looked completely plausible until somebody compared it with the database.

Some factories also have a required piece of `AppContext`. `tokensRoute` throws
**at mount time** if your app supplies no `resolveSessionUser`, and deliberately
does not fall back to `resolveUser`: a bearer token that can mint another is
privilege escalation, because revoking the first would not revoke what it
created. So an app with no browser session does not mount `/api/tokens` — that is
a decision, not an omission, and it belongs in `UNSERVED_OPERATIONS` or simply
unmounted.

**Mount only the ones your app should answer for — and then apply the test.**

> **A permanent subset is legitimate. An ACCIDENTAL subset is a bug. The test is
> whether every bare verb has a host, from THIS app's login.** (D-36, as amended
> 2026-08-07.)

`apps/sales` has no reason ever to serve `bk inbox` (per-user, cross-workspace),
`bk super-admin errors` (platform-wide data, any host answers) or `bk storage
list` (D-28: one ledger, one quota, same rows from every deployment). Those are
decisions. But the sales deployment also, accidentally, served 7 of 54 platform
routes — and the north-star run failed at its **second command**, because
`bk workspace use` resolves through `GET /api/workspaces/{ws}`. Both states look
identical from inside the app: everything the app itself does works.

So run the test literally. Log in against your deployment and walk the bare
verbs. If the answer to any of them is *"yes, but you have to `bk app use`
something else first"*, the subset is accidental, because a server switch is
exactly what a multi-app platform exists to remove.

The one to check first is `GET /api/workspaces/{ws}`. Almost every other command
needs an active workspace, so an app that does not serve it fails at the second
command an agent types and every command after it.

Your drift check covers the platform routes you actually have a file for, derived
from the filesystem, so there is nothing to declare and nothing to forget to
declare. **What you WILL need immediately** is `UNSERVED_OPERATIONS` in your
parity test: drift is scoped to *paths* you have a file for, so mounting
`GET /api/workspaces/{ws}` pulls `PATCH` and `DELETE` on that path into your
check whether or not you export them. That is correct, and the answer is a
reasoned entry in `UNSERVED_OPERATIONS` — **not** `EXCLUDED_PATHS`, which pushes
on coverage and would remove the path from the very set drift compares against.
The scaffold ships three worked entries. *(Superseded 2026-08-07: this step used to tell you to set
`hostsPlatformRoutes`. That flag is gone — it could only say "all of the platform
surface" or "none of it". Full reasoning in
`packages/platform-testing/src/cli-parity.ts`.)*

The other half — "does at least one app serve every platform command's route?" —
is asserted once for the whole repo in
`packages/platform-testing/test/platform-route-coverage.test.ts`. **Do not copy it
into your app.**

And write one export per method: `export const GET = handlers.GET`, never
`export const { GET } = handlers()`. The second serves identically and is
invisible to the parity guard, which now detects and refuses the form.

## 12. Before you call it done

From the repo root:

```bash
npm run typecheck && npm test && npm run lint && npm run build
cd cli && go build ./... && go vet ./... && go test ./... && make routes
```

Your app's own tests must include, copied from the scaffold:

- `lib/cli-parity.test.ts` — every route reachable from `bk`, every claimed route
  real
- `lib/app-isolation.test.ts` — no import into another app, no query of another
  app's schema

**You do not need a third one for the shared packages.**
`packages/platform-testing/test/package-isolation.test.ts` scans every
`packages/platform-*/src` for a reference to any app's Postgres schema, and it
**derives the list of app names from each app's own `APP_SLUG`** — so your app is
covered the moment `apps/<you>/lib/app.ts` exists, with nothing to register. If
you ever see that test name your app's schema, the offending line is in shared
code and the fix is a platform table, not an exception.

> Why it exists: a raw-SQL `FROM issues.issues` inside a platform package
> compiles, lints and passes every other test — and then **works in the issues
> deployment and 42501s in yours**, because the boundary is a Postgres grant.
> It works where it was written and fails where it was not.

### Prove it fires — three steps, not two

The standing rule in `CLAUDE.md` is step 1. Steps 2 and 3 were added on
2026-08-06 because each was learned from a guard that had already passed step 1:

1. **Watch the check fail.** Break the thing it guards; restore.
2. **Ask what it would still pass on.** Wrong fixture, wrong wiring, empty input.
3. **Inject that regression and watch it again.**

Step 3 is not ceremony. The seam test in `apps/issues` was written by someone who
performed step 2, wrote a paragraph explaining why the fixture was sound, and was
wrong: every fan-out handler bails politely on an empty lookup, so the fake that
answered every read with `[]` made five assertions incapable of failing. The
suite passed 13/13 with the regression in place. Reasoning about step 2 is
reasoning, and you can be wrong in writing while feeling right.

The same shape appears in any check with an input: **assert that you found
something to check.** A scan over zero files and a filter over zero values both
report a confident green.

---

## What the second app actually cost

**Replaces the timings for the 2026-08-05 throwaway walk.** Those were real and
they were useless for estimating: they measured a scaffold copy, not an app.
Steps 1–6 took well under an hour then, and that number is still true and still
not the answer to "how long does an app take".

`apps/sales` was built between **2026-08-06 and 2026-08-07** by eight agents plus
a coordinating one. The honest split is this:

| | What it was | Share |
|---|---|---|
| **Platform debt** | Work that existed only because the platform had never run two apps. Extracting `apiHandler`/`resolveWorkspace` behind an `AppContext`, the platform route factories, the CLI verb re-tiering, the per-app address book, app-qualified shared tables, the shared session cookie, the chart-kit promotion, the event seam | **roughly half** |
| **Real app work** | Sales' own schema, routes, CLI group, guide topics, pages, search, seed | the other half |
| **Fixing this document** | ~30 findings — things that were wrong, missing, or true only of `apps/issues` | continuous, throughout |

**App #3 does not pay the first column.** That is the entire point of Phase 13,
and it is why the useful number is not "sales took two days" but:

> **Half of the second app was not the second app.**

### What that half actually consisted of

Not one big refactor — a long tail of things that were *correct for one app* and
had no meaning for two. The pattern is worth recognising because app #3 will find
the last of them:

- **Values that had never had to name an app.** `platform.uploads` did not record
  who uploaded a file. `platform.labels` had no `app` column. `bk trash` listed
  one bin. Each is a one-line schema change and a decision about what the old
  rows mean.
- **Verbs whose spelling assumed one deployment.** `bk upload` had no wrong
  answer until there were two apps, at which point it had no right one.
- **Code that could only ever have run in one app.** `resolveEntitySeqs` reads the
  mounting app's tables; `bk super-admin entity-drift` is bound to one
  deployment's schema because a Postgres role has no grant on another's. Both
  looked general and were not.
- **Guards that had only ever been asked one question.** `bk __routes` deduped on
  `method+path`, so a second app's identical path vanished. The boundary probe's
  cross-app check had never had a second schema to point at.

### And the honest failure mode of the whole exercise

**Fourteen guardrails in this repo have been found green-but-inert, and five of
those were found by the phase whose job was to disbelieve the previous ones.**
Two of them were that phase's own new guards, found inert within minutes of being
written. The rate does not fall as the rule gets better known.

So when this document tells you to break a check and watch it fail, that is not
process. It is the only thing that has ever worked here.

### Timings, if you need one

For an app of similar size to sales — nine entity types, ~60 routes, a dashboard —
with app #3 paying no platform debt:

| Phase | Estimate | Confidence |
|---|---|---|
| Steps 1–6 (copy, schema, role, CLI, guide) | under a day | high — walked twice |
| Your routes and query layer | the bulk of it, and it is ordinary app work | high |
| Web UI | the bulk of the rest | high |
| Steps 7–10 (deploy, DNS, cookie domain) | **unknown** | **none — see the box above; nobody has done it** |

The last row is the honest one, and it is why the box is still open.

## What will still trip up app #3

Written down rather than fixed, because each is a real gap and saying so is
cheaper than pretending otherwise.

1. **The scaffold does not mount the app-owned verb tier.** `bk <app> upload |
   trash | label` needs `appverbs.New(...)` in your group AND the routes behind
   it, and the scaffold has neither — because trash and label are app-specific
   routes over app-specific entities, not factories. The pairing IS guarded from
   both sides (mount the routes without the verbs and parity reports an uncovered
   capability; mount the verbs without the routes and it reports drift), so you
   cannot get it half-right. What you can do is get it **zero**-right: an app that
   mounts neither has no app-owned verbs at all, and nothing complains. Copy
   `apps/sales/app/api/workspaces/[ws]/{trash,labels}/` and
   `cli/internal/commands/sales/appverbs.go`.
2. **`bk issues issue view` does not show links back into your app.** The data is
   right — `bk link list <urn>` returns both directions with resolved titles —
   and what is missing is a display in the issues app. D-18's other half.
3. **`platform.events.actor_token_id` is NULL, everywhere, and always has been.**
   `AppContext.resolveUser` returns WHO, not BY WHAT MEANS, so no app can record
   which token a request arrived on. Sales works around it by matching
   `token_prefix` among the user's own tokens. The fix is `resolveUser` returning
   a credential, and it is a shared-interface change.
4. **Purging an issue/task/project orphans its `platform.comments` rows**, and
   because the blob index is trigger-maintained, a file referenced only by an
   orphaned comment becomes **permanently undeletable**. It fails closed, which is
   why nobody will notice. Needs a design call, not a patch.
5. **Seven platform routes still have no factory** — `bk inbox`, `bk storage`,
   `bk workspace edit|delete|transfer`, `bk member leave`, `bk invite
   accept|decline`. Their queries are still app-local to `apps/issues`. Your app
   cannot serve them, and today that is correct rather than temporary; when one
   of them needs a second host, the factory is the work.
6. **A 409 has no branch in the CLI's `classify()`**, so `confirm_mismatch` exits
   1 from the server and 2 from the binary. One condition, two exit codes, and an
   agent cannot write one recovery.
7. **Email is app-local, and the first app that needs it twice will copy it.**
   `apps/issues/lib/email/` — a lazy Resend client, `fromAddress()`, and the
   templates — is the last significant piece of shared behaviour that never
   became a package, because `apps/issues` was the only sender and still is.
   **If your app needs to send email, promote it to `packages/platform-email`
   first; do not copy the directory.** Two copies means two `fromAddress()`
   functions and two sets of templates, and the second one goes stale silently —
   nothing renders both, so nothing compares them.

   The move is small and the shape is already decided: the **address** is
   platform-wide (`admin@blackcode.ch`, on the apex domain, because Resend's
   free plan verifies one domain per account), and the **app identity lives in
   the display name** — `Blackcode Issues <admin@blackcode.ch>`. So
   `fromAddress()` takes the app, exactly like every other value that had to
   stop assuming one deployment: `platform.uploads.app`, `labels.app`,
   `comments.parent_type`. Written down 2026-08-10, when the sending domain was
   made generic and the module was the one thing left that was not.

## The record: what walking this document found

Kept because each entry is a mechanism, not an anecdote, and the mechanisms
recur. The first three are from the 2026-08-05 scaffold walk; the fourth
onwards are from building `apps/sales`.

### From the 2026-08-05 walk

**1. `bk __routes` deduped two apps' routes into one.** The worst of the four,
and only a walk could have found it. `CollectRoutes` keyed its map on
`method + path`, so when `sales` copied the scaffold's
`GET /api/workspaces/{ws}/notes`, the two collapsed and **`sales` appeared to
have no commands at all**. Its parity test then failed on the
"discovers both sides" assertion — which is the only reason this was visible
rather than a vacuous green. Two apps are two deployments; the same path is not
the same route. Fixed: the key now includes the app.

Fixing it also revealed that `GET /api/users` had been claimed by both
`bk issues issue list` and `bk user view`, and one of the two had been silently
dropped from the artifact all along.

**2. The boundary probe's most important check was commented out.** Check (2) —
"this app cannot read another app's schema" — had no second schema to point at
when it was written, so it shipped as a comment. A commented-out probe reports
success. It is now a `DO` block that finds another app's table via
`platform.apps` and **skips loudly** when there is none. Its first live run
picked `neon_auth.invitation` (a correct refusal of the wrong thing, which would
have read as a pass), which is why the candidate now comes from the app registry
rather than from a list of schemas to exclude.

**3. The `npm install` trap I expected did not happen.** A new app that only uses
existing packages resolves fine from the hoisted root `node_modules`. The install
is only needed when a NEW package appears. The instruction stays, the scare story
was wrong.

**4. `transpilePackages` and the lazy `createDb()`** — both real, both already
handled by the scaffold, neither cost anything on the walk because the scaffold
carries them. That is the scaffold doing its job.


### From building `apps/sales`, 2026-08-06/07

**4. The provisioning script had never created a schema.** `docs/sql/app-role.sql`
grants against a schema it assumed existed — true for `apps/issues`, whose schema
predates the script by years. Run in the documented order for a NEW app, five of
its ten statements fail and `psql` exits 0, leaving a login role with no grants
and a provisioning step that reported success.

**5. The boundary probe cannot tell a boundary from an unprovisioned role.** Its
denials are all `42501` either way, so a role granted nothing passes six of its
eight denial checks — including the one CLAUDE.md finding #2 exists for. Only its
POSITIVE checks discriminate.

**6. The scaffold had no middleware, so the second app's was written from
scratch** — modelled on the app that had it wrong. The result was a permanent
login bounce with a 200 on every request and nothing in the logs, caught by hand
one commit before a production deploy.

**7. Drizzle's default migration ledger is one high-water mark for the whole
database.** The second app's migrations are silently skipped. No error, no row,
and the same comparison skips them again on every later run.

**8. Four comments cited test files that did not exist**, three of them naming
one file that had never been written, in headers describing invariants on the
blob-deletion path. A citation is a claim about what the repo protects, and a
reader deciding whether a change is safe will take it as one.

**9. A correct change silently retargeted a routing assertion.** Renaming the
scaffold's slug left a test asserting on the word `template`, which cobra's
`unknown command "template"` also contains. It passed while checking nothing. The
diff that breaks a guard rarely touches the guard — **when you rename or widen a
value, grep for what asserts on it.**

### The registry rehearsal, done for real

Steps 3 and 4 were exercised end to end against the blob-delete gate, with a
second row in `platform.apps` on a rehearsal branch:

| State | Gate's answer |
|---|---|
| `sales` enabled, `maintains_blob_index = false` | **REFUSED** — `ReferenceCoverageError`, for every URL |
| triggers installed, flag set, index empty | answers again: file still referenced by issues → `true`; genuine orphan → `false` |
| `sales` content embeds the orphan | orphan → `true`, i.e. **deletion refused** |

The first row is the Phase 7 prediction reproduced deliberately: registering an
app before it can answer stops blob deletion platform-wide. That is the gate
working, and it is why step 3 says to insert with `enabled = false` if you are
not doing step 4 immediately.
