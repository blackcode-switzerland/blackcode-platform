# AGENTS.md

Guidance for any developer or AI agent working in this repo. The authoritative,
detailed instructions live in **`CLAUDE.md`** — read it. This file is the short,
load-bearing summary.

## What this project is

A **monorepo** (npm workspaces + Turborepo) of Blackcode's internal apps:

**Two apps are in production**, on one database and one login —
`issues.blackcode.ch` and `sales.blackcode.ch` (live 2026-08-10).

- **`apps/issues`** — an AI-native, Linear-style issue tracker. The first app.
- **`apps/sales`** — prospects, meetings, communications. The second app, and the
  reason the platform is shaped the way it is: it was the second question every
  shared thing had ever been asked.
- **`apps/_scaffold`** — the scaffold. A real, minimal app that builds and passes
  every guardrail. **Copy it to add an app; do not edit it in place.**

Humans use the web UI; **agents use one interface: the `bk` CLI** (`cli/`, Go,
published to npm as `@blackcode_sa/bc-issues`).

Run every command from the **repo root**; Turborepo delegates into the workspace.

**The platform migration is finished — all nine phases (0–8) have landed.**
`packages/platform-{db,api,ui,auth,agent,storage,testing,email}` exist — eight,
`platform-email` since 2026-08-11. The database is `platform.*` + `issues.*` +
`sales.*` (never `public`), one bounded role per app. Apps are real data
(`platform.apps` is the address book). The CLI, guide, changelog, `bk meta` and
docs are split per app; everything is addressable by URN; the blob STORE is
shared and reference-counted across apps while each app keeps its own upload
LEDGER.

**What the apps share is short: one account, one password, one set of API tokens,
one sign-in, one app registry, one Blob store.** Everything else — workspaces,
members, invitations, comments, labels, uploads ledger, activity, trash, search —
each app owns. **There is no per-app access gate**: `platform.workspace_apps`,
`platform.app_access`, `requireAppAccess` and `PLATFORM_ENFORCE_APP_ACCESS` were
all dropped on 2026-08-10, because a workspace now belongs to exactly one app and
**membership is the whole gate**. Beware: a table living in `platform.*` does not
mean it is shared — most of them are `apps/issues`' own
(`docs/platform-architecture.md` §2).

New here? **`docs/working-in-this-repo.md`** is the orientation: the traps, the
shapes the checks have been wrong in, and how to work here. Adding an app is
**`docs/adding-an-app.md`** (walked end to end). Extracting one is
**`docs/extracting-an-app.md`** (rehearsed). The database boundary is
**`docs/platform-db.md`**.

Commands come in TWO tiers since 2026-08-10 and the spelling says which
(`bk guide platform/apps`). **Bare** is your account and this binary — `login`,
`logout`, `whoami`, `token`, `profile`, `meta`, `app`, `guide`, `skill`,
`changelog`, `version`, `super-admin`. **App-owned** is everything that touches
an app's data, behind the app name: every app noun plus `workspace`, `member`,
`invite`, `user`, `upload`, `trash`, `label`, `search`, `activity`, `inbox`,
`storage`. `bk link` was removed. The cross-app tier existed because the apps
shared a database; Phases 2–3 ended that, so a bare data verb had only a default
taken from the home app. Shared code: `cli/internal/appverbs`, whose `Config`
declares what each app SERVES — a permanent subset is legitimate (D-36), so a
verb an app has no route for is absent from its group rather than 404ing. **The
active workspace is per app**; two apps' workspace tables have overlapping ids.

**URNs.** `bc:<app>:<workspace-slug>/<entity-type>/<number>`, using the workspace
#number like everything else, and derived from the app's OWN tables. Every issue,
task and project is mirrored into `platform.entities` **in the same transaction
as the source row** — a projection that can drift is worse than no projection.
`bk super-admin entity-drift` catches what you missed. **`apps/issues` is that
index's only writer since 2026-08-10**; `apps/sales` keeps its records, its
labels, its upload ledger and its event feed in `sales.*`.

**The blob index.** `platform.blob_references` is how one deployment learns what
another app's content points at without reading its tables. It is maintained by
**Postgres triggers**, not application code, so no write path can forget it —
which concentrates the whole risk in one place: **a new content column that can
hold a file URL needs a trigger, in the same migration.** `bk super-admin
blob-drift` is the reconciler.

The HTTP API under `apps/<app>/app/api/**` is **private plumbing with no public
contract**. Never reintroduce an OpenAPI spec or a fat page manifest — both were
deleted on 2026-08-03 because they were hand-maintained copies that drifted. The
`/api/openapi.json` and `/api/docs` routes remain as 410 stubs carrying a
`suggestion`, deliberately and indefinitely.

Two sources of truth, and only two:

| Kind of knowledge | Where | Why there |
|---|---|---|
| **Static** — how the tool behaves (flags, exit codes, workflows) | `cli/internal/guide/topics/{platform,<app>}/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *the binary being run*. |
| **Dynamic** — what the data is now (vocabularies, limits, workspaces) | the server, via `GET /api/meta` → `bk meta` | Changes without a CLI release. |

A guide topic must **never** restate a dynamic value. Point at `bk meta`.

## The standing rule: prove it fires

> **A check you have not watched fail is not a check.** Break the thing it
> guards, watch it go red, restore.

**Twenty-one guardrails in this repo have been found green-but-inert**, each of
which looked like working protection: three packages with no ESLint config at
all; a `SECURITY DEFINER` guard comparing `current_user` (the function's owner)
instead of the caller; an orphan check that structurally could not detect an
orphan; an import rule whose globs matched none of the imports that escape an
app; a route collector that deduped two apps into one; a probe that was
**commented out** (a commented-out probe reports success); `pg_dump
--schema=issues`, which prints 27 errors, exits 0, and leaves a database that
boots with its triggers and foreign keys silently gone; a provisioning script
whose grants named a schema it never created, failing five of ten statements and
exiting 0; and a **migration** that was guarded, re-runnable, idempotent, did
nothing, and reported success.

**The count is still growing, and it does not fall as the rule gets better
known.** Several were found *after* the migration closed; five landed in the
phase whose entire job was to disbelieve the previous one, two of them being that
phase's own new guards, found inert within minutes of being written. Assume the
next one exists. Full list with the mechanism of each: `CLAUDE.md`; the
transferable *shapes*: `docs/working-in-this-repo.md` §4.

Four corollaries: **a skipped check must skip LOUDLY** (not `console.warn` —
vitest drops it); **assert your inputs**, since a guard that found nothing to
check otherwise passes; **a check built on "was this denied?" cannot tell a
working boundary from an absent subject**, so assert the positive case first —
and make that positive case assert the OUTCOME, not a side effect the error path
also trips; and **check the catalog, not the repo** — a constraint name, a
trigger and a cascade rule are facts no grep of `apps/` can see.

## The one rule that matters most

> **Every change lands in three places, in the same commit:**
> **route → `bk` command → changelog entry.**
>
> Plus a conditional fourth: a guide topic, *only* if agent-visible behaviour
> changed. If only a value changed, edit its source — `bk meta` serves it live.
>
> Corollary: **every API route must be reachable from `bk`.** A route with no
> command is a capability an agent cannot use.

Detail:

1. **Route** — `apps/<app>/app/api/**`. Workspace-scoped under
   `/api/workspaces/{ws}/…`; auth + errors via `apiHandler` + `Errors`; lists via
   `jsonList()` → `{ data, next_cursor }`; create → 201; delete →
   `{ deleted: true }`.
2. **CLI** — add or update the command + client method, **and its `routes`
   annotation** (`Annotations: map[string]string{"routes": "GET /api/…"}`, or
   `"none"` when the command makes no HTTP call). App nouns go in
   `cli/internal/commands/<app>/`, shared verbs in `commands/platform/`; the two
   must not import each other (`boundaries_test.go`).
3. **Changelog** — one dated entry at the top of the right `docs/changelog/*.md`:
   `platform.md` for anything shared, `<app>.md` for one app's own surface.

Conditional, only when it applies:

- **Guide** — behaviour changed → the relevant topic. A topic under
  `topics/<app>/` may not describe another app.
- **`bk meta`** — a vocabulary or limit changed → update its source
  (`apps/issues/lib/{work-items,limits,upload}.ts`); `/api/meta` follows.
- **Deprecations** — renamed or removed a flag/command → add a row to
  `cli/internal/commands/deprecations.go` in the same commit.

This is enforced. Each app's **`lib/cli-parity.test.ts`** fails the build if a
route has no CLI coverage or the CLI claims a route that doesn't exist — **per
app**, with exactly one app owning the shared platform routes. Each app's
**`lib/app-isolation.test.ts`** fails on an import resolving into another app or
a query naming another app's schema. **`cli/internal/commands/routes_test.go`**
fails if a leaf command declares nothing at all.

## Writing commands agents can survive

- **`Confirm()` is not a guard for agents** — it auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY, which is how agents run. For anything
  irreversible, make the caller repeat the target back (`--confirm <slug>`), even
  with `--yes`. Never default a destructive command to the active workspace.
- **Irreversible commands report WHAT they did.** `bk trash purge` echoes the
  type, #number and title of every item destroyed, captured before the delete.
- **Every failure exits non-zero with one line on stderr.** Exit codes are the
  contract; stdout stays parseable. Cobra's defaults are corrected in `root.go`.
- **A dead end must name its own exit** — the server's `suggestion`, a
  `deprecations.go` row, or `bk skill sync`. See `hintFor()` in `cmd/bk/main.go`.

## Before you finish an API/feature change

Run these **from the repo root**:

```bash
npm run typecheck                                         # NOT `npx tsc --noEmit`
npm test                                                  # incl. per-app parity + isolation
npm run lint                                              # all apps and packages
npm run build                                             # pure build; touches no database
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes                                     # if a `routes` annotation changed
```

`npx tsc --noEmit` has no root `tsconfig.json` to find — deliberately, since a
root config compiling nothing would report a vacuous green.

## Conventions cheat-sheet

- **Auth:** `bk login` (or a browser session for the web UI).
- **Errors:** `{ error, code, suggestion?, details? }`, built by `errorBody()` in
  `@blackcode/platform-api`. Set `suggestion` on any 400/404/409 an agent can
  hit; the CLI prints it as a `hint:` line.
- **Lists:** `{ data, next_cursor }`, via `jsonList()`.
- **Addresses are #numbers, never row ids.** Trash was the last exception and
  stopped being one in 1.12.0.
- **No legacy routes:** everything tenant-scoped goes under `/api/workspaces/{ws}/…`.
- **Enums:** single source is `apps/issues/lib/work-items.ts`; `/api/meta` serves them.
- **Limits:** single source is `apps/issues/lib/limits.ts` (or
  `packages/platform-api/src/limits.ts` when shared). Never re-type a number.
- **Counters live in the app**, not in a shared platform table (§4.6).
- **Docs live in two places:** `/docs` is the platform, `/apps/<app>/docs` is that
  app. Root docs never describe an app's internals; app docs never describe
  another app.
