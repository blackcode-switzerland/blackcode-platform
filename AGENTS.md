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
`packages/platform-{db,api,ui,auth,agent,storage,testing}` exist; the database is
`platform.*` + `issues.*` + `sales.*` (never `public`), one bounded role per app;
apps are
real data and every workspace-scoped route enforces per-app access; the CLI,
guide, changelog, `bk meta` and docs are split per app; everything is addressable
by URN; storage is shared, app-prefixed and reference-counted across apps.

Adding an app is **`docs/adding-an-app.md`** (walked end to end). Extracting one
is **`docs/extracting-an-app.md`** (rehearsed). The database boundary is
**`docs/platform-db.md`**.

Commands come in three tiers and the spelling says which (D-11 —
`bk guide platform/apps`). **Neutral** stays bare (`workspace`, `member`,
`invite`, `token`, `profile`, `inbox`, `meta`, …): the same answer from any app.
**Cross-app** stays bare and tags its results (`search`, `activity`, `link`,
`storage`) — but only the deployment holding the shared index answers them; one
that does not returns 404 with a hint, and `link` is retiring (2026-08-10). **App-owned** sits behind the app name — every app noun, plus
`upload`, `trash` and `label` since 3.0.0, because a file's ownership, a recycle
bin and a label each belong to one app. You upload INTO one app and list ACROSS
all of them. Shared code: `cli/internal/appverbs`.

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

**Nine guardrails in this repo have been found green-but-inert**, each of which
looked like working protection: three packages with no ESLint config at all; a
`SECURITY DEFINER` guard comparing `current_user` (the function's owner) instead
of the caller; an orphan check that structurally could not detect an orphan; an
import rule whose globs matched none of the imports that escape an app; a route
collector that deduped two apps into one; a probe that was **commented out**
(a commented-out probe reports success); `pg_dump --schema=issues`, which prints
27 errors, exits 0, and leaves a database that boots with its triggers and
foreign keys silently gone; a test asserting a hand-written error string the
binary never emits; and a guide guard that banned six literal strings and passed
two entire hardcoded vocabularies.

**The count is still growing.** Two of the nine were found *after* the migration
closed — including the import rule above, which was still green four days after
being diagnosed, sitting next to its working replacement. Assume the next one
exists. Full list with the mechanism of each: `CLAUDE.md`.

Two corollaries: **a skipped check must skip LOUDLY**, and **assert your inputs**
— a guard that found nothing to check otherwise passes.

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
