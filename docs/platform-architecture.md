# Blackcode Platform Architecture

**Status: this is how the platform works today.** Every rule below is live in
production. It describes the shape of the monorepo, the database boundary, the
access model, the URN scheme and the separation rules between apps.

Read this before starting work on a second app, or before touching anything in
`packages/platform-*`, an app's `lib/db/schema.ts`, `lib/api/`, or `cli/`.

- **How** to add an app: [`adding-an-app.md`](adding-an-app.md) — the walked checklist.
- **Why** the repo looks like this: [`2026-08-platform-migration.md`](2026-08-platform-migration.md) — the history.
- **How to remove** an app: [`extracting-an-app.md`](extracting-an-app.md) — rehearsed.
- **The database boundary** in operational detail: [`platform-db.md`](platform-db.md).

> This document was `PLATFORM-ARCHITECTURE.md` at the repo root until 2026-08-06,
> where it opened "decided, not yet implemented". It is all implemented. The
> sequencing and phase-ordering sections it used to carry are history and now
> live in `2026-08-platform-migration.md`; every design rule was kept.

---

## 1. The decision, in one paragraph

Blackcode runs a **monorepo of apps on a shared platform**: one Turborepo, one
Neon project with **one Postgres schema per app**, shared `packages/platform-*`
libraries, **one `bk` CLI** with a subcommand namespace per app, and **separate
Vercel projects + subdomains** per app. Apps stay visually and operationally
independent; underneath they share identity, workspaces, files, activity and the
agent surface.

Full separation — separate repo, database and CLI per app — was **rejected**. It
rebuilds ~65% of the codebase N times and makes cross-app agent work impossible
without distributed joins performed by an LLM. That decision is settled; see §10
for why it does not block selling an app later.

## 2. Why — the platform/app split was already there

Of the 26 tables the single app had, only about a third were an issue tracker.
The rest was a general-purpose internal-app platform, and the migration made that
split explicit.

| Layer | Tables |
|---|---|
| **`platform.*` — genuinely shared, every app reads the same row** | `users`, `apps`, `api_tokens`, `password_reset_otps`, `email_whitelist`, `blob_references` |
| **`platform.*` — the ISSUES app's, in the platform schema for historical reasons** | `workspaces`, `workspace_members`, `workspace_invitations`, `uploads`, `comments`, `labels`, `events`, `inbox_messages`, `deletion_batches`, `entities`, `links` |
| **`platform.*` — neither: infrastructure** | `error_events` (every app writes its own rows; nobody reads another app's) |
| **`issues.*`** | `issues`, `tasks`, `projects`, `project_updates`, `issue_labels`, `issue_assignees`, `issue_watchers`, `project_labels`, `project_members`, `attachments`, `workspace_counters` |
| **`sales.*`** | its own `workspaces`, `workspace_members`, `invitations`, `labels`, `uploads`, `events`, `user_preferences`, `counters`, plus the pipeline nouns |

> **The second row is the one that misleads.** *Being in `platform.*` no longer
> means "shared".* multiAppFinalRefactor Phases 2 and 3 (2026-08-10) gave
> `apps/sales` its **own** workspaces, members, invitations, labels, uploads
> ledger and events, in `sales.*`; it does not read the `platform.*` copies of
> any of them, and `platform.entities` has had **`apps/issues` as its only
> writer** since Phase 3. Those tables stayed where they are because moving a
> live app's tenancy costs a migration and buys nothing — not because a second
> app shares them. A new app gets its own, in its own schema: see
> `docs/adding-an-app.md`.
>
> The short version of what IS shared: **one account, one password, one set of
> API tokens, one sign-in, one app registry, one Blob store.** Everything else
> an app touches, it owns.
>
> `platform.transaction_log`, `platform.workspace_apps` and `platform.app_access`
> were dropped 2026-08-10 — §4.5. (`transactionLog` is still declared in
> `packages/platform-db/src/schema.ts`; the table is not there. Read that
> declaration's comment before touching it.)

Two properties made the original split cheaper than expected and are still true
of the issues copies: `comments` is **polymorphic** (`parent_type` / `parent_id`),
and `labels` / `uploads` are **workspace-scoped, not issue-scoped**. Both grew an
app dimension in Phase 1e of the sales app — `<app>:<noun>` type columns and
`labels.app` — for the reason §4.6 gives: polymorphic and shared is not the same
as app-neutral. Phases 2–3 then went further and gave sales its own tables
outright, which is the shape a third app should copy.

## 3. Repo layout

```
blackcode-platform/                 (monorepo, Turborepo)
├── apps/
│   ├── issues/                     the product
│   ├── _scaffold/                  the scaffold — copy it, never edit in place
│   └── …                           each: app/ components/ lib/ docs/ public/
├── packages/
│   ├── platform-db/                Drizzle schema + client for the `platform` schema
│   ├── platform-auth/              next-auth config, bk_live_ tokens, per-app access
│   ├── platform-api/               apiHandler, Errors, jsonList, pagination, limits
│   ├── platform-ui/                design system, rich-text editor, confirm dialog
│   ├── platform-storage/           upload ledger, app-prefixed paths, the delete gate
│   ├── platform-agent/             merged changelog feed, CLI version floor
│   └── platform-testing/           the CLI-parity and app-isolation harnesses
├── cli/                            ONE Go binary `bk`
│   └── internal/
│       ├── commands/platform/      login, meta, guide, changelog, workspace, search, link
│       ├── commands/issues/        issue, task, project
│       ├── cmdutil/                what both need; app packages never import each other
│       └── guide/topics/{platform,issues,template}/
├── docs/                           PLATFORM docs only — see §7.5
│   ├── changelog/                  one file per app + platform.md — see §7.3
│   └── sql/                        role creation, the boundary probe, rollbacks
├── devops/
├── package.json                    workspaces manifest only, no app deps
├── turbo.json
└── tsconfig.base.json
```

**There are eight platform packages.** `platform-storage` and `platform-testing`
arrived during the migration and are as load-bearing as the rest — the first owns
the only code that can reach `del()`. **`platform-email` arrived last**, on
2026-08-11, when `apps/sales` became the second sender; it was the final piece of
shared behaviour still living inside `apps/issues`, and the screens that deferred
to another app for a password change were the visible cost of that.

Each app keeps its own `app/api/**`, its own Drizzle schema file for its own
Postgres schema, its own guide topics, its own `docs/`, and its own Vercel
project. **No app publishes an OpenAPI spec** — see §6.

## 4. Database and storage

### 4.1 How the connections work

A Vercel storage "connection" is just **env vars injected into a project** —
`DATABASE_URL` from Neon, `BLOB_READ_WRITE_TOKEN` from Blob. Shared vs isolated
is purely a question of which values go where.

| Resource | Setup |
|---|---|
| Neon project | **one**, shared by every app |
| Neon role + connection string | **one per app** — `issues_app`, `sales_app`, … |
| Vercel Blob store | **one** production store, shared, with a per-app path prefix |

Every Vercel project points at the *same* database but logs in as a *different*
Postgres role. That role carries the grants in §4.3 — which is what makes the app
boundary a database guarantee rather than a convention.

When adding an app in Vercel, connect the **existing** Neon project and Blob
store. Do not let the integration provision new ones.

> **There is a second Blob store, and it is not redundant.**
> `blackcode-platform-preview-blob` is wired to preview deployments only.
> `sweepOrphanedUrls` runs on user action — purging from trash, hard-deleting a
> comment — so a preview deployment pointed at the production store would delete
> real production bytes. The separate preview store is what makes that
> impossible. Removing it reintroduces the path.

### 4.2 Neon branches are the wrong axis for apps

A branch is a copy of the **whole database at a point in time**, for a different
*environment*. Giving each app a branch would give each app a private copy of the
data no other app can see — the opposite of the goal.

> **Branches = environment axis (prod / preview / migration rehearsal).
> Schemas = app axis.**

Branches are used for preview deployments and for rehearsing migrations, and
rehearsing on one is expected before any platform-schema change.

### 4.3 One Postgres schema per app

The split is decided by one question — *"would a sales app need this?"*

```
platform.*   users, workspaces, workspace_members, workspace_invitations,
             apps, api_tokens, password_reset_otps,
             email_whitelist, uploads, comments, labels, events, inbox_messages,
             deletion_batches, error_events, links, entities, blob_references

issues.*     issues, tasks, projects, project_updates, issue_labels,
             issue_assignees, issue_watchers, project_labels, project_members,
             attachments, workspace_counters
```

A sales app needs workspaces, members, comments on a deal, files on a deal,
labels, an activity feed and an inbox. Those are org concepts, not issue-tracker
concepts. Only the tables that literally name an issue/task/project are
app-specific.

This is a real namespace, not a naming convention: Neon's table browser has a
schema dropdown, so `platform` / `issues` are visually separate the moment you
open it, and in code it reads `issues.issues` vs `sales.deals`.

**The boundary rule (non-negotiable):**

- An app **may** FK into and query `platform.*` freely.
- An app **may not** read or write another app's schema. Cross-app reads go
  through that app's HTTP API, or through `platform.links` / `platform.events`.

This is enforced with **per-app Postgres roles and grants**, not code review. The
`sales` role has no `SELECT` on `issues.*`. Production runs as `issues_app`,
which owns **zero** objects and can perform no DDL and not touch the migration
ledger. Prove it with `docs/sql/app-boundary-probe.sql`, run **as the app role** —
the properties are invisible from any other session, which is why it is a manual
provisioning step and not a CI test.

**Two code-level checks stand in front of the grant**, because a violation the
grant catches is one that reached production:

| Where the code is | What checks it | Added |
|---|---|---|
| `apps/<app>` | `lib/app-isolation.test.ts` — no import resolving into another app, no query naming another app's schema | 2026-08-06 (replacing a dead ESLint rule) |
| `packages/platform-*` | `packages/platform-testing/test/package-isolation.test.ts` — no query naming ANY app's schema | 2026-08-06 |

> **Why the second one is not redundant with the compiler.** Shared code cannot
> *import* an app table — `platform-db`'s schema does not contain one, so it does
> not compile. Raw SQL walks past that, and raw SQL is a shape shared code
> already uses. The failure is the worst available: the issues role *can* read
> `issues.*`, so it works in the deployment where it was written and 42501s in
> every other one. It works for the author and breaks for everyone else.
>
> The app-name list is **derived from each app's `APP_SLUG`**, never typed out. A
> hardcoded list is wrong the day app four lands, and its failure is silence.

> **`pg_dump --schema=<app>` is NOT an extraction path, and it fails silently.**
> The dump emits the app's triggers and every foreign key into `platform`; all of
> them fail at restore, and `psql` exits **0** regardless. The result boots,
> serves content, and has quietly lost referential integrity and all blob-index
> maintenance. An extraction dumps `platform` + the app's schema + `drizzle`.
> Procedure: [`extracting-an-app.md`](extracting-an-app.md).

### 4.4 Each app owns its workspaces

**A workspace belongs to exactly one app.** `platform.workspaces` is
`apps/issues`'; `sales.workspaces` is `apps/sales`'; a new app makes its own.
Membership in an app's workspace is what using that app means, and it is the
whole gate — §4.5.

> **This section used to say the opposite**, and it is rewritten rather than
> footnoted, for the reason §4.6's note gives: a superseded design left in place
> gets re-litigated. It read: *"One workspace record, shared by every app. A
> workspace is the company, an app is a capability inside it. There is one
> `kali-sa` row and every app operates inside it."* Per-app workspaces were
> rejected there on three arguments, and **multiAppFinalRefactor Phase 2
> (2026-08-10) reversed the decision** after each argument was measured:
>
> 1. *"The URN `bc:sales:kali-sa/deal/17` only links meaningfully to
>    `bc:issues:kali-sa/issue/482` if `kali-sa` is the same organisation in
>    both."* — A URN is built from an app's **own** slug and #number, so every
>    app can print and resolve one regardless. Nothing in the URN needed a shared
>    row; what needed one was `bk link`, and that was **removed** (Phase 4) for
>    its own reasons.
> 2. *"`bk activity --ws kali-sa` needs one tenant boundary."* — `activity` is
>    app-owned now (`bk <app> activity`), over that app's own events. There is no
>    cross-app activity read to give a boundary to.
> 3. *"A person should have one workspace list."* — They have one per app, which
>    is the honest list: an app can only answer for its own tenancy, because its
>    Postgres role has no grant on another app's schema (§4.3). The single list
>    was answering for apps it could not see, which is the false answer §4.5
>    documents.
>
> What the old design cost, concretely: there was **no way to put a person into
> b/sales from b/sales** — they had to be invited into an ISSUES workspace and
> then granted the sales app inside it. That is what made the second app an
> add-on rather than an app, and ending it is what the whole refactor was for.
>
> The nominal loss is real and was accepted: the same company can now exist as
> `kali-sa` in two apps with two independent slugs, and nothing keeps them in
> step. No product surface joins them, so nothing observes the drift.

### 4.5 Identity is global, tenancy is per app

| Table | Means | Scope |
|---|---|---|
| `platform.users` | your account | global — one login, every app |
| `platform.workspace_members` | you are in one of THIS app's workspaces | per workspace |

**Membership is the whole gate.** There were two more rows in this table until
2026-08-10 — `platform.workspace_apps` ("this app is on for this organisation")
and `platform.app_access` ("you may use this app here") — and both are dropped
(migration `0045`).

They existed because §4.4's one shared `platform.workspaces` meant a workspace
could run several apps, so "which of them may you open?" was a real question.
multiAppFinalRefactor Phase 2 ended that: each app owns its workspaces
(`platform.workspaces` is `apps/issues`', `sales.workspaces` is sales'), so a
workspace belongs to exactly one app and **its members are that app's users.**
The gate was approximating an equivalence that is now structural.

> **This section previously ended: "Consequence worth having: `bk meta` returns
> only the apps that token can reach. An agent working for a sales-only user
> cannot discover the issues app exists."**
>
> **That rule is RETIRED, not weakened.** It is rewritten here rather than
> footnoted because leaving a superseded rule in place is how it gets
> re-litigated (see §4.6's own note).
>
> It is retired for two measured reasons:
>
> 1. **It is no longer derivable.** Reachability lives in each app's own
>    membership table, and an app's Postgres role has no grant on another app's
>    schema (§4.3). A deployment can answer for itself and for nobody else. This
>    is the same wall as CLAUDE.md finding #14.
> 2. **It was already answering falsely.** A brand-new `apps/issues` signup got a
>    grant for every enabled app, so `/api/meta` reported
>    `apps.sales.workspaces` as their PLATFORM workspace slug — a workspace
>    `apps/sales` answers 404 for, and which sales' own `/api/meta` correctly
>    reported as `workspaces: []`.
>
> It was also only ever skin-deep: `bk` embeds `topics/*/*.md` for **every** app
> into one binary, so anybody who installs the CLI already holds every app's
> guide.

**What replaces it: the address book, and honesty about scope.**
`/api/meta`'s `apps` block is every enabled row of `platform.apps` — which apps
exist and where they are deployed — and `workspaces` is populated **only for the
app answering the request**. An empty array for another app means *"not known
here"*, not *"you have none there"*; conflating those two is what produced the
false claim above. Whether you can get in is answered by the app at that address.

So an app listed as reachable that you have no workspace in is a normal state,
not an error. `bk app list` is the address book; `bk <app> workspace list` is the
question about tenancy.

### 4.6 Counters live in the app, not in a shared table

`workspace_counters` is **`issues.workspace_counters`**. It used to be a platform
table, and the plan called for reshaping it to
`(workspace_id, app, entity_type, last_seq)` so every app could share one
counter. Building `apps/_scaffold` showed that to be the wrong trade, and
migration **0040 moved the table into the app's schema** instead.

The argument: sharing a counter buys **nothing**. No query ever spans two apps'
counters, so a shared table adds only a shared write point and a shared migration
every time any app invents an entity type. An app's #number sequence is app data.
Each app keeps its own — `apps/_scaffold` does it in three lines — and no app
ever ALTERs a platform table to add an entity.

Reshaping in place would also have left the harder half unsolved: it would still
have been a platform table that apps write to, which is the coupling §4.3 exists
to forbid.

> **The general rule this produced:** before reshaping a shared table so more apps
> can use it, ask whether they should be sharing it at all. "Make it generic" is
> the reflex; "move it to the app that owns it" is often the smaller change and
> always the cleaner boundary.

**Both reshapes this section used to list as owed were built on 2026-08-06**, as
the second app's Phase 1e (D-14). They are described here as they now are:

| Reshape | What it is | Migration |
|---|---|---|
| App-qualified type columns | `comments.parent_type` and `deletion_batches.root_type` hold `<app>:<noun>` — `issues:issue`, `sales:prospect`. The CHECK validates the **shape**, never the vocabulary: platform does not enumerate an app's nouns here any more than it does in `entities.entity_type`, so no shared-table migration is needed when an app adds one. What it refuses is a new BARE noun, which is the collision the qualification exists to prevent | `0041`, `0042` |
| `labels.app` nullable column | Set = scoped to that app; `NULL` = shared across every app in the workspace. Every pre-existing row was backfilled to `issues`, so a shared label is only ever one somebody deliberately made shared. **Filtering is the load-bearing half** — every label read on an app's deployment carries `app IS NULL OR app = <that app>`, including the reads that are not lists (resolve-by-name, attach, rename, delete). A column nobody reads is worse than no column: the app-scoped `bk <app> label` spelling then promises something the data does not do | `0043` |

Both are the **expand** half of expand → migrate → contract. The bare legacy
values are still accepted and every read still matches them; dropping them is a
later release, tracked in `docs/next-fixes.md`.

### 4.7 Migrations

Platform-schema changes must be **expand → migrate → contract**. Apps deploy
independently, so a breaking `platform.*` change in a single deploy breaks every
other app for the duration of the window. Never drop or rename a platform column
in the same release that stops using it.

App-schema migrations are unconstrained — nobody else can see them.

Rehearse every platform migration on a Neon branch first (§4.2), **including the
rollback**. Every phase of the migration did, and it caught a real bug in most of
them.

Migrations run as `MIGRATE_DATABASE_URL` (the schema owner), never as the app
role, which cannot migrate by design. Operational detail: [`devops.md`](devops.md).

## 5. Cross-app linking — the part that makes agents work

Three additions to `platform` carry it, and all three are live.

**URNs.** Every entity in every app is addressable by one string:

```
bc:issues:kali-sa/issue/482
bc:sales:kali-sa/deal/17
```

Format: `bc:<app>:<workspace-slug>/<entity-type>/<workspace-number>`. It uses the
**workspace #number**, consistent with the rule that the global db id is never
exposed.

> ### REWRITTEN 2026-08-10 — the shared index has one writer, and links retire
>
> This section described a federated index every app wrote to. It was the design
> and it was reversed, deliberately: `docs/2026-08-multi-app-refactor.md` §1. The
> requirement was *"an agent working in sales can create an issue through the
> same CLI without switching login"*, and that was read as "the apps share their
> data" when it means "**the agent is the thing that connects the apps**". The
> rewrite is here rather than in an appended note because a doc that prescribes
> a rejected design is worse than no doc (§4.6 was rewritten the same way).

**The URN itself is unchanged and is the durable part.** It is derived from an
app's own workspace slug and #number, so any app can build and print one without
consulting anything shared.

**`platform.entities`** — still the index behind `bk search` and `bk link`, and
since 2026-08-10 **`apps/issues` is its only writer**. Every issue, task and
project is projected into it in the same transaction as its source write; a
projection that can drift is worse than no projection. Read the header of
`apps/issues/lib/db/queries/entities.ts` before touching a write path;
`bk super-admin entity-drift` is the reconciler, and it can only ever reconcile
the deployment it runs in.

**`platform.links`** — typed relations between two URNs. **Retiring.** It was the
single biggest reason two apps had to share an index, and what it bought over a
URN written into a record's own text did not justify that. Nothing new should
depend on it.

**`platform.events`** — an append-only activity stream carrying an `app` column.
Once every app's, now `apps/issues`'; `apps/sales` writes `sales.events` and the
shared activity route asks the app where its feed lives
(`ActivityContribution.events`).

**A deployment answers for the apps whose data it holds.** An app that owns its
own records does not serve the bare cross-app verbs at all — it answers 404 with
a hint naming a server that does, which is recoverable, where an empty page
would not have been.

What replaces the federated query is the CLI: **`bk` asks each app's server and
merges the answers**, using one token and the address book in `platform.apps`.
No shared index, no projection, no drift, and it keeps working when app #3
arrives.

### 5.1 Storage is shared, app-attributed, and reference-counted across apps

`platform.uploads.app` records who uploaded each file. New uploads land under
`<app>/<workspace>/<file>`.

> **The LEDGER split on 2026-08-10; the STORE did not.** An app now says where
> it records its uploads (`AppContext.uploads`), and `apps/sales` records them in
> `sales.uploads`. There is still one Blob store, one bill, one quota, one path
> convention — and, crucially, one `platform.blob_references`: the gate that
> stops one app deleting a file another still uses is the piece of cross-app
> machinery this refactor KEPT, because it is the one that earns its keep.

> **Existing blobs were never moved, and must not be.** 104 of 105 files sit at
> the store root with no prefix. Moving them would mean rewriting every URL
> already embedded in descriptions and comments. **`pathname` is where a file is;
> `app` is who owns it.** Do not "tidy" the root files — that is a data-integrity
> operation, not housekeeping.

Blob deletion works across deployments via **`platform.blob_references`**, an
index each app maintains **from Postgres triggers on its own content tables** —
not from application code, so no write path can forget it. That concentrates the
entire remaining risk in one place:

> **Any new content column that can hold a file URL needs a
> `platform.blob_references` trigger, in the same migration.**

A file is deletable only when **no app** references it, and the gate **fails
closed**: an app registered in `platform.apps` that cannot yet answer for its
references stops blob deletion platform-wide — correctly, because nobody can
prove the file is unused. Read `packages/platform-storage/src/references.ts` and
`packages/platform-db/src/schema.ts` at `blobReferences` before touching anything
near this. Those two files are what stand between a code change and unrecoverable
data loss. `bk super-admin blob-drift` is the reconciler; read `missing_count`
first.

## 6. CLI and the agent surface

**One interface, three entry points.** This is the model every future app
inherits — it is not re-decided per app.

| Entry point | Answers | Source of truth |
|---|---|---|
| **`bk guide`** | *How does this tool behave?* — flags, exit codes, workflows | embedded in the binary (`cli/internal/guide/topics/`) |
| **`bk meta`** | *What is the data right now?* — enums, limits, workspaces, health | live from each app's `GET /api/meta` |
| **`bk changelog`** | *What changed, and how do I adapt?* | `docs/changelog/*.md` |

Plus `bk skill sync` as the recovery loop: an agent that hits a wall re-syncs its
skill, re-reads the guide, and retries.

The rule that keeps these coherent scales unchanged to N apps: **a guide topic
never restates a value that `bk meta` carries.** Static behaviour in the binary,
dynamic data on the server. Guide topics that break this fail the build.

**The HTTP API is private plumbing with no public contract.** No OpenAPI spec, no
fat page manifest — both were deleted on 2026-08-03 because they were
hand-maintained copies of facts that lived elsewhere, and had already drifted with
a single app. The `/api/openapi.json` and `/api/docs` routes remain as **410 Gone**
stubs carrying a `suggestion`, deliberately and indefinitely: a 410 an agent can
act on inside the same run beats a 404 that looks like a bug.

**Command shape — one binary, one login, one token, one version floor:**

```
bk login / meta / guide / changelog / workspace / search / activity / link / storage
bk issues  issue … | task … | project …
bk sales   deal … | contact …
```

Platform verbs sit at the root; **every app verb sits behind its app name.** See
§7.1.

`api_tokens` carries a `scopes` column so one `bk_live_` token can be scoped per
app. All the agent-onboarding machinery — the embedded guide, `bk skill` and its
self-update loop, `bk meta` and the limits registry, the CLI-parity test,
`bk changelog`, the version floor — is written **once** and amortises across
every app.

**Consider also:** an MCP server exposing all apps' toolsets under one auth. Given
our consumers are largely Claude/Cursor-style clients, this may be higher leverage
than the CLI for them. `bk` stays for shell and CI. Only affordable under this
shared architecture — under full separation it would be N servers.

## 7. Separation between apps (the rule that keeps this legible)

Shared plumbing is only affordable if the seams stay obvious. A developer or an
agent landing anywhere in this repo must be able to tell **which app they are in**
without tracing imports. Sharing is opt-in via `packages/platform-*`; everything
else is app-local and visibly so.

### 7.1 CLI — two verb tiers, and the tier is visible in the spelling

Rewritten 2026-08-10 (multiAppFinalRefactor Phase 4). This section previously
described THREE tiers, rewritten 2026-08-06 as D-11, which itself replaced "app
nouns are namespaced, platform verbs are bare". Each rewrite fixed the same
mistake at a different scale: sorting verbs by *who implements them* rather than
by *whether two deployments would answer differently*.

| Tier | Verbs | Spelling | Rule |
|---|---|---|---|
| **Bare** | `login` `logout` `whoami` `token` `profile` `meta` `app` `guide` `skill` `changelog` `version` `super-admin` | bare | Your ACCOUNT and this BINARY. One login and one token are valid against every app, so no app can be the wrong one to ask |
| **App-owned** | every app noun, **plus** `workspace` `member` `invite` `user` `upload` `trash` `label` `search` `activity` `inbox` `storage` | `bk <app> <verb>` | The data is the app's. An implicit default here is how a sales contract gets filed under issues |

`bk link` was **removed**: its two ends could live in different apps, which
needed one entity index every app wrote into, and there is no such index now.

**The test is unchanged and is still "would two deployments answer differently?",
never "is it shared code?"** (D-28). What changed is the answers, and it is worth
being precise about which sentences expired:

- The NEUTRAL tier rested on *"no app owns a person or a membership"*. True while
  there was one `platform.workspaces`; false since Phase 2, when `apps/sales` got
  its own. The same person can be in one app's workspace and not the other's.
- The CROSS-APP tier rested on one entity index (`search`, `link`), one event
  spine (`activity`) and one upload ledger (`storage`). Phase 3 ended all four.
- **D-28's pairing — "you upload into one app; you list across all of them" —
  no longer describes anything.** It was right when `storage` read one ledger.
  `AppContext.uploads` made the ledger per app, so both halves are per app and
  `storage` moved with `upload`. The STORE and the QUOTA are still shared, which
  is why the usage total a `storage list` prints is workspace-wide while the rows
  are one app's.

A corollary that cost a subcommand, and still holds: **one noun must not straddle
two tiers.** `bk storage attachments` listed only ISSUE attachments, so it became
`bk issues attachment list` — a noun of that app.

**An app declares which of these it serves** (`appverbs.Config`), and a verb it
has no route for is ABSENT from its group rather than present and 404ing. This is
D-36 one level down: a permanent subset is legitimate, an accidental one is a
bug. `apps/sales` serves `workspace` without `create|edit|transfer|delete` (D-3 —
a workspace is the company), `member` without `leave`, and no `inbox`, `storage`
or `user` at all. Both directions are checked against `app/api/**` by that app's
`lib/cli-parity.test.ts`.

**The active workspace is per app**, keyed by slug in `~/.config/bk/config.json`.
Two apps' workspace tables have overlapping ids by construction (migration 0004
mirrored them), so one shared field meant `bk sales workspace use x` silently
retargeted `bk issues …` — measured against two local deployments before the
field was split, not reasoned about. A config written by an older `bk` has its
single active workspace adopted for the HOME app and for no other; a slug
resolved against one app is not a workspace in another.

`bk sales deal create` is redundant-looking on purpose: it tells you the app, and
`bk deal create` does not. It also removes noun collisions before they happen
(every app will eventually want `report`, `note`, `status`). **Why a namespace
and not a `--app` flag:** a flag can be forgotten and has a default; a namespace
cannot be forgotten, because there is no bare form to type. The corollary landed
in the same phase: `--app` was REMOVED from `search`, `activity` and
`storage list`, where it had become a filter with one legal value.

- `bk --help` lists the two tiers, then one line per app.
- `bk <app> --help` lists that app's nouns and the shared verbs it serves.
- `bk guide`, `bk meta`, `bk changelog` all take `--app <name>` to scope.
- `bk guide platform/apps` is the agent-facing statement of all of this.

Code follows the same shape: `cli/internal/commands/<app>/`, one Go package per
app, and **no cross-imports between them** (`boundaries_test.go`). Anything two
need goes in `cmdutil` or, for whole command trees two apps mount,
`cli/internal/appverbs` — both outside `internal/commands/` for the same reason.
A bare verb stays in `commands/platform/`, whichever tier it is in.

**The split inside an app-owned verb matters.** `appverbs` holds only the
app-agnostic half (label CRUD, the bin, the file cabinet). Anything naming an
app's entities — `bk issues label attach <issue>`, `bk issues storage
attachments` — is built in that app's package and added to the group. That is
what keeps parity honest: `bk __routes` tags the claim with the app that serves
the route, and a shared implementation of `label attach` would make every app
claim an issues route.

Pre-namespace spellings exit non-zero and name their replacement, via
`cli/internal/commands/deprecations.go`: `bk issue …` (removed 1.12.0),
`bk upload|trash|label` (moved 3.0.0, no alias — an alias would have to pick an
app silently) and `bk storage attachments`. That table is the recovery path for a stale script, and
its entries outlive the thing they replace by one release on purpose. The
end-to-end half of that guarantee is `cli/cmd/bk/main_test.go`, which runs the
real command tree: the table alone is reachable only through `hintFor()`, and a
test of the table cannot see `hintFor()` dropping it.

#### 7.1.1 Which server a command reaches (D-1)

Each app is its own Vercel project on its own subdomain, so "which app" is also
"which server". `bk` carries a per-app address book in `~/.config/bk/config.json`
(`home_app`, `home_server`, `app_servers`), **learned** from `/api/meta` by
`bk login` and `bk meta` — never typed, so it cannot drift from what the platform
publishes for longer than one `bk meta`.

| Tier | Server | Set by |
|---|---|---|
| Bare | `home_server` (your account; any app answers alike) | `bk app use <slug>`, or `--app-server <slug>` for one invocation |
| App-owned | `app_servers[<app>]` | the command itself — `bk <app> …` pins it |

Since 2026-08-10 the home app decides much less than it did. It used to route a
dozen data verbs; now it routes only the account questions, and the WORKSPACE
those data verbs run in is per app as well (`config.ActiveWorkspaces`). That is
the real prize of the verb move: **no hidden state decides where a command
lands.**

Three properties are load-bearing, and each has a test:

1. **No fallback.** An unknown app is `cmdutil.UnknownAppError`, naming the app
   and the command that fixes it — never a request to the home server. A
   wrong-server 404 is indistinguishable from a deleted record.
2. **The pin cannot be forgotten.** `root.go`'s `pinApp` wraps every `RunE` in an
   app group's subtree, so a command added later is routed without anyone
   remembering. Enforced by `commands/routing_test.go`, which runs every leaf.
3. **Nobody builds a client behind the resolver.** `cmdutil.ClientForApp` is the
   only place a base URL is chosen; a direct `client.New` in a command package
   fails the same test. Six such call sites existed before D-1 and would have
   sent `bk issues …` to whatever the home server was.

The override is `--app-server`, not `--app`, because `--app` is already a FILTER
on six commands and cobra lets a local flag shadow a persistent one silently.

### 7.2 Guide — one folder per app

`topics/platform/` holds what is true everywhere (auth, workspaces, output + exit
codes, encoding, files, staying current). `topics/<app>/` holds app behaviour.
`bk guide` prints platform first, then each app under its own heading.

A topic under `topics/<app>/` may not describe another app — `guide_test.go`
enforces it, along with the no-hardcoded-dynamic-values rule.

### 7.3 Changelog — one file per app, one merged feed

```
docs/changelog/platform.md      auth, workspaces, uploads, links, CLI itself
docs/changelog/issues.md
docs/changelog/sales.md
```

Files are discovered by reading the directory, so adding an app is adding a file.
`bk changelog` merges them by date into one stream, each entry tagged with its
app; `--app issues` filters. A single file would be a merge-conflict magnet
across app teams and would not survive an app extraction.

A change touching `platform.*` goes in `platform.md`, **not** in the app that
happened to prompt it.

### 7.4 `bk meta` — grouped, never flattened

```jsonc
{
  "user": …, "workspaces": […], "cli": …,      // platform
  "apps": {
    "issues": { "vocabulary": …, "limits": …, "media": … },
    "sales":  { "vocabulary": …, "limits": … }
  }
}
```

Never merge two apps' vocabularies into one top-level list. An agent must not be
able to accidentally send a sales stage to the issues app.

> The top-level `vocabulary` / `limits` / `media` keys still exist and are
> **deprecated**. They are served for binaries older than the namespacing, and go
> away once `CLI_MIN_VERSION` passes the release that stopped needing them. Read
> `apps.<slug>`.

### 7.5 Docs — platform at root, app docs in the app

| Location | Contents |
|---|---|
| `/docs` | the monorepo itself: this file, `platform-db.md`, `backend.md`, `frontend.md`, `cli.md`, `devops.md`, `env.md`, `adding-an-app.md`, `extracting-an-app.md`, `changelog/`, `sql/` |
| `/apps/<app>/docs` | that app only: its domain model, its routes, its UI patterns, its schema |

Rule: **root docs never describe an app's internals; app docs never describe
another app.**

### 7.6 The guardrails that enforce it

- **`lib/cli-parity.test.ts`, per app** — every route reachable from `bk`, every
  claimed route real. `bk __routes` tags each route with its app.

  **The property is two sentences, and each half is checked in a different
  place** (2026-08-07):

  > A platform ROUTE is answered by the apps that mount it.
  > A platform COMMAND must be answerable by at least ONE app.

  The first is per-app: an app's drift check covers its own claims, plus the
  `platform` claims whose route that app actually has a file for — **derived from
  the filesystem, never declared**. The second is repo-wide and lives in
  `packages/platform-testing/test/platform-route-coverage.test.ts`, because
  "nobody serves `GET /api/inbox`" is not any one app's failure.

  **Neither half is sufficient alone.** Scope drift to what an app mounts and
  "no app mounts this" becomes indistinguishable from "another app mounts it" —
  both green everywhere. Verified by injecting an orphan platform claim: every
  app suite stayed green and only the repo-wide check went red.

  The `hostsPlatformRoutes` boolean each app used to set was **retired in the
  same change**. It could not express an app serving a legitimate SUBSET of the
  platform surface, which is a permanent state and not a build-out one — `sales`
  has no reason ever to serve `inbox` (per-user, and it raises no notifications),
  `bk super-admin errors` (platform-wide data, any host answers) or `storage`
  (no route; §D-28's old reason — one ledger, same rows from every deployment —
  expired when the ledger became per app on 2026-08-10). Since Phase 4 the same
  idea runs one level down: `appverbs.Config` declares which shared verbs an app
  serves, so an unmounted one is absent from `bk <app> --help` rather than
  present and 404ing. The plan's earlier answer — a documented `EXCLUDED_PATHS` entry
  per unmounted route — was wrong for a mechanical reason worth keeping written
  down: **an exclusion pushes on COVERAGE and an unmounted route is a DRIFT
  failure**, so excluding the path removes it from the very set drift compares
  against.

- **The export form of a route handler is checked**, in the same file. A route
  serves identically whether it is written `export const GET = …` or
  `export const { GET } = handlers()` — and the second matches none of the
  patterns the guard reads, so the route drops out of coverage while the app
  keeps serving it. The form is **detected and refused**, not parsed: teaching
  the guard to follow a destructuring means a second, weaker route-extractor to
  keep honest beside the authoritative one.

  *(Corrected 2026-08-07: this bullet used to end with a paragraph describing how
  `hostsPlatformRoutes` was "derived-checked, not trusted". That flag was retired
  above, in the change this section documents, and the paragraph was left
  describing a mechanism that no longer exists. `mountedPlatformRoutes` survives
  — it is the filesystem derivation the new drift scope is BUILT on, rather than
  a check on a declaration.)*

- **`UNSERVED_OPERATIONS`, per app** — the per-METHOD half of the subset rule,
  and the thing a new app needs the moment it mounts its first factory. Drift is
  scoped to PATHS an app has a file for, so mounting `GET /api/workspaces/{ws}`
  pulls the `PATCH` and `DELETE` claims on that path into the check whether or
  not the app exports them. Each entry is a decision with a reason, and a
  companion case fails when an entry names a path the app no longer has — an
  exclusion outliving its reason is coverage quietly dropped.

  **D-36 as amended is the rule these two mechanisms serve:** *a permanent subset
  is legitimate; an accidental one is a bug, and the test is whether every bare
  verb has a host from THIS app's login.* Both states look identical from inside
  the app — everything the app itself does works — which is why the test is
  phrased as something you run against a deployment rather than something you
  reason about.

  Known gap, owned by whoever adds the next app: an app mounting only SOME of the
  factories reports the rest as drift. The answer is documented EXCLUDED_PATHS
  entries in that app's test, each naming the tier and the agent who closes it —
  **not** a tier-aware harness. A mechanism whose only job is to make an
  incomplete state look complete outlives the incompleteness.
- **`lib/app-isolation.test.ts`, per app** — no import resolving into another
  app, no query naming another app's schema. **Resolution-based, not
  glob-based.** An ESLint rule tried to cover the first half and never matched
  the shape that actually escapes an app; it was deleted on 2026-08-06. Do not
  re-add it — a glob over import strings cannot express "resolves into a sibling
  app".
- **Go:** `routes_test.go` (every leaf command declares its routes),
  `guide_test.go` (no hardcoded dynamic values, no cross-app references),
  `skill_test.go`, `groups_test.go`, `boundaries_test.go`.
- **Database:** per-app Postgres roles make the data boundary a hard one.

## 8. Deployment

- One Vercel project per app, one subdomain each
  (`issues.blackcode.ch`, `sales.blackcode.ch`, …).
- Filtered builds via `turbo-ignore` so a sales commit doesn't rebuild issues.
- Independent deploys, independent blast radius, independent env vars.
- Vercel Blob and the upload pipeline are shared through `platform.uploads`, with
  cross-app reference counting (§5.1).

> **One login across all apps: THE CODE IS IN, THE DEPLOY IS NOT.** The session
> cookie is scoped to `.blackcode.ch` — signing in to issues signs you in to
> sales too. Authentication is shared; TENANCY is not (§4.5), so being signed in
> to sales does not put you in a sales workspace, and that app tells you so in
> its own words. Without the shared cookie, moving between apps means logging in
> N times, which is the fastest way to make a suite feel like N products.
>
> `packages/platform-auth/src/session-cookie.ts` since 2026-08-06 (D-16). It is
> shared code, not each app's, for the reason D-27 item 3 gives: it is ONE
> credential, and two apps disagreeing about its name or domain produce a session
> that works in one place and silently does not in the other.
>
> **It signs everyone out once**, which is why it ships as its own release, at a
> quiet hour, with the changelog entry published first.
>
> **A correction worth keeping, because it was wrong here for months.** This
> paragraph used to say the rename was forced by the `__Host-` prefix. It is not:
> in next-auth 4.x, `__Host-` is on the CSRF cookie — which must stay per-host —
> while the session cookie is `__Secure-`, and `__Secure-` permits a `Domain`.
> The rename is forced by something else and stronger: a browser keys a cookie on
> **(name, domain, path)**, so re-issuing the same name with a domain creates a
> SECOND cookie beside the host-only one rather than replacing it. Both get sent,
> the order is unspecified, and the app reads one while refreshing the other. The
> conclusion was right and the reason was not, which is the more dangerous half —
> a right conclusion held for a wrong reason stops being right when the reason
> changes.

A monorepo does not imply a shared deployment. Operationally these stay separate
products.

## 9. Known costs — accepted knowingly

- **Expand/migrate/contract discipline** on every platform-schema change. This is
  the main ongoing tax.
- **Shared Neon connection budget.** One pooled connection string per app; watch
  the ceiling as apps are added.
- **A `platform-ui` change touches every app at once.** Fine internally; would
  need package versioning if we ever sell.
- **Cross-app reference counting** for blob GC is more complex than a single-app
  scan, and it **fails closed** — a misconfigured app can stop deletion
  platform-wide. That is the correct direction to fail, but it has to be
  understood before you register an app.

## 10. On selling one of these later

> **Rehearsed 2026-08-05.** It works, and takes ~20 minutes — but the obvious
> command is the wrong one and fails silently. See the callout in §4.3.

Monorepo + shared database does **not** block it. The hard prerequisite for
selling is multi-tenancy, and that is already solved — `workspace_id` is on
everything.

- **Sell the suite as one product:** the monorepo is strictly better.
- **Extract one app:** per-schema isolation plus its own Vercel project makes
  this "split the repo, dump `platform` + the app's schema + `drizzle`, vendor
  the `platform-*` packages" — weeks, not a rewrite.

**An extraction owes more than the database**, and this repo deliberately does
not answer the last of these: blob storage (pre-prefix files sit unprefixed at
the store root), vendoring `packages/platform-*`, and `platform.users` containing
every user of every app. The data-protection question there belongs to whoever
does it.

Full separation would not make that extraction meaningfully cheaper. It would
just charge a certain, daily, N× duplication tax to hedge an uncertain, one-time
event.
