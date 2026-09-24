# The platform migration — August 2026

**This is history. It explains why the repo looks the way it does.** It is not a
guide and not a spec: to *add* an app read [`adding-an-app.md`](adding-an-app.md),
for the current design rules read
[`platform-architecture.md`](platform-architecture.md).

Nine phases (0–8), shipped between 2026-08-03 and 2026-08-05. Production was live
throughout, on real data, with real users.

**Do not rewrite this document.** If something here becomes misleading, append a
dated note.

---

## Before

One Next.js app in one repo called `bc-issues`.

- Everything in the **`public`** Postgres schema — ~26 tables with no
  platform/app distinction. `users` sat beside `issues`; nothing said which was
  which.
- One Postgres role, which owned everything and could do anything.
- The CLI was `bk issue create`, `bk task list` — nouns at the top level, because
  there was only one app for them to belong to.
- Files went to one Blob store at the store root, attributed to nobody.
- One changelog file. One set of docs. `lib/` mixed the issue tracker with the
  generic plumbing underneath it.

Nothing was *wrong* with it. It was a single-app codebase that had quietly become
a platform: **of those 26 tables, only about a third were an issue tracker.**

## After

A monorepo where **adding an app is a checklist and removing one is a rehearsed
procedure**.

- **Two apps.** `apps/issues` (the product) and `apps/_scaffold` (the scaffold —
  real, minimal, and it builds, lints and passes every guardrail).
- **Seven shared packages**, `packages/platform-{db,api,ui,auth,agent,storage,testing}`.
  Apps import these; **apps never import each other.**
- **`platform.*` + `issues.*`, never `public`.** One database, per-app schemas,
  and a **bounded Postgres role per app**. Production runs as `issues_app`, which
  owns zero objects. The app boundary is a **grant**, not a convention.
- **Apps are real data.** `platform.apps`, `workspace_apps`, `app_access`.
  Identity is global; access is per app, per workspace, per user. Visibility
  follows access.
- **Everything is addressable.** `bc:<app>:<workspace>/<type>/<number>`, projected
  into `platform.entities` in the same transaction as its source row.
  `platform.links` relates any two URNs; `platform.events` is one cross-app
  activity stream.
- **Storage is shared and app-attributed**, with **cross-deployment reference
  counting that fails closed** — a trigger-maintained index, so no write path can
  forget it.
- **One CLI, namespaced per app.** `bk issues issue create`. Platform verbs stay
  bare. Per-app parity guards prove every route is reachable from `bk`.

## Why this shape

The decision was **a monorepo of apps on a shared platform**, and the thing it
was chosen *against* matters more than the thing it was chosen for.

**Full separation was rejected** — separate repo, database and CLI per app. It
rebuilds roughly 65% of the codebase N times, and it makes cross-app agent work
impossible without distributed joins performed by an LLM. The daily cost is
certain; the event it hedges against (selling one app) is not. Extraction is
cheap enough under the shared design — rehearsed at ~20 minutes — that paying an
N× duplication tax every day to protect it was the wrong trade.

Three consequences worth naming, because each was a real fork:

- **One workspace record, shared.** A workspace is the *company*; an app is a
  capability inside it. Per-app workspaces would have made the same company exist
  three times under three slugs that drift apart, and cross-app URNs would link
  nothing meaningful.
- **Schemas are the app axis; Neon branches are the environment axis.** Giving
  each app a branch would give each app a private copy of the data no other app
  can see — the exact opposite of the goal.
- **The agent surface collapsed to one interface.** Seven hand-maintained
  surfaces became three entry points (`bk guide`, `bk meta`, `bk changelog`), and
  the OpenAPI spec and page manifest were deleted. With a *single* app they had
  already drifted — the manifest claimed uploads accept any file type when SVG is
  rejected. Multiplying hand-maintained copies by the number of apps would have
  made drift certain rather than likely.

## What it cost

**Nine phases. One production outage. Eight guardrails found green-but-inert.
Four corrections to the plan's own instructions.**

### The outage

Phase 7 shipped an upload-path change that **rejected every installed binary**.
`/api/status` was green throughout — the server was healthy; the contract was
broken. It was found by running the real published binary against the staged
build, not by any monitor.

### The eight inert guardrails

Each of these reported success while checking nothing. **Not one was noticed by
reading it. Every one was found by trying to break it.**

| # | The check | How it was inert |
|---|---|---|
| 1 | ESLint on three packages | No config file at all. `npm run lint` had been failing unnoticed, and `platform-storage` — the one package that can reach `del()` — had **no boundary rule enforced** |
| 2 | `blob_refs_purge`'s authorisation guard | Compared `current_user`, which inside a `SECURITY DEFINER` function is the **function's owner, not the caller**. True for everybody |
| 3 | `blob-drift-check.sql`'s orphan detection | Structurally impossible — an orphan is byte-identical before and after a re-fire, so a diff can never surface one |
| 4 | The `apps/<a>` → `apps/<b>` import rule | Three globs matching **none** of the imports that actually escape an app: the climb has no fixed depth and `apps` never appears in the specifier |
| 5 | `bk __routes` | Deduped on `method+path`, so two apps sharing a path collapsed and the second appeared to have **no commands**. Had also been silently dropping one claim on `GET /api/users` for months |
| 6 | `app-boundary-probe.sql` check (2) | **Commented out** — no second schema existed when it was written. Its first live version then picked `neon_auth.invitation`, a correct refusal of the wrong thing, which reads identically to a pass |
| 7 | `pg_dump --schema=issues` as an extraction | Emits triggers and FKs that all fail at restore; `psql` prints 27 errors and **exits 0**. The database boots, serves, and has silently lost referential integrity and all blob-index maintenance |
| 8 | `TestRemovedSpellingsStillCarryAHint` | Asserted a **hand-written** cobra error string. The real one contains the whole remaining argv, so the three most-used spellings fell through to the generic hint |

**#8 was written by the same session that wrote the rule about inert checks, an
hour after writing it.** That is the point. The rule is not "other people's checks
rot" — it is that **you cannot tell by looking, including at your own.**

### The four places the plan was wrong

The plan was written before the work. Four instructions did not survive contact:

1. **"`blob_references` is exactly the `platform.entities` pattern — same risk,
   same mitigation."** The risk is *not* the same. Entities drift costs a stale
   search result; blob-reference drift in the *missing* direction costs a file
   still in use, deleted, with no undo. Symmetric-looking projections, wildly
   asymmetric failure. Hence Postgres triggers rather than application writes.
2. **Reshape `workspace_counters` so apps can share it.** Sharing a counter buys
   nothing — no query spans two apps' counters — and costs a shared write point
   and a shared migration per entity type. Migration 0040 **moved** it to
   `issues.workspace_counters` instead.
3. **Per-schema isolation "keeps `pg_dump --schema=sales` a working extraction
   path from day one."** It does not — see #7 above.
4. **The extraction bullet named the wrong command.** Corrected to `platform` +
   the app's schema + `drizzle`.

A fifth, from Phase 6: deploy-first ordering means `postbuild` owns the
migration, so `RUN_MIGRATIONS` must be removed first.

## The operational rules it bought

These are the durable output. Each cost something to learn.

### 1. A health check proves the server is up; only the client your users run proves the contract holds

`/api/status` was green throughout the Phase 7 outage, and again when `/api/undo`
was handing installed binaries 2KB of HTML. **Step 4b of the cutover — run the
real published binary against the staged build, before promoting —** found both.
It is not optional and it is not replaceable by a monitor.

### 2. The cutover pattern

Rehearse on a Neon branch, **including the rollback**. Every phase did, and it
caught a real bug in most of them — including a query that would have failed at
runtime the first time it ran.

### 3. Who owns the migration depends on the ordering

`postbuild` applies migrations, gated on `RUN_MIGRATIONS`, using
`MIGRATE_DATABASE_URL` (the schema owner) — never `DATABASE_URL`, which is the
app role and cannot migrate by design.

So **deploy-first ordering means the deploy owns the migration**, and a migration
that must land *before* the deploy has to be applied by hand first, with
`RUN_MIGRATIONS` removed so the deploy does not re-run it. Getting this backwards
is how a deploy half-applies a schema change.

Migration 0037 was deliberately applied to production **before** the deploy that
shipped the route reading it, to buy a soak period where the triggers were
exercised by real writes while nothing yet depended on the index.

### 4. The three-step CLI release: deploy web → publish npm → deploy web AGAIN

> **Retired 2026-09-24.** The advertised versions are read live from npm
> dist-tags now (`packages/platform-agent/src/cli-version.ts`), so there is no
> second deploy and the floor cannot be raised ahead of the publish. Current
> procedure: `docs/devops.md`. Kept below as the reason it once existed.

The release script bumps `CLI_LATEST_VERSION` **in a commit it creates itself**,
so that commit necessarily lands *after* whatever deploy preceded it. Without the
second deploy, production keeps advertising the old version and **no installed
client is ever told an update exists** — which stalls the adoption signal the
next `CLI_MIN_VERSION` raise depends on.

**Publish to npm before raising the floor.** Raise it first and every user is
locked out with nothing to upgrade to.

### 5. The new server must be backwards compatible with old clients still installed

A client cannot be asked to know a convention that shipped after it did. This is
why trash refs changed *field name* (`id` → `number`) rather than *meaning*:
redefining `id` would have made every installed binary act on a different row —
and on `purge`, destroy it.

### 6. Removing a route is not finished when the route is gone

It is finished when the old client that still calls it gets an actionable answer.
**A 410 with a `suggestion` is recoverable inside the same run; a 404 is a dead
end.** That is why `/api/undo`, `/api/openapi.json` and `/api/docs` still exist as
410 stubs, and why they have no expiry.

### 7. Two corollaries about checks, different mechanisms

- **A skipped or commented-out check reports success.** If a check cannot run
  yet, make it skip **loudly** — `RAISE NOTICE`, `t.Logf`, a failing assertion on
  its own inputs.
- **Assert your inputs.** Every "did we find anything to check?" assertion in this
  repo exists because a guard that found nothing would otherwise pass. #5 was
  caught by exactly such an assertion.

## What is still owed

Nothing is broken. These are known, written down, and deliberately not done.

| Owed | Why it was left | Who should close it |
|---|---|---|
| ~~**`adding-an-app.md` steps 7–10 are UNVERIFIED**~~ → **steps 8 and 9 only** | ~~All four need a Vercel project, subdomain and DNS~~ | **HALF PAID 2026-08-07** by `apps/sales`: step 7 (the changelog file) and step 10 (the app's own docs) are closed and initialled. **Steps 8 and 9 — the Vercel project and the subdomain/cookie domain — remain open**, and the box now names the OBSERVATION that closes each rather than the intent. Whoever runs the sales deploy signs it |
| **`CLI_MIN_VERSION` is still `1.9.1`** | Raising it strands every user with nothing to upgrade to. It must follow adoption, not lead it | Target `1.10.0`, a few days after `1.12.0`, **as its own change with nothing else in it** |
| ~~**The session cookie is still per-host**~~ | ~~Moving it to `.blackcode.ch` signs everyone out once~~ | **CODE LANDED 2026-08-06** (D-16, `packages/platform-auth/src/session-cookie.ts`), **NOT YET DEPLOYED** — it is its own release, at a quiet hour, changelog first. Note the stated reason was wrong and the conclusion was right: `__Host-` is on the CSRF cookie, not the session cookie; the rename is forced by a browser jar keying cookies on (name, domain), so a widened re-issue creates a second cookie instead of replacing the first |
| ~~**`comments.parent_type` is not app-qualified**~~ | ~~Values are still `issue` / `task`, not `issues:issue`. Costs nothing with one app~~ | **PAID 2026-08-06** (migrations 0041/0042). Both `comments.parent_type` and `deletion_batches.root_type` are now `<app>:<noun>`. The **contract** step — dropping the bare legacy values — is still owed; see `docs/next-fixes.md` |
| ~~**`labels.app` does not exist**~~ | ~~Every label is shared across every app in the workspace, which is the right default and is currently the only behaviour~~ | **PAID 2026-08-06** (migration 0043). Existing labels were backfilled to `issues`, so a second app's picker starts empty; every read on an app's deployment is filtered to `app IS NULL OR app = <that app>` |
| **The scaffold has no app-owned verb tier** | `bk <app> upload \| trash \| label` needs `appverbs.New(...)` AND the routes behind it, and trash/label are app-specific routes over app-specific entities rather than factories. The pairing is guarded from both sides, so it cannot be got half-right — but an app that mounts NEITHER has no app-owned verbs and nothing complains | Whoever adds app #3, or whoever generalises trash/label into factories. Noted 2026-08-07 in `adding-an-app.md` → *What will still trip up app #3* |
| **`platform.events.actor_token_id` is NULL everywhere** | `AppContext.resolveUser` returns WHO, not BY WHAT MEANS, so no app can record which token a request arrived on. True in **both** apps and since the column was created | It is a shared-interface change: `resolveUser` returning a credential. Sales works around it by matching `token_prefix` among the caller's own tokens |
| **Purging an issue/task/project orphans its `platform.comments` rows** | The FK that cascaded them was dropped in migration 0032. Worse than row growth: the blob index is trigger-maintained on comments, so a file referenced only by an orphaned comment becomes **permanently undeletable** | Needs a design call — cascade on purge, or a reconciler and a decision about what it does with the freed references. Fails closed, which is why nobody will notice |
| **Seven platform routes still have no factory** | `bk inbox`, `bk storage`, `bk workspace edit \| delete \| transfer`, `bk member leave`, `bk invite accept \| decline` — their queries are still app-local to `apps/issues` | Whoever needs a second host to answer one of them. Today a single host is correct rather than temporary (D-36) |
| **`platform.transaction_log` still exists, empty** | Dropping a table is destructive and was not needed. `bk undo` and its routes are gone | Drop it whenever convenient. Do **not** wire a new writer — build undo on `platform.events` if it is ever wanted |
| **`/api/undo` and `/api/openapi.json` 410 stubs** | Installed binaries still call them | Delete when `CLI_MIN_VERSION` passes `1.12.0` |
| **The npm package is still `@blackcode_sa/bc-issues`** | It ships one binary, `bk`, for the whole platform, and the name says "issues". But renaming touches the install path every agent depends on | **Deliberately deferred.** A confusing package name costs nothing operationally; a broken install path costs every agent at once. Sequence below |
| **Extraction owes more than the database** | Blob storage (pre-Phase-7 files sit unprefixed at the store root), vendoring `packages/platform-*`, and `platform.users` containing every user of every app | Whoever does a real extraction. The data-protection question is theirs, and this repo deliberately does not answer it |
| ~~**`apiHandler` / `resolveWorkspace` are duplicated in the scaffold**~~ | ~~Both close over the app's `db`, schema and slug; genericising them for a scaffold is speculative~~ | **PAID 2026-08-06.** The trigger fired: `apps/sales` is the second real app. Both now live in `packages/platform-api` behind an `AppContext`, with the platform route factories beside them. See `docs/sales-app-plan.md` Phase 1a/1b (D-2) |

### If the npm package is ever renamed

**Full runbook: [`npm-package-rename.md`](npm-package-rename.md)** — the name to
pick, the ordered sequence, every file carrying the install string, the
verification, and the conditions under which to abandon it.

The short version: publish under the new name, **never unpublish the old one**,
`npm deprecate` the old pointing at the new, and update every install string in
the same release. Good candidate to bundle with the `CLI_MIN_VERSION` raise,
when a CLI release is happening anyway.

---

## The one thing to take from this

> **A check is inert until you have watched it fail.**

The migration's most valuable output was not the architecture. It was the eight
moments where something that looked like protection turned out not to be. Assume
the next one exists, and go looking for it the same way — by breaking the thing
the check is supposed to catch.

**It kept being true after the migration closed.** The wrap-up verification on
2026-08-06 found two more: the dynamic-value guard in `guide_test.go` was a
substring match over six hand-written strings and passed a topic containing two
entire vocabularies and a stale size limit; and guardrail #4 above — the dead
ESLint rule — was *still there*, still passing the real escape shape at exit 0,
four days after being identified, sitting next to its working replacement. See
[`migration/health-check.md`](migration/health-check.md).

### Read these three files before touching anything near them

Each exists because something went wrong once, and each header explains what:

- `packages/platform-storage/src/references.ts` — the delete gate. The only thing
  between a code change and unrecoverable data loss.
- `packages/platform-db/src/schema.ts` at `blobReferences` — why the index is
  trigger-maintained, and why that is not an implementation detail.
- `apps/issues/lib/db/queries/entities.ts` — why the projection is written in the
  source transaction.
