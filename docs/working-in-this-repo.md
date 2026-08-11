# Working in this repo

**Written 2026-08-11.** For somebody competent who has never seen this codebase.

Everything below is here because it cost somebody a day. Each rule carries its
reason, because a rule without one gets deleted by the next person who finds it
inconvenient — and several of these look, at first glance, like superstition.

This is not the architecture (`docs/platform-architecture.md`), not the API
conventions (`docs/backend.md`), and not the checklist for adding an app
(`docs/adding-an-app.md`, which is authoritative and self-contained). It is the
things none of those tell you and all of them assume.

**What is still unfinished is written down**, not smoothed over:
`docs/2026-08-multi-app-refactor.md` §9 is the open ledger. Item 6 needs a human
with production access, not the next agent.

---

## 1. The thirty-second orientation

A monorepo (npm workspaces + Turborepo). Two apps in production —
`issues.blackcode.ch` and `sales.blackcode.ch` — on **one database and one
login**, plus `apps/_scaffold`, which is a real minimal app you copy to make a
third. Eight `packages/platform-*` libraries. One Go CLI, `bk`, at `cli/`.

**What the two apps actually share is short:** one account, one password, one set
of API tokens, one sign-in, one app registry (so the CLI knows each app's
address), one Blob store. That is the list.

**Everything else, each app owns**: its workspaces, members, invitations,
comments, labels, uploads ledger, activity, trash, search. `apps/sales` reads
none of `apps/issues`' tables and never will — *"apps import packages, apps never
import each other"* is enforced by `apps/<app>/lib/app-isolation.test.ts`, and
the equivalent rule in the database is enforced by Postgres grants
(`docs/platform-db.md`).

> **The trap in that sentence.** A table living in the `platform.*` schema does
> **not** mean it is shared. `platform.workspaces`, `platform.labels`,
> `platform.uploads`, `platform.comments`, `platform.events` and
> `platform.entities` are `apps/issues`' own — they are in that schema because
> moving a live app's tenancy costs a migration and buys nothing.
> `docs/platform-architecture.md` §2 has the table that separates them.

**The CLI has two verb tiers, and the tier is visible in the spelling.** Bare
(`bk login`, `bk whoami`, `bk meta`, `bk app`, `bk guide`) is your ACCOUNT and
this BINARY. Everything that touches an app's data is `bk <app> <verb>` —
including `workspace`, `member`, `invite`, `label`, `search`, `activity`,
`trash`, `upload`, `storage`. If you read a document describing three tiers, or
`bk link`, it is dated: both ended on 2026-08-10.

---

## 2. Traps that have actually bitten

Ordered by how expensive they were, not by topic.

### Deployment and environment

**Vercel does not read `.gitignore`.** It reads **`.vercelignore`**, and there is
exactly one, at the repo root, shared by every app. Without it a deploy uploads
about **8.5 GB instead of 66 MB** (`.turbo` alone is 16 GB on disk). Never add a
per-app `.vercelignore`. If an upload ever reports gigabytes, stop it and find
out why before letting it finish.

**`vercel env pull` returns `[SENSITIVE]` for sensitive variables.** You cannot
copy a secret from one Vercel project to another with it, so any plan that
assumes "I'll just copy the env across" is already wrong. Check before planning
around it, and rotate the value into both projects instead.

**`NEXTAUTH_URL` must be the app's real public URL before `AUTH_COOKIE_DOMAIN` is
set anywhere.** `packages/platform-auth/src/session-cookie.ts` throws
`SessionCookieDomainError` when the cookie domain is not the host or a parent of
it, and it throws where the whole app depends on it. What makes this one
expensive is that it is **invisible while it is wrong**: NextAuth derives the
origin from the request, so a wrong `NEXTAUTH_URL` changes nothing observable
until the day somebody sets a cookie domain. It was wrong for months.
Unset `AUTH_COOKIE_DOMAIN` for localhost and preview deployments.

**A Vercel project's Preview environment needs the PREVIEW blob store.** The
connect dialog offers "Production, Preview" together, and taking the offer points
every preview deployment at real production files — where a preview can **delete**
them. See §3 on why deletion reaches across deployments.

### Database

**`pg_dump --schema=X` is not a backup of X.** It emits the schema's triggers and
every foreign key into `platform.*`, all of which fail at restore — and `psql`
prints the errors and **exits 0**. The result boots, serves traffic, and has
silently lost referential integrity and all blob-index maintenance. Always
`\set ON_ERROR_STOP on`, and match `pg_dump`'s major version to the server's. The
rehearsed procedure is `docs/extracting-an-app.md`.

**Local Postgres is port 5432 inside the container and 5434 on the host.** Both
numbers are correct and they are correct in different places.

**A workspace `#number` is not a global id.** Numbers restart per workspace, so
any predicate on `entity_id`, or on a URN's numeric suffix, **must carry the
workspace** or it matches another workspace's row. Every index on
`platform.events` leads with `workspace_id` for this reason.

**Every foreign key into `platform.workspaces` is `ON DELETE CASCADE`** — fifteen
of them as of 2026-08-11, across `issues.*` and `platform.*`, confirmed in
`pg_constraint` — and `deleteWorkspace` relies on them. If a FK violation is in
your way, it is telling you about an ordering problem. **Never silence it by
dropping the FK.**

**Check the catalog, not the repo.** A constraint's real name, a trigger, a
cascade rule and a foreign key are facts about the *database*; no grep of
`apps/` can see any of them, and the repo has disagreed with the catalog four
times. Migration `0003_scaffold_owns_its_tenancy.sql` guarded a DROP on a
constraint *name* that Postgres had never used, so the drop matched nothing, the
add succeeded, and the table ended up carrying **both** foreign keys — every
statement succeeded and `psql` exited 0. Match on `confrelid`, and read
`pg_constraint` after running a migration.

### The CLI

**`bk` defaults to PRODUCTION.** It reads `~/.config/bk/config.json`, which holds
a real token against real deployments. **Set `BK_CONFIG_DIR` to a temp directory
before running `bk` in any automated context** — a test, a script, an agent loop.

**`Confirm()` is not a guard for an agent.** It auto-approves under
`BK_NO_PROMPT=1` and on a non-TTY, which is exactly how agents run. For anything
irreversible, require the caller to repeat the target back:
`bk workspace delete <slug> --confirm <slug>`, even with `--yes`.

---

## 3. Two files stand between a code change and unrecoverable data loss

Read both before touching anything that can reach them:

- `packages/platform-db/src/schema.ts` at `blobReferences`
- `packages/platform-storage/src/references.ts`

The store is shared by every app, so a file uploaded by one app can be deleted by
another. What makes that safe is `platform.blob_references`, an index each app
maintains **from Postgres triggers on its own content tables** — trigger-
maintained precisely so that no *write path* can forget it. That concentrates the
whole remaining risk in one place: **any new content column that can hold a file
URL needs a `blob_references` trigger, in the same migration.**
`docs/adding-an-app.md` step 4.

`bk super-admin blob-drift` is the reconciler. Read `missing_count` first: a
`missing` row is a file another deployment could delete while it is still in use.
`unreconciled_count` is **not** drift — it is rows nobody looked at, and it exists
because a clean report over a partial index is the most reassuring wrong answer
that route can give.

---

## 4. How the checks here have been wrong

`CLAUDE.md` carries the table of twenty-one guardrails found green-but-inert.
What follows is the *shapes*, which is what transfers. The governing rule is:

> **A check you have not watched fail is not a check.** Before claiming any
> guard, test, assertion or probe works, break the thing it guards and watch it
> go red. Then restore.

- **An absence is only evidence if your instrument could have seen the presence.**
  An agent recorded, four times, that a button produced a *silent* no-op — from
  full-page screenshots taken seconds apart. The click actually raised a
  four-second toast naming two recoveries; every sample landed after it had gone.
  Same shape as a log you tailed too late, a row you counted before the
  transaction committed, a grep over a file the build had not written yet.
  Before reporting "it did not happen", establish that your instrument could have
  caught it happening.

- **A guard that matches text will match the text that explains it.** Four
  instances in one week. Strip comments before scanning, or anchor to a location
  rather than to an allowance list — an allowance keeps itself alive and can
  never go stale.

- **A check built on "was this denied?" cannot tell a working boundary from an
  absent subject.** A role granted nothing denies everything with `42501` and
  passes six of eight denial checks. **Assert the positive case first** — the
  thing that must SUCCEED — and treat the denials as the weaker half.

- **…and a positive case must assert the OUTCOME, not a side effect on the way to
  it.** The sharpest one in the table: a guard written specifically to satisfy
  the rule above watched a flag that the *error handler* also set, and so passed
  against an unconditional refusal. A flag, a counter or a spy the failure path
  also trips is not evidence the happy path ran. Found by mutation, not by
  review, and the mutation worth running against any discriminating check is
  *make the subject refuse unconditionally*.

- **A correct change silently retargets an existing assertion.** The most
  insidious shape, because nothing is written wrong: widening a value was the
  right fix, and it left an assertion phrased for the old narrower set pointing
  at the new wider one, where it could no longer fail. **When you widen or rename
  a value, grep for what asserts on it** — the diff that breaks a guard rarely
  touches the guard.

- **The thing that matters is usually outside where you looked.** A Postgres
  trigger is not in the TypeScript. A dependency through a shared factory is not
  in the app's own files. A foreign key's delete rule is only in the catalog.

- **Route tests cannot see a page.** Every behavioural check here —
  `cli-parity`, `bk`, `curl`, the integration suites — sees `app/api/**` and
  nothing else. A Next.js server component reads the database directly, and a
  React query's belief about a wire format is a third thing again. **Two bugs
  shipped to production in two days and both lived where every route was
  correct**: a dashboard 404'd for every sales-only account for four phases while
  every API route returned 200, and a members page rendered blank because a cast
  *renamed* the `{ data, next_cursor }` envelope instead of opening it. When a
  change moves where data lives, open the pages in a browser and report what you
  saw **per page**.

- **A commented-out or skipped check reports success.** If a check cannot run
  yet, make it skip **loudly** — `RAISE NOTICE`, `t.Logf`, raw
  `process.stderr.write`. Not `console.warn`: vitest intercepts and drops it for
  a skipped suite, which is how the replacement for a silent skip became
  byte-identical to the thing it replaced.

- **Assert your inputs.** Every "did we find anything to check?" assertion in
  this repo exists because a guard that found nothing would otherwise pass.

### And it happens to people, not only to guards

Four times in four days, in one shape:

| Claimed | What the command actually asked |
|---|---|
| "neither app has a signup screen" | *is there a PAGE whose path contains "signup"* — it was a tab on `/login` |
| "`ensureWorkspaceForUser` has one call site" | one file, after the wide grep timed out |
| "`verify.sh` is clean" | three schemas, while a fourth app existed |
| "this edit landed" | the commit succeeded; the `assert` before it had failed and written nothing |

Every one: **the check was correct, and the claim made from it was larger than
the check.** Before reporting a negative — *"there is no X"*, *"nothing reads
Y"*, *"that is done"* — say what question your command actually asked, and check
that it is the question you are answering.

Writing this section does not exempt you. One entry in `CLAUDE.md`'s table was
written *to satisfy* another entry and carried that entry's own disease.

---

## 5. How to work here

### Every change lands in three places, in the same commit

| # | Edit | Where |
|---|---|---|
| 1 | The **route** | `apps/<app>/app/api/**` |
| 2 | The **`bk` command** + its `routes` annotation | `cli/internal/commands/<app>/` or `platform/`, `cli/internal/client/` |
| 3 | A dated **changelog** entry | `docs/changelog/<app>.md`, or `platform.md` |

Plus a conditional fourth: if agent-visible *behaviour* changed (a flag, a
workflow, a failure mode), update the guide topic. If only a *value* changed,
change its source — `bk meta` carries it live, and **a guide topic may never
restate a dynamic value**; `guide_test.go` fails the build if one does.

The `routes` annotation takes the literal `"none"` when a command makes no HTTP
call — required rather than allowed-to-be-empty, so an oversight stays visible.

### The gate, from the repo root

```bash
npm run typecheck              # NOT `npx tsc --noEmit`
npm test
npm run lint
npm run build
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes          # if any `routes` annotation changed
```

**`npx tsc --noEmit` does not work from the repo root, by design.** There is no
root `tsconfig.json`, because a root config that compiled nothing would report a
vacuous green — the exact failure this repo has twenty-one recorded instances of.
Use `npm run typecheck`, or `cd apps/issues && npx tsc --noEmit`.

`npm run build` does not touch a database: the `postbuild` hook only migrates
when `RUN_MIGRATIONS` is set, which is true in Vercel Production only.

### Migrations

**One ledger per app.** Each app owns its own `lib/db/migrations/` and its own
drizzle journal; there is no shared migration sequence. An app never `ALTER`s
another app's table, and never adds a column to a platform table to make room for
its own entity type — the counters decision (`docs/platform-architecture.md`
§4.6) is the worked example of why.

### Releasing

`./devops/release.sh cli minor` and `./devops/release.sh web <app>` — a web
release targets exactly **one** app, so name it. `./devops/release.sh apps` lists
what is deployable.

**The order is: deploy web, then npm, then deploy web AGAIN — and "web" means
EVERY app, both times.** The release script bumps `CLI_LATEST_VERSION` in a
commit it creates itself, so that commit lands *after* the first web deploy;
without the second deploy, production keeps advertising the old version and no
installed client is ever told an update exists. And because every deployment
answers the "current version?" question from that one shared constant while `bk`
asks whichever app the user is *homed* on, deploying only one app leaves everyone
homed on the other uninformed. Both halves were verified on 2026-08-10.

`CLI_MIN_VERSION` hard-blocks every older binary with exit 8. **Publish to npm
before raising it** — raise it first and every user is locked out with nothing to
upgrade to.

### Where documentation goes

Two locations, and the split is load-bearing: **root docs never describe an app's
internals, and an app's docs never describe another app.** The test is *would a
second app need this unchanged?* — yes → `/docs`, no → `/apps/<app>/docs`.

Three further rules:

- **Never present the HTTP API as a way to use the product.** There are two doors:
  the web UI for humans, `bk` for agents. Do not reintroduce an OpenAPI spec or a
  page manifest; both were deleted in 2026-08 as hand-maintained copies of facts
  that lived elsewhere and had already drifted. (The `/api/openapi.json` and
  `/api/docs` **routes** still exist and are meant to — they return a 410 Gone
  carrying a `suggestion`, which an agent on stale context can act on inside the
  same run. Do not "clean them up".)
- **Dated logs are history — do not rewrite them.** `docs/changelog/*.md`,
  `docs/next-fixes.md` and the migration records say what was true on a date. If
  one has become misleading, add a **dated note at the top**; leave the body.
- **A doc that prescribes a rejected design is worse than no doc.** When a
  decision supersedes something written down, **rewrite the original** rather
  than appending to it. Leaving the losing option in place is how the next person
  re-litigates it. `docs/platform-architecture.md` §4.4 and §4.6 both carry the
  rewrite plus a note saying what they used to claim and which measurement
  changed it — that is the pattern to copy.

### A citation is a claim

Four comments in this repo cited `*.test.ts` files that had never been written,
three of them in headers describing invariants on the blob-deletion path — where
a reader deciding whether a change is safe takes the citation as evidence. That
is now guarded by `packages/platform-testing/test/cited-tests-exist.test.ts`.
Nothing guards a citation to a non-test file: on 2026-08-11 four live documents,
including `CLAUDE.md`, pointed the rich-text editor at
`apps/issues/components/rich-text-editor.tsx`, a path that has not existed since
the migration moved it into `packages/platform-ui`. **Grep before citing.**

---

## 6. Where to go next

| Need | Read |
|---|---|
| Add an app | `docs/adding-an-app.md` — authoritative, self-contained, walk it top to bottom |
| Current design rules | `docs/platform-architecture.md` |
| Why the repo looks like this, and what is still owed | `docs/2026-08-platform-migration.md`, `docs/2026-08-multi-app-refactor.md` §9 |
| The database boundary, roles, grants | `docs/platform-db.md` |
| Remove an app | `docs/extracting-an-app.md` — rehearsed |
| Shared API conventions | `docs/backend.md` |
| Theme, primitives, data fetching | `docs/frontend.md` |
| CLI internals, build, release, version policy | `docs/cli.md` |

`docs/architecture-rebuild.md`, `docs/specs/`, `docs/next-fixes.md` and
`docs/migration/` are **historical**, each carrying a dated superseded note.
Never follow them as instructions.
