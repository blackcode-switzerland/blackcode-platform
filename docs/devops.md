# DevOps Guide

**Shipping is documented in [`deploy/`](../deploy/README.md)**, not here — and
there is no release script (`devops/release.sh` was retired 2026-09-29). This doc
is about *operating* what gets shipped: environment variables, migrations, and the
rules learned the hard way.

| To… | Follow |
|---|---|
| Deploy `issues` / `sales` / `books` / `billing` to production | [`deploy/web.md`](../deploy/web.md) — a per-app Vercel token, no `vercel login`, from the repo root |
| Release the `bk` CLI (GitHub + npm) | [`deploy/cli.md`](../deploy/cli.md) — default minor, unforced |
| Understand why it is shaped this way | [`deploy/README.md`](../deploy/README.md) |

What stays true from the old flow, and lives in those docs now: one release per
invocation (a CLI release never deploys an app; a web deploy targets one app);
deploy from the repo root; `VERCEL_PROJECT_ID` overrides the linked project; and
**a CLI release is one step, publish** — every app reads `latest`/`min` live from
npm dist-tags (`packages/platform-agent/src/cli-version.ts`), so nothing is
redeployed afterwards.

## Three deploy traps

- **`--skip-domain` is partial.** It protects the *custom* domain from being
  re-aliased. It does **not** protect the project's default `.vercel.app` aliases,
  which still move to the new deployment.
- **Do not test reachability with `curl -L`.** Deployment Protection covers preview
  *and* production-target `.vercel.app` aliases. `curl -L` follows the SSO redirect
  and returns **200 for the login page**, indistinguishable from a healthy app.
  Check the *unfollowed* status and treat a 3xx to `vercel.com` as
  protected-not-broken. Verify the real surface on the custom domain.
- **Watch the upload size.** It should be about **66 MB**. Vercel does **not** read
  `.gitignore` — it reads the repo-root `.vercelignore`, shared by every app.
  Before that file existed the first production deploy of 2026-08-10 reported
  **8.5 GB** (`.turbo` is 16 GB on disk, `cli/dist` 1.1 GB) and was cancelled. If
  you ever see gigabytes, stop.

> This is the deploy-side instance of the standing rule: a green reading that
> cannot distinguish success from a login page is not a check.

> `apps/_scaffold` has **no row in `deploy/web.md` on purpose**: the scaffold must
> never be deployed. There is exactly **one** Vercel project per app.

## Prerequisites

| Tool | Install | Auth |
|---|---|---|
| `gh` | `brew install gh` | `gh auth login` (CLI release) |
| `npm` | bundled with Node.js | `npm login` as a `@blackcode_sa` member (CLI release) |
| `go` | https://go.dev/dl | — (CLI release) |
| `vercel` | **not needed** — `npx vercel` | **no login** — a token is passed per deploy (`deploy/web.md`) |

---

## Environment variables

All production env vars live in Vercel. To add or update one:

```bash
# Add
vercel env add <NAME> production

# Update (remove then re-add)
vercel env rm <NAME> production --yes
vercel env add <NAME> production

# List all
vercel env ls production
```

After changing env vars, redeploy the affected app — [`deploy/web.md`](../deploy/web.md). The `vercel env` commands need no login either: set the same `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` that `web.md` sets.

### Production env vars

**`vercel env ls production` is authoritative** — this table drifts, and did.
[`env.md`](env.md) carries the full reference.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon, **as the `issues_app` role**. Bounded: owns nothing, cannot migrate |
| `MIGRATE_DATABASE_URL` | Neon, as the schema owner. Used by `postbuild` only |
| `RUN_MIGRATIONS` | `1`, **Production only**. Without it `postbuild` skips and migrations silently stop |
| `NEXTAUTH_SECRET` | NextAuth signing secret |
| `NEXTAUTH_URL` | `https://issues.blackcode.ch` |
| `SUPER_ADMINS` | comma-separated emails |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth sign-in — **configured and live** |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Transactional email (invitations, password reset) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob — **configured and live** |
| ~~`PLATFORM_ENFORCE_APP_ACCESS`~~ | **Removed 2026-08-10** — the per-app gate is gone; delete it from every project (`docs/env.md`) |

The table above is written from `bc-issues`. The other two projects carry the
**same variable set** with their own `DATABASE_URL` role (`sales_app`,
`books_app`) and their own `NEXTAUTH_URL`; `NEXTAUTH_SECRET` is deliberately the
same value on all three, because that is what makes one sign-in reach all of
them. `docs/env.md` has the per-project audit.

> **Two credentials, deliberately.** `DATABASE_URL` is the app role and **cannot**
> migrate — that is the point, not a limitation. `MIGRATE_DATABASE_URL` is the
> owner and is used by nothing but `postbuild`. See [`platform-db.md`](platform-db.md).

> The **preview** environment points at its own Neon branch (`preview`) **and its
> own Blob store** (`blackcode-platform-preview-blob`). The separate store is not
> redundancy: `sweepOrphanedUrls` runs on user action, so a preview deployment
> pointed at the production store would delete real production bytes.

---

## Database migrations

**Local dev** — one command brings the dockerised Postgres up (if needed) and
applies any pending migrations:

```bash
./devops/migrate-local.sh            # start DB + apply migrations
./devops/migrate-local.sh --status   # list migrations already applied
```

Production migrates automatically on deploy — but **only because the Vercel
Production environment sets `RUN_MIGRATIONS=1`.**

Since 2026-08-04, `postbuild` runs `apps/issues/scripts/migrate-if-enabled.mjs`
rather than a bare `drizzle-kit migrate`. Without the flag it prints a skip line
and exits 0, so a local or preview `npm run build` is a pure build and never
touches a database. Two things this protects: `npm run build` used to fail with
exit 1 whenever the local Postgres was simply not running, and it would migrate
whatever `DATABASE_URL` happened to be exported.

> **⚠ Production needs BOTH `RUN_MIGRATIONS=1` and `MIGRATE_DATABASE_URL`.**
> `DATABASE_URL` is the app role and cannot migrate by design; `postbuild` uses
> `MIGRATE_DATABASE_URL` (the schema owner). Without it, deploys fail at
> postbuild with 42501. See docs/env.md.
>
> **`RUN_MIGRATIONS=1` must exist in Vercel Production.** A deploy
> (`deploy/web.md`) does not run migrations by itself, so `postbuild` is the only thing that applies them in
> production. If that variable is ever removed, deploys will keep succeeding
> while migrations silently stop. Do not delete the `postbuild` hook either — the
> gate is inside the script, not in whether the hook exists.

The local script is only for keeping your own machine in sync — e.g. after
pulling a branch that adds a migration. To run it manually against production
instead:

```bash
DATABASE_URL="<neon-url>" npm run db:migrate:issues   # name the app
```

The Neon connection string is in Vercel → Storage → bc-issues → Connection Details.

---

## Operational rules

Learned during the platform migration, each at a cost. The reasoning is in
[`2026-08-platform-migration.md`](2026-08-platform-migration.md); this is the
operating instruction.

### Step 4b — verify with the PUBLISHED binary, not with curl

> **A health check proves the server is up. Only the client your users run proves
> the contract still holds.**

Before promoting a deploy, run the **real published `bk`** against the staged
build. Not `curl`, not a local build.

```bash
npm i -g @blackcode_sa/bc-issues@latest
bk meta && bk issues issue list --ws <a real workspace>
```

This is not belt-and-braces. `/api/status` was green throughout a **total outage
of agent uploads** in Phase 7, and green again while `/api/undo` was handing
installed binaries 2KB of HTML instead of JSON. Step 4b found both; nothing else
did.

### The cutover pattern

**Rehearse on a Neon branch first, including the rollback.** Every phase of the
migration did, and it caught a real bug in most of them — including a query that
would have failed at runtime the first time it ran.

`docs/sql/` carries the rollback script for each phase. A migration without a
rehearsed rollback is not ready.

### Who owns the migration depends on the ordering

`postbuild` applies migrations, gated on `RUN_MIGRATIONS`, as
`MIGRATE_DATABASE_URL`. So:

- **Deploy-first ordering → the deploy owns the migration.** Normal case; do
  nothing special.
- **A migration that must land BEFORE the deploy** has to be applied by hand
  first, **with `RUN_MIGRATIONS` removed** so the deploy does not re-run it. Put
  it back afterwards.

Getting this backwards is how a deploy half-applies a schema change. It is also
worth doing deliberately: migration 0037 was applied to production *before* the
deploy that shipped the route reading it, to buy a soak period where the triggers
were exercised by real writes while nothing yet depended on the index.

### Backwards compatibility with installed binaries

**The new server must work with the old clients that are still installed.** A
client cannot be asked to know a convention that shipped after it did.

This is why trash refs changed *field name* (`id` → `number`) rather than
*meaning*: redefining `id` would have made every installed binary act on a
different row — and on `purge`, destroy it.

And why **removing a route is not finished when the route is gone.** It is
finished when the old client that still calls it gets an actionable answer: a
**410 with a `suggestion`** is recoverable inside the same run; a 404 is a dead
end. That is why `/api/undo`, `/api/openapi.json` and `/api/docs` remain as 410
stubs with no expiry.

---

## npm package

- **Package**: `@blackcode_sa/bc-issues`
- **Install**: `npm install -g @blackcode_sa/bc-issues`
- **Binary**: `bk`
- **Registry**: https://www.npmjs.com/package/@blackcode_sa/bc-issues

The npm package is a thin wrapper — on install it downloads the correct pre-built Go binary from the matching GitHub Release for the user's platform.
