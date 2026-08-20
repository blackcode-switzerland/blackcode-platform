# Blackcode Platform — CLAUDE.md

## Project overview

A **monorepo** (npm workspaces + Turborepo) holding Blackcode's internal apps.

**Three apps are in production**, on one database and one login:
`issues.blackcode.ch` and `sales.blackcode.ch` (live since 2026-08-10), and
`books.blackcode.ch` (live 2026-08-20).

- **`apps/issues`** — an AI-native issue tracker (Linear-style). Next.js 16 App
  Router, TypeScript, Tailwind v4, Drizzle ORM + PostgreSQL, next-auth, TanStack
  Query, Framer Motion. The first app, and where most shared patterns were born.
- **`apps/sales`** — prospects, meetings, communications. The **second** app, and
  the reason most of the platform exists in its current shape: it was the second
  question every shared thing had ever been asked. Same stack; its own schema,
  migrations, CLI group and docs.
- **`apps/books`** — **b/books**, Swiss statutory bookkeeping: any number of
  books per workspace, double-entry or recettes-dépenses, bilan and compte de
  résultat derived rather than stored, and every transaction *explained*. The
  **third** app, and the first whose **web surface is read-only** — every write
  is a `bk books` command, so the CLI is not a convenience layer here, it is the
  product. Same stack plus `platform-i18n` (EN/FR); its own `books.*` schema,
  nineteen migrations, CLI group, eight guide topics and docs.
- **`apps/_scaffold`** — the scaffold. A real, minimal app: one entity, one
  route, its own migrations and ledger, nine platform route factories, an entity
  projection and its reconciler, a CLI command group, a guide topic, a page.
  It builds, lints and passes every guardrail. **Copy it to add an app; do not
  edit it in place.** (Renamed from `apps/_template` on 2026-08-07 — D-38: the
  word `template` is also a sales entity, a Go local and a directory, and four
  guards mis-fired on the collision.)

**The platform migration is finished — all nine phases (0–8) landed 2026-08-05.**

| Need | Read |
|---|---|
| **Never seen this repo** | **`docs/working-in-this-repo.md`** — the orientation. The traps that have actually bitten (with their reasons), the shapes the checks here have been wrong in, and how to work here. Written 2026-08-11 |
| **Add an app** | **`docs/adding-an-app.md`** — the authoritative, self-contained checklist. Copy `apps/_scaffold`, follow it top to bottom. Rewritten 2026-08-07 from what building the second app actually found |
| Current design rules | `docs/platform-architecture.md` |
| Why the repo looks like this | `docs/2026-08-platform-migration.md` — and what is **still owed** |
| Remove an app | `docs/extracting-an-app.md` |
| The database boundary | `docs/platform-db.md` |

What the migration bought:

- `packages/platform-{db,api,ui,auth,agent,storage,testing,email,i18n}` — nine
  shared libraries. **`platform-email` landed 2026-08-11** (multiAppFinalRefactor
  Phase 10): an app supplies a four-field identity and its own db handle, and
  `apps/sales` stopped sending people to `apps/issues` to change a password both
  apps share. **`platform-i18n` landed 2026-08-20** for b/books' EN/FR switch: it
  holds the locale vocabulary, the one resolution order
  (`user record → cookie → Accept-Language → default`) and the typed dictionary
  lookup — and **no product copy**, ever. Each app supplies its own dictionary;
  a `Dictionary<K>` is `Record<Locale, Record<K, string>>`, so a key present in
  English and missing in French is a `tsc` error rather than a blank on screen.
  The preference is `platform.users.locale`, **nullable — null means "never
  chosen", not "chose English"**, which is what keeps `Accept-Language`
  reachable. Apps import these; apps never import each other.
  **`apps/issues/lib/auth.ts` (next-auth `authOptions`) deliberately did NOT
  move** — the reason is in `packages/platform-auth/src/index.ts`.
- The database is **`platform.*` + `issues.*` + `sales.*` + `books.*`** (and
  `scaffold.*`, never deployed) — never `public`. Each app runs as its own
  bounded role (`issues_app`, `sales_app`, `books_app`), with no grant on any
  other app's schema;
  migrations run as `MIGRATE_DATABASE_URL`. See **`docs/platform-db.md`** — the
  boundary, the two credentials, the grants.
  > **`platform.*` is NOT a synonym for "shared".** Only `users`, `apps`,
  > `api_tokens`, `password_reset_otps`, `email_whitelist` and `blob_references`
  > are read by every app. `workspaces`, `workspace_members`,
  > `workspace_invitations`, `comments`, `labels`, `uploads`, `events`,
  > `inbox_messages`, `deletion_batches`, `entities` and `links` are
  > **`apps/issues`' own**, left in that schema because moving a live app's
  > tenancy costs a migration and buys nothing. `apps/sales` has its own in
  > `sales.*` and `apps/books` its own in `books.*`; neither reads any of them.
  > The full split:
  > `docs/platform-architecture.md` §2.
- Apps are real data: **`platform.apps` is the ADDRESS BOOK** — which apps exist
  and where they are deployed. `workspace_apps` and `app_access` were **dropped
  2026-08-10** (multiAppFinalRefactor Phase 5) with `requireAppAccess` and
  `PLATFORM_ENFORCE_APP_ACCESS`: each app owns its workspaces, so a workspace
  belongs to exactly one app and **membership is the whole gate**.
  `/api/meta`'s `apps` block is the address book, not a grant list —
  `workspaces` is populated only for the app answering the request, and `[]` for
  another app means "not known here", never "you have none there". No deployment
  can answer for another; each app's membership lives in its own schema.
  docs/platform-architecture.md §4.5's "an agent must not discover an app its
  user cannot reach" is **retired** there, with the measurements.
- **The CLI has TWO verb tiers since 2026-08-10, and the tier is visible in the
  spelling** (`bk guide platform/apps`). **Bare** is your ACCOUNT and this
  BINARY — `login`, `logout`, `whoami`, `token`, `profile`, `meta`, `app`,
  `guide`, `skill`, `changelog`, `version`, `super-admin`. **App-owned** is
  everything that touches an app's data, spelled `bk <app> <verb>`: every app
  noun *plus* `workspace`, `member`, `invite`, `user`, `upload`, `trash`,
  `label`, `search`, `activity`, `inbox`, `storage`. `bk link` was **removed**.
  The test is unchanged from D-11 — *"would two deployments answer
  differently?"*, never *"is it shared code?"* — and what changed is the facts:
  D-11's NEUTRAL tier assumed one `platform.workspaces`, and its CROSS-APP tier
  assumed one entity index and one upload ledger. multiAppFinalRefactor Phases 2
  and 3 ended all three, so a bare data verb had no answer, only a default taken
  from the home app. **D-28's pairing ("you upload INTO one app and list ACROSS
  all of them") no longer describes anything**: the ledger is per app now, so
  `storage` moved with `upload`.
  The shared implementation is `cli/internal/appverbs`, and **`appverbs.Config`
  declares what each app SERVES, verb by verb** — a permanent subset is
  legitimate (D-36) and an app gets only what its `app/api/**` tree has. The
  active workspace is **per app** in `~/.config/bk/config.json`: two apps'
  workspace tables have overlapping ids, so one shared field meant
  `bk sales workspace use x` silently retargeted `bk issues …`.
- **Everything is addressable by URN:**
  `bc:<app>:<workspace-slug>/<entity-type>/<number>`, using the #number — built
  from an app's OWN workspace slug and #number, so every app can print one.
  Every issue/task/project is projected into `platform.entities` **in the same
  transaction as its source write**. Read `apps/issues/lib/db/queries/entities.ts`'s
  header before touching a write path; `bk super-admin entity-drift` is the
  reconciler. **Since 2026-08-10 `apps/issues` is the only writer of that index**
  (multiAppFinalRefactor Phase 3): `apps/sales` stopped projecting. **`bk link`
  is GONE** (Phase 4) and its route is unmounted everywhere; the URN goes in the
  record's own text instead. `search` is app-owned (`bk <app> search`) and Phase
  6 may bring a cross-app one back as a CLI fan-out over each app's server —
  never as a shared table. **A URN itself is unaffected**: it is built from an
  app's own slug and #number, so every app can still print and resolve one.
- **Storage: the STORE is shared, the LEDGER is not.** `platform.uploads.app`
  records who uploaded each file; new uploads land under `<app>/<workspace>/<file>`;
  **existing blobs were not moved** — `pathname` is where a file is, `app` is who
  owns it. Import storage from `@/lib/storage`, never from the package directly.
  **The LEDGER is per app since 2026-08-10** (`AppContext.uploads`;
  `apps/sales` writes `sales.uploads`) — the store, the quota and
  `platform.blob_references` are not.
- **Blob deletion works across deployments** via `platform.blob_references`, an
  index each app maintains **from Postgres triggers on its own content tables**.
  Read `packages/platform-db/src/schema.ts` at `blobReferences` before touching
  anything near it, and `packages/platform-storage/src/references.ts` before
  touching anything that can reach `del()`. Those two files are what stand
  between a code change and unrecoverable data loss.

Adding an app is a checklist, not a project: **`docs/adding-an-app.md`**, walked
end to end. Extracting one is **`docs/extracting-an-app.md`**, rehearsed.

## Repo layout

```
apps/issues/          the issue tracker — app/ components/ lib/ types/ docs/ public/
apps/sales/           the sales app — prospects, meetings, communications
apps/books/           b/books — Swiss statutory bookkeeping; the web reads, bk writes
apps/_scaffold/       the scaffold. Copy it; don't edit it
cli/                  the `bk` Go binary (repo root — shared by every app)
  internal/commands/platform/   bare verbs: workspace, label, upload, trash, …
  internal/commands/issues/     that app's nouns, behind `bk issues …`
  internal/commands/books/      that app's nouns, behind `bk books …`
  internal/commands/scaffold/    the scaffold's, behind `bk scaffold …`
  internal/cmdutil/             what both need; app packages never import each other
  internal/guide/topics/{platform,issues,sales,books,scaffold}/
packages/             shared libraries — apps import these, never each other
docs/                 PLATFORM docs only (see the Docs sync rule)
docs/changelog/       one file per app + platform.md — merged by `bk changelog`
docs/sql/             role creation, boundary probe, rollback scripts
devops/               release scripts
turbo.json            task pipeline
tsconfig.base.json    shared TS settings; apps extend it
```

## Dev commands

**Run these from the repo root.** They delegate through Turborepo.

```bash
npm run dev        # start dev server (port 3000) — turbo run dev --filter=issues
npm run build      # production build (every app)
npm run typecheck  # type check only  ← NOT `npx tsc --noEmit`
npm test           # vitest, incl. the per-app parity + isolation guards
npm run lint       # eslint, all apps and packages
```

> **`npx tsc --noEmit` does not work from the repo root** — there is no root
> `tsconfig.json`, by design: a root config that compiled nothing would report a
> vacuous green. Use `npm run typecheck`, or `cd apps/issues && npx tsc --noEmit`.

> **`npm run build` does not touch a database.** The `postbuild` hook only
> migrates when `RUN_MIGRATIONS` is set, which is true in Vercel Production only.

## Key architecture

- **`apps/issues/app/`** — Next.js App Router pages + API routes
- **`apps/issues/components/`** — shared UI; `components/ui/` = primitives
- **`apps/issues/lib/db/`** — Drizzle schema, migrations, query helpers
- **`apps/issues/lib/`** — auth, utils, work-item constants

## THE STANDING RULE: prove it fires

> **A check you have not watched fail is not a check.** Before claiming any
> guardrail, test, assertion or probe works, break the thing it guards and watch
> it go red. Then restore.

This is not a style preference. **Twenty-three guardrails in this repo have been
found green-but-inert** — eight during the migration, and the count is still growing.
Every one looked like working protection:

| # | The check | How it was inert |
|---|---|---|
| 1 | ESLint on `platform-storage`, `-auth`, `-agent` | No config file at all. `eslint src` exited non-zero, `npm run lint` had been failing unnoticed, and three packages — including the one that can reach `del()` — had **no boundary rule enforced** |
| 2 | `platform.blob_refs_purge`'s authorisation guard | Compared `current_user`, which **inside a `SECURITY DEFINER` function is the function's owner, not the caller**. True for everybody |
| 3 | `docs/sql/blob-drift-check.sql`'s orphan detection | Structurally impossible: an orphan is byte-identical before and after a re-fire, so a diff can never surface one |
| 4 | The `apps/<a>` → `apps/<b>` ESLint rule | Three glob patterns, matching **none** of the imports that actually escape an app (`../../issues/lib/app` — the climb has no fixed depth and `apps` never appears in the specifier). **Survived its own diagnosis**: still green on the real escape shape four days later, sitting beside its working replacement. Deleted 2026-08-06 — `lib/app-isolation.test.ts` is the boundary; do not re-add a lint rule |
| 5 | `bk __routes` | Deduped on `method+path`, so two apps sharing a path collapsed into one and the second appeared to have **no commands**. Also silently dropped one claim on `GET /api/users` for months |
| 6 | `docs/sql/app-boundary-probe.sql` check (2) | **Commented out** — there was no second schema to point at when it was written. *A commented-out probe reports success.* Its first live version then picked `neon_auth.invitation`, a correct refusal of the wrong thing, which reads identically to a pass |
| 7 | `pg_dump --schema=issues` as an extraction | Emits the triggers and FKs, all of which fail at restore; `psql` prints 27 errors and **exits 0**. The database boots, serves, and has silently lost referential integrity and all blob-index maintenance |
| 8 | `TestRemovedSpellingsStillCarryAHint` | Asserted a **hand-written** cobra error string. The real one contains the whole remaining argv, so the three most-used spellings fell through to the generic hint. **Written by the same session that wrote this rule, an hour after writing it** |
| 9 | `guide_test.go`'s dynamic-value guard | A substring match over six hand-written strings. A topic containing the **entire** issue status vocabulary, the **entire** priority vocabulary and a **stale** `50 MB` limit passed every section. It banned `100MB` — the *correct* spelling — so the one case it could not catch was a topic that had gone out of date. Widened 2026-08-06 to match sizes by shape |
| 10 | `cli-parity.test.ts`'s vacuous-pass assertion | Asserted on `ownClaims` — a UNION of the app's own claims and every *platform* route it mounts. Deleting `cli/internal/guide/topics/sales/` drops `bk __routes`' sales attribution from 68 routes to **0**, and the suite stayed 5/5 green, because the seven platform routes sales mounts kept the union non-empty. Widened by the same commit that retired `hostsPlatformRoutes` (D-36); the assertion was phrased for the old, narrower set and left reading the new one. **Found by the plan telling agent8 to "confirm it still fires" — it did not.** Fixed 2026-08-07 (`appOwnClaims`) |
| 11 | `lib/dashboard-paths.test.ts`'s `?focus=` check | Two inert versions in one sitting. First scanned whole component *files*, so `ProductsPage` vouched for a `DocumentsPage` that ignored `?focus=` entirely — three listings share one file. Rewritten to scan the component *body*, it then matched the **word** `focus` and passed against `const focus = null`. It now matches the call. **The granularity of a text scan is part of what it checks** |
| 12 | `integrationDescribe`'s "loud" skip | Written to replace `describe.skip` because a silent skip reports success — and used `console.warn`, which vitest intercepts and **drops** for a skipped suite. Output was byte-identical to the thing it replaced. The notice nobody sees, reintroduced inside its own replacement. Raw `process.stderr.write` now |
| 13 | `platform-testing`'s cross-app import scanner | `IMPORT_RE` matched `from` and `import` only, so `require('../../issues/lib/work-items')` — the one spelling of "reach into another app" that does not say *import* — passed 5/5. This file **is** the boundary between apps; the ESLint rule it replaced is #4 above. The `.js`-extension half of the same report was already caught |
| 14 | `bk super-admin entity-drift` | Not a test — a *reconciler*, which is worse. Its help said it checked "the cross-app entity index against **each app's** source tables". It is bound to one deployment's app and cannot be otherwise (an app's Postgres role has no grant on another app's schema). Run against a database with **51 unprojected sales rows**, it reported no drift and exited 0 |

| 15 | `docs/sql/app-role.sql` (and its sales copy) | Every grant names a schema the file never creates. Run in the documented order for a NEW app — before the migration that creates it — **five of its ten statements fail and `psql` exits 0**, leaving a LOGIN role with no grants at all and a provisioning step that reported success. It had never bitten `apps/issues`, whose schema predates the script by years. Finding #7's mechanism, in a provisioning script, in a directory where two neighbouring files already warn about it |
| 16 | `docs/sql/app-boundary-probe.sql` | It **cannot tell a boundary from an unprovisioned role**. A role granted nothing denies everything with 42501 and passes SIX of its eight denial checks — and check (4d) prints a schema denial instead of `blob_refs_purge`'s own refusal, which is the check finding #2 exists for. Its closing line, "every deny above must be 42501", is satisfied by a role that can do literally nothing. Only its POSITIVE checks — (1), (4a), (4e) — discriminate |
| 17 | `TestUnknownAppFailsInsteadOfFallingBack` | Ran `bk template note list` and asserted the error was non-nil and contained `"template"`. Renaming the scaffold's slug left it **green while checking nothing**: a binary with no `template` group answers `unknown command "template"`, which is non-nil and contains the word. Cobra's arg parser stood in for the routing failure the test exists to observe. Found by grepping for the renamed string — the suite was green |
| 18 | Four comments citing `*.test.ts` files that do not exist | Three named one file that has never been written, in headers describing invariants on the blob-deletion path; the fourth claimed a test asserted that `SURFACES` matches migration 0002's triggers, and none did. **A citation is a claim about what this repo protects,** and a reader deciding whether a change is safe takes it as one. Now guarded by `platform-testing/test/cited-tests-exist.test.ts`; the scanner⇄migration test is written |
| 19 | The `packages/*` ESLint config | Banned app imports and **nothing else** — `const x: any = 1` in `platform-api` passed clean. Finding #1's neighbourhood: that was three packages with no config at all, and a config that exists and checks almost nothing reads as the same protection while giving less. Widened 2026-08-07 with six rules, each watched fail individually; adoption immediately surfaced a dead import in `platform-storage/src/references.ts` |

| 20 | Migration `0003_scaffold_owns_its_tenancy.sql`'s foreign-key swap | The DROP was guarded on a constraint NAME — `notes_workspace_id_workspaces_id_fk`, Drizzle's spelling. Postgres had called it `notes_workspace_id_fkey`, because `0001` is hand-written SQL with an inline `REFERENCES` clause and the server names those itself. So the DROP matched nothing, the ADD succeeded, and the table ended up carrying **both** foreign keys: a row then had to satisfy `platform.workspaces` AND `scaffold.workspaces` at once — strictly worse than the coupling the migration existed to remove. **Every statement succeeded and psql exited 0.** Found by reading `pg_constraint` after running it, not by review. It matches on `confrelid` now, which is also what makes it correct for a copy whose `0001` was drizzle-generated. Fourth time on this project that the catalog contradicted the code (agent 1's trigger, agent 3's twelve FKs, agent 4's cascade ordering) |

| 21 | `password-degradation.test.ts`'s POSITIVE case | Written 2026-08-11 **to satisfy finding #16** — the rule that a guard built only on "was this denied?" cannot tell a working check from a subject that refuses everything. So it asserted the route "got past the 503" by watching a flag set on any access to a `db` proxy. It passed against `if (true \|\| !contribution.canDeliverEmail())` — an unconditional refusal — because **`apiHandler` writes an `error_events` row when it catches the ApiError, and that touched the db and set the flag**. The guard was satisfied by the error path of the exact bug it existed to catch. Found by mutating the route and watching the test stay green; it asserts the RESPONSE now (`status !== 503`). **The positive case written to cure #16 had #16's own disease** |
| 22 | `guide_test.go`'s `vocabularySources` map | Had a line for `issues` and one for `sales` and **none for `books`**. The map is what stops a guide topic hardcoding a status, a vocabulary or a limit, and its own comment says *"Adding an app means adding a line. An app that is missing simply is not checked"* — so b/books' eight topics had a free pass from the day the first was written until 2026-08-20, through the app going to production. The suite was green the whole time and the section header read `--- PASS: .../books` only because there was no books section at all. **The failure was predicted, in a comment, in the file it happened in.** Adding one line found a real restatement immediately. The lesson is narrower than "add the line": a per-app registry that a new app must OPT INTO is a guard whose coverage silently shrinks every time the platform grows, and it cannot report the app it never heard of |
| 23 | `bk books --help`'s hand-written command tour | Named `entry list, show` while `declare` and `post` — the two WRITES — existed and went unnamed, missed `rule deactivate`, `category retire` and five of `source`'s eight verbs, and advertised **`bk books member remove`, which that app does not carry**. It had been corrected once before by hand, and the paragraph under it apologises for the previous drift and says "where it and this prose disagree, the table is right" — an honest disclaimer and no protection at all, because the reader has already read the wrong line. **A prose copy of a fact that lives in the code is a guard's job, not a comment's**; `help_prose_table_test.go` now checks the tour against the tree and found all five |

**#22 and #23 landed 2026-08-20**, the day b/books went to production, in a phase
whose job was to make one app's CLI answer for itself. Both are the same shape as
#5 and #17 — a check that could not see its subject, and a hand-written copy of a
fact the code already owns — and #22 is the sharper one, because the file
predicted its own failure in a comment and nobody was reading that comment when
the third app was added. **When you add an app, grep the test suites for the
other apps' slugs**: every list that names them by hand is a place your app is
invisible.

**Findings 10–14 all landed on 2026-08-07, in the phase whose entire job was to
disbelieve the previous seven agents — and 11 and 12 are that phase's own new
guards, found inert within minutes of being written.** The rate does not fall as
the rule gets better known.

**#21 is the sharpest lesson in the table about writing guards.** It was
written deliberately to implement finding #16's corollary — assert the thing
that must SUCCEED — and the success assertion it chose was satisfied by the
failure path. **A positive case has to assert the OUTCOME, not a side effect on
the way to it**: a flag, a counter or a spy that the error handler also trips is
not evidence the happy path ran. It was found by mutation, not by review, and
the mutation that caught it (refuse unconditionally) is one worth running
against any check whose job is to discriminate.

**#20 landed on 2026-08-11 and is the first one in this table that is not a
test.** It is a MIGRATION step: guarded, re-runnable, idempotent, and it did
nothing while reporting success. The mechanism is finding #7's and #15's — SQL
that exits 0 having skipped its own work — and the lesson is the one three
agents have now independently written down: **check the catalog, not the repo.**
A constraint name, a trigger, a cascade and a foreign key are all facts about the
database that no grep of `apps/` can see.

**15–19 landed later the same day, in the phase after that one**, whose job was
to make the next app cheap. #17 is the sharpest: it was created by a correct
rename in that very phase, and it was found by grepping for the renamed string
rather than by running the suite, **because the suite was green**.

#8 is the one to remember: **you cannot tell by looking, including at your own.**
#4 and #9 were found by the wrap-up verification *after* the migration closed —
assume the next one exists.

> ### AND THE SAME DEFECT HAPPENS TO PEOPLE, NOT ONLY TO GUARDS
>
> The master of the 2026-08 multi-app refactor made this mistake **four times in
> four days**, each time in the same shape:
>
> | Claimed | What the command actually asked |
> |---|---|
> | "neither app has a signup screen" | *is there a PAGE whose path contains "signup"* — it was a tab on `/login` |
> | "`ensureWorkspaceForUser` has one call site" | one file, after the wide grep timed out |
> | "`verify.sh` is clean" | three schemas, while a fourth app existed |
> | "this edit landed" (×3) | the commit succeeded; the `assert` before it had failed and written nothing |
>
> **Every one: the check was correct, and the claim made from it was larger than
> the check.** That is a green-but-inert guard on the human side of the keyboard,
> and writing this table does not exempt you — #21 below was written *to satisfy*
> #16 and carried #16's own disease.
>
> Before reporting a negative — "there is no X", "nothing reads Y", "that is
> done" — say what question your command actually asked, and check that it is the
> question you are answering.

Six corollaries worth stating separately, because they are different
mechanisms:

- **An absence is only evidence if you know your instrument could have seen the
  presence.** This is the standing rule pointed at OBSERVATION rather than at
  tests, and it is on record because of a near-miss rather than a bug. On
  2026-08-11 an agent recorded, four times, that clicking a button produced a
  *silent* no-op — no toast, no request, no change — from two full-page
  screenshots and a five-second wait. It was not silent: the click raised a
  four-second `sonner` toast naming both recoveries, and every sample landed
  after it had gone. A browser driver whose round-trip is measured in seconds
  cannot see it. The false finding was caught by instrumenting the page (click
  and poll the toaster inside ONE `evaluate`) instead of sampling it between
  calls.

  It generalises past browsers: a log you tailed too late, a row you counted
  before the transaction committed, a `grep` over a file the build had not
  written yet. **Before reporting "it did not happen", establish that your
  instrument could have caught it happening** — the same way you would break a
  check to confirm it can go red.

- **A route is not a page.** Every check in this repo that verifies behaviour —
  `cli-parity`, `bk`, `curl`, the integration suites — sees `app/api/**` and
  nothing else. A Next.js server component reads the database directly, and a
  React query's belief about a wire format is a third thing again. Two bugs
  shipped to production in two days in 2026-08 and **both lived where every route
  was correct**: `apps/sales`' dashboard 404'd for every sales-only account for
  four phases while every API route returned 200, and its members page went blank
  because a cast renamed the `{ data, next_cursor }` envelope instead of opening
  it. **When a change moves where data lives, open the pages that read it
  directly, in a browser, and report what you saw PER PAGE.** Three agents wrote
  "the pages are still owed a look in a browser" and nobody closed it.

- **A commented-out or skipped check reports success.** If a check cannot run
  yet, make it **skip loudly** (`RAISE NOTICE`, `t.Logf`, a non-empty assertion),
  never silently. #12 is what "loudly" costs when you get it wrong: the notice
  was `console.warn`, which the test runner drops.
- **Assert your inputs.** Every "did we find anything to check?" assertion in
  this repo exists because a guard that found nothing would otherwise pass. #5
  was caught by exactly such an assertion.
- **A correct change can silently retarget an existing assertion**, and this is
  the most insidious shape found so far, because nothing is written wrong.
  Finding #10: widening `ownClaims` into a union was the right fix for D-36, and
  it left an assertion phrased for the old, narrower set pointing at the new,
  wider one — which could no longer be empty. The guard kept passing and stopped
  guarding. **When you widen or rename a value, grep for what asserts on it**;
  the diff that breaks a guard rarely touches the guard. Finding #17 is the same
  mechanism through a RENAME rather than a widening, and it was created and found
  inside one phase.
- **A guard's denials can be satisfied by nothing at all.** Findings #15 and #16
  are one story: a provisioning script that failed every grant and exited 0, and
  the probe written to catch exactly that, which passed it. Every refusal the
  probe saw was a real `42501` — from a role that had been granted nothing, so
  there was nothing to refuse it. **A check built on "was this denied?" cannot
  distinguish a working boundary from an absent subject.** Give it a positive
  case: assert the thing that must SUCCEED, first, and treat the denials as the
  weaker half.

## Design system

Full detail in `docs/frontend.md` (platform-wide) and
`apps/issues/docs/frontend.md` (this app). Short version:

- **Theme**: monochrome Linear-style. `--primary: #007bd3`. Tokens in `apps/issues/app/globals.css`.
- **Dark/light**: `next-themes`, class strategy, `defaultTheme="dark"`.
- **Status/priority colors**: canonical in `apps/issues/lib/work-items.ts` — never hardcode elsewhere.
- **Dialogs**: `useConfirm()` from `components/ui/confirm-dialog.tsx` — never `window.confirm/prompt`.
- **Toasts**: `sonner` — `toast.success` / `toast.error` on all mutations.
- **Page layout**: slim sticky header (`h-11 border-b`), borderless edge-to-edge rows, no card wrappers in listings.

## Rich text editor

`packages/platform-ui/src/rich-text-editor.tsx`, imported as
`@blackcode/platform-ui/rich-text-editor` — TipTap-based, used for all
descriptions and comments, by **both** apps. (It was
`apps/issues/components/rich-text-editor.tsx` until the migration moved it into
the shared package; nothing of that path is left.)

- **Slash command** (`/`): H1–H4, Bold, Italic, Strike, Underline, Link, Quote, Code block, Bullet list, Numbered list, Checklist, Table, Attach file.
- **BubbleMenu** (on selection): full formatting bar.
- **Table menu**: add/delete row & column, toggle header row, delete table. Tables round-trip everywhere via `@tiptap/extension-table*`; both the server (`lib/rich-text.ts`) and render-layer (DOMPurify) sanitizers whitelist the markup.
- `variant="bordered"` for modals/forms; `variant="seamless"` for detail-page descriptions.
- `hideToolbar` — create-issue-modal sets this.
- `onFileUpload?: (file: File) => Promise<string>` — pass the `/api/upload` handler to enable paste/drag-drop/slash-attach for **any file type**.
- `mentionItems` — pass `members.map(m => ({id, label, avatarUrl}))` for `@mention`.

> **Any new content column that can hold a file URL needs a
> `platform.blob_references` trigger, in the same migration.** The index is
> trigger-maintained so no *write path* can forget it, which concentrates the
> entire remaining risk here. See `docs/adding-an-app.md` step 4.

## Create-item UX pattern

"New issue / task / project" buttons **do not open a modal**. They POST a minimal
record immediately, then `router.push` to the detail page with `?new=1`, where
`useSearchParams()` auto-focuses the title field.

- Issue listing → `POST /api/workspaces/:slug/issues { title: 'New Issue' }` → `/dashboard/issues/:id?new=1`
- Task listing → `POST …/tasks { name: 'New Task' }` → `/dashboard/tasks/:id?new=1`
- Project listing → `POST …/projects { name: 'New Project' }` → `/dashboard/:id?new=1`
- Inside project detail: "New issue"/"New task" pre-set `project_id`; per-task "+" also pre-sets `task_id`.
- Inside task detail: "New issue" pre-sets `task_id` (and `project_id` if the task has one).

`create-issue-modal.tsx` still exists for the kanban "create issue" flow.

## Data fetching

TanStack Query throughout. See `docs/frontend.md` → data fetching.

## Super admin

`SUPER_ADMINS` env var (comma-separated emails) + `email_whitelist` table. Pages
at `/dashboard/super-admin`. Two reconcilers live here and both matter:

- **`bk super-admin entity-drift`** — `platform.entities` vs the source tables.
- **`bk super-admin blob-drift`** — `platform.blob_references` vs a live scan.
  Read `missing_count` first: a `missing` row is a file another deployment could
  delete while it is still in use. `unreconciled_count` is **not** drift — it is
  rows nobody looked at, and it exists because a clean report over a partial
  index is the most reassuring wrong answer this route can give.

## Agent surface contract (MANDATORY)

Agents operate this product through **one** interface: the `bk` CLI. The HTTP
API is **private plumbing with no public contract** — do not document it for
external consumers, and **never reintroduce an OpenAPI spec or a fat page
manifest.** Both were deleted on 2026-08-03: they were hand-maintained copies of
facts that lived elsewhere and had already drifted.

**The `/api/openapi.json` and `/api/docs` ROUTES still exist, and are meant to.**
The documents are gone; what remains is a 410 Gone carrying a `suggestion`
(`app/api/openapi.json/route.ts`, `lib/api/retired.ts`). A 410 with a suggestion
is something an agent on stale context can act on inside the same run; a 404 just
looks like a bug. They are excluded from the parity test with that reason, have
no `bk` command by design, and have no expiry. Do not "clean them up".

### Where knowledge lives

| Kind | Home | Why |
|---|---|---|
| **Static** — how the tool behaves: flags, exit codes, workflows, failure modes | `cli/internal/guide/topics/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *this binary*. Fetching it from the server would describe a version the agent isn't running. |
| **Dynamic** — what the data is now: statuses, priorities, workspaces, size caps, blocked MIME types | the server, via `GET /api/meta` → `bk meta` (assembled in `apps/issues/lib/agent-meta.ts`) | Changes without a CLI release. |

**A guide topic must never restate a dynamic value.** Write *"run `bk meta` for
the current status values"*, not the values. `cli/internal/guide/guide_test.go`
fails the build if a topic hardcodes one.

Likewise, **a limit is declared once** in `apps/issues/lib/limits.ts` (or
`packages/platform-api/src/limits.ts` for shared ones), imported by the route
that enforces it, and served by `/api/meta`. Never re-type a number.

### THE RULE: every change lands in three places

> **Route → `bk` command → changelog entry.** Same commit, every time.
>
> | # | Edit | Where |
> |---|---|---|
> | **1** | The **route** | `apps/<app>/app/api/**` |
> | **2** | The **`bk` command** + its `routes` annotation | `cli/internal/commands/<app>/` or `platform/`, `cli/internal/client/` |
> | **3** | A dated **changelog** entry | `docs/changelog/<app>.md`, or `platform.md` |
>
> Plus **one conditional fourth**: if agent-visible *behaviour* changed (a flag, a
> workflow, a failure mode), update the relevant guide topic. If only a *value*
> changed, touch its source instead — `bk meta` carries it live.

#### START ANYWHERE — FINISH IN SYNC

> **Anything a human can do in the web UI, an agent MUST be able to do with
> `bk`, and vice versa.** The CLI is not a subset of the product; it is the whole
> product with a different front door. Ship a button, a field, a filter, a bulk
> action or a page without its `bk` spelling and the binary is *silently wrong* —
> it will keep answering questions about a product that has moved on.

**The entry point does not matter. The end state does.** A change may start at
the web UI, at the route, at the CLI, or in the schema — whichever you happen to
have open. Wherever it starts, it is not finished until every layer agrees:

**web UI ⇄ route ⇄ `bk` command ⇄ guide topic ⇄ changelog ⇄ docs.**

So the numbered list below is a *destination*, not a running order. Whatever you
touched first, walk the rest and ask each in turn:

| Ask | If yes |
|---|---|
| Can a human now do something new, or something differently? | It needs a `bk` spelling |
| Can an agent now do something new? | Ask whether a human should be able to too — a capability that only exists in the CLI is a decision, so make it one |
| Does it read or write through a route? | That route is step 1 below |
| Does it read the database **directly** in a server component? | **A route may not exist yet — write one.** `cli-parity` cannot see this case (the *"A route is not a page"* corollary above) and will stay green |
| Did a workflow, flag or failure mode change? | `cli/internal/guide/topics/**` |
| Did a vocabulary or limit change? | Its single source, served by `bk meta` |
| Would a maintainer's mental model be stale? | `docs/` — see the Docs sync rule |

**Everything ends in sync or the change is not finished.** A UI-only feature is
an unfinished feature. So is a CLI-only one, a route with no command, and a
command whose guide topic still describes last week's behaviour.

> **No guard enforces this one — you are the guard.** `cli-parity.test.ts`
> compares routes against `bk`, never *pages* against `bk`. A feature added to a
> server component, or one that reuses an existing route in a new way, ships a
> capability gap with **every suite green**. That is the exact shape of the
> twenty-one findings in the table above, so treat "the tests pass" as saying
> nothing at all here, and check both front doors by hand.

**The one legitimate exception is a deliberate capability decision, and it gets
written down** — the way `DELETE /api/me` and the board-ordering `reorder` routes
are, each in `EXCLUDED_PATHS` with its reason. Deliberate and recorded is fine.
Forgotten is the bug.

1. **Route** — workspace-scoped under `/api/workspaces/{ws}/…`; auth + errors via
   `apiHandler` + `Errors`; lists return `{ data, next_cursor }` via `jsonList()`;
   single resources return the bare entity; create → `201`, delete →
   `{ deleted: true }`. Never reintroduce implicit-active-workspace routes.
2. **CLI** — add the command + client method, **and its `routes` annotation**:

   ```go
   Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues"},
   ```

   Use the literal `"none"` when the command makes no HTTP call — required rather
   than allowed-to-be-empty so an oversight stays visible. Reuse `wsPath()` and
   unwrap the `{ data, next_cursor }` envelope.
3. **Changelog** — one dated entry at the top of the right file. A change
   touching shared platform data goes in `platform.md`, **not** in the app that
   prompted it.

**Conditional:**

- **Guide** — behaviour changed → `topics/platform/*.md` (true everywhere) or
  `topics/<app>/*.md` (one app). A topic under `topics/<app>/` may not describe
  another app; `guide_test.go` enforces it.
- **`bk meta`** — a vocabulary or limit changed → update its *source*.
- **Deprecations** — renamed or removed a flag/command → add a row to
  `cli/internal/commands/deprecations.go` **in the same commit**. Keep entries
  for two minor releases, then prune. This is what lets a failed run recover.
- **Server `suggestion`s** — any 400/404/409 an agent can realistically hit
  should carry one (`Errors.badRequest(code, msg, 'do X')`). The CLI prints it as
  a `hint:` line.
- **Internal docs** — see the Docs sync rule.

### The guardrails

Every app carries two test files, copied from the scaffold:

- **`lib/cli-parity.test.ts`** — every route reachable from `bk`, every claimed
  route real. **Per app**: `bk __routes` tags each route with its app, and each
  app is answerable for the platform routes it actually mounts, **derived from
  the filesystem** rather than declared. A second, repo-wide check
  (`platform-route-coverage.test.ts`) then asserts every platform command is
  mounted by *at least one* app — without it, "nobody serves this" and "another
  app serves this" are indistinguishable.
  > The `hostsPlatformRoutes` boolean each app used to set was **retired**
  > (D-36): a yes/no flag cannot express a subset, so mounting one shared route
  > forced an app to answer for all of them. A permanent subset is legitimate;
  > an *accidental* one is a bug, and the test is whether **every bare verb has
  > a host from this app's login**.
- **`lib/app-isolation.test.ts`** — no import resolving into another app, no
  query naming another app's schema. **Resolution-based, not glob-based** — see
  finding #4 above.

Genuine non-CLI routes live in `EXCLUDED_PATHS` / `EXCLUDED_OPERATIONS` — **each
entry must carry a reason.** Reach for an exclusion last; writing the annotations
is what surfaces the holes. Only two exclusions are real capability decisions,
both account/workspace destruction the product keeps human: `DELETE /api/me`
(settled — an agent must never delete its owner's account) and the two
board-ordering `PATCH …/reorder` routes.

The Go guardrails:

- `cli/internal/commands/routes_test.go` — every leaf command has a `routes` annotation.
- `cli/internal/guide/guide_test.go` — no hardcoded dynamic values; no cross-app references.
- `cli/internal/skill/skill_test.go` — the skill template stays under 40 lines and names no route, enum or auth header.
- `cli/internal/commands/groups_test.go` — a mistyped subcommand is an error, never a silent help-and-exit-0.
- `cli/internal/commands/boundaries_test.go` — command packages don't import each other.

### Writing commands agents can survive

- **`Confirm()` is not a guard for agents.** It auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY — exactly how agents run. For anything
  irreversible, require the caller to repeat the target back
  (`bk workspace delete <slug> --confirm <slug>`), even with `--yes`.
- **Irreversible commands report WHAT they did, not just how many.**
  `bk trash purge` echoes the type, #number and title of every item it destroyed,
  captured before the delete. A count alone is the difference between a wrong
  purge someone catches immediately and one nobody notices for a month.
- **Every failure is a non-zero exit with one line on stderr.** Exit codes are
  the contract (`cmd/bk/main.go` owns the table); stdout stays parseable.
- **A dead end must name its own exit.** `hintFor()` in `main.go` turns a failure
  into a recovery.

Before finishing any API/feature change, run **from the repo root**:

```bash
npm run typecheck              # NOT `npx tsc --noEmit`
npm test
npm run lint
npm run build
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes          # if any `routes` annotation changed
```

See `AGENTS.md` for the short version.

### Releasing

`./devops/release.sh cli minor` (GitHub + npm; needs `npm login` + an OTP) and
`./devops/release.sh web <app>` (Vercel production — **a web release targets
exactly one app**, so name it). Both interactive. `./devops/release.sh apps`
lists what is deployable; `app_registry()` in that script is the authority.

**The order is: deploy web, then npm, then deploy web AGAIN — and "web" means
EVERY app, both times.** The release script bumps `CLI_LATEST_VERSION` in a
commit it creates itself, so that commit lands *after* the first web deploy —
without the second deploy, production keeps advertising the old version and no
installed client is told an update exists. And every deployment answers the
"current version?" question from that one shared constant while `bk` asks
whichever app the user is *homed* on, so deploying only one leaves everyone
homed on the other uninformed. Both halves verified on 2026-08-10.

> **Vercel does not read `.gitignore`.** The repo-root **`.vercelignore`** is
> what keeps a deploy at ~66 MB instead of 8.5 GB (`.turbo` is 16 GB on disk).
> It is shared by every app — never add a per-app one. If an upload ever reports
> gigabytes, stop and find out why before letting it finish.

`CLI_MIN_VERSION` in `packages/platform-agent/src/cli-version.ts` hard-blocks
every older binary with exit 8. **Publish to npm before raising it** — raise it
first and every user is locked out with nothing to upgrade to. Both versions are
overridable by env (`BK_CLI_LATEST` / `BK_CLI_MIN`), so the floor moves and rolls
back without a redeploy. Answer `normal`, never `forced`, unless raising the
floor is the deliberate point of that release.

## Changelog rule (MANDATORY)

We publish a changelog so AI agents can keep their integrations up to date. It is
an **agent** surface — served two aligned ways from one source: **`bk changelog`**
and **`GET /api/changelog`** (JSON, or `?format=markdown`). Both read from
`packages/platform-agent/src/changelog.ts`, which merges one authored Markdown
file per section, newest first:

- **`docs/changelog/platform.md`** — identity, workspaces, membership, per-app
  access, labels, uploads, tokens, trash, and the `bk` CLI itself.
- **`docs/changelog/<app>.md`** — one per app.

Files are discovered by reading the directory, so adding an app is adding a file.

> **The rule:** any change to an API route or a user-facing feature MUST be
> reported in the right `docs/changelog/*.md` file in the **same** change, as a
> new `## YYYY-MM-DD — <clear title>` entry at the top. Say what changed, whether
> it's breaking, and how a client should adapt. Use a real, absolute date.

The `/changelog` web page was removed on 2026-08-03 — it had no human audience.
Do not reintroduce it. There is deliberately no pinned "platform reference": the
current surface is `bk guide`, which ships inside the binary.

## Docs sync rule

**After every code change, check whether any file in `docs/` is now outdated, and
update it before finishing.** Mandatory.

These are **maintainer** docs — not read by agents (agents read `bk guide`) — so
they may describe internals, but must never contradict the CLI-only contract.

**Docs live in two places, and the split is load-bearing** (§7.5): **root docs
never describe an app's internals, and an app's docs never describe another app.**

`/docs` — the platform and the monorepo:

- `working-in-this-repo.md` — **start here if you have never seen this repo.** The traps, the shapes the checks have been wrong in, how to work here
- `backend.md` — shared API conventions, auth, the `platform.*` schema (and which of its tables are actually shared), the event spine, the blob index
- `frontend.md` — theme + tokens, `components/ui/` primitives, app shell, data fetching
- `cli.md` — CLI internals, build, release, version policy
- `platform-db.md` — the database boundary, roles, grants, migrations
- `adding-an-app.md` — **the authoritative, self-contained checklist**
- `platform-architecture.md` — current design rules (was `PLATFORM-ARCHITECTURE.md`)
- `2026-08-platform-migration.md` — why the repo looks like this; what is still owed
- `2026-08-multi-app-refactor.md` — the ten phases that separated the apps. **§9 is the OPEN LEDGER** — what is still not closed, with items 1, 5, 6 and 7 outstanding. Item 6 needs a human with production access
- `extracting-an-app.md` — the rehearsed extraction
- `db-safety.md`, `devops.md`, `env.md`
- `changelog/` — the dated record
- `sql/` — role creation, the boundary probe, rollback scripts
- `architecture-rebuild.md`, `specs/`, `next-fixes.md`, `migration/`,
  `sales-app-plan.md`, `improvements.md`, `npm-package-rename.md` —
  **historical**. Never follow as instructions; they describe earlier eras of
  this repo (three verb tiers, `apps/_template`, `bk link`) that are gone

`/apps/issues/docs` — that app only: `backend.md`, `frontend.md`, `marketing.md`
(moved from root 2026-08-06 — it describes the app's landing page, which is an
app internal).

`/apps/books/docs` — that app only: `backend.md`, `frontend.md`. The statutory
model, the nineteen migrations, the derivations and the i18n column live here
and nowhere else — a root doc says *books exists, here is its schema and its
command group*, never how a compte de résultat is derived (§7.5).

`/apps/<app>/docs` — that app only.

Rules:

- Add/remove/rename a component, route, table, env var or command → update the doc.
- Change behaviour → update the doc.
- New functionality with no coverage → add a section.
- Do NOT document implementation details obvious from the code; document intent,
  contracts and non-obvious constraints.
- **Never present the HTTP API as a way to use the product.** Two ways in: the
  web UI for humans, `bk` for agents.
- **Ask which layer it belongs to:** *would a second app need this unchanged?*
  Yes → root. No → the app's own `docs/`.
- **Dated logs are history — don't rewrite them.** `docs/next-fixes.md` and
  `docs/changelog/*.md` record what was true on a date. If one has become
  misleading, add a dated note at the top pointing at current practice.
- **A doc that prescribes a rejected design is worse than no doc.** When a
  decision supersedes something written down, rewrite the original rather than
  appending — docs/platform-architecture.md §4.6 was rewritten this way, because
  leaving the losing option in place is how the next person re-litigates it.
