# DevOps & Release Guide

All release operations are handled by a single script:

```bash
./devops/release.sh <command>
```

> **One release per invocation.** A CLI release never deploys an app, and a web
> deploy targets exactly one app. The two are shared surfaces with independent
> audiences — the binary serves every app, an app serves only itself — so
> bundling them meant a CLI release quietly shipped whatever happened to be on
> `main` for the web as well. The old `cli` flow ended with a "deploy web too?"
> prompt; it was removed on 2026-08-06.

---

## Commands

### List deployable apps

```bash
./devops/release.sh apps
```

Reads `app_registry()` in `devops/release.sh` — the single place an app's Vercel
project is declared.

### Deploy ONE app to production

```bash
./devops/release.sh web issues
```

The app slug is **required**. Without it the script lists the apps and exits 1;
an unknown slug does the same. Preflight checks Vercel auth, the git branch and
a clean tree, then asks to confirm before deploying.

| App | Production URL | Vercel project | Project id |
|---|---|---|---|
| `issues` | https://issues.blackcode.ch | `bc-issues` | `prj_bueHX5y2f7uaemskB5Q1Plwbry2p` |
| `sales` | https://sales.blackcode.ch | `bc-sales` | `prj_p5A74QYKnig8696ES87bT6rvHMdZ` |

Dashboard: `https://vercel.com/balathanusans-projects-f76f8a7b/<project>`.
`app_registry()` in `devops/release.sh` is the authority; this table is a copy.

Two things the script does deliberately:

- **It deploys from the repo root.** Vercel applies each project's own Root
  Directory. Running from inside `apps/<app>` uploads only that directory and
  `npm install` then 404s on the workspace packages — found the hard way during
  the migration.
- **It sets `VERCEL_PROJECT_ID` explicitly**, overriding whatever
  `.vercel/project.json` is linked. Without that, deploying a second app would
  silently ship to whichever project the working copy was last linked to, and
  you would only find out after it was live.

> `apps/_scaffold` is **absent from the registry on purpose**. The scaffold must
> never be deployed, and leaving it out is what makes that true rather than
> merely documented — `release.sh web _scaffold` exits 1.

> There is exactly **one** Vercel project per app. A stray second project named
> `issues` existed during the migration window and was deleted on 2026-08-06 —
> it never built successfully and never served anything.

### Three deploy traps

- **`--skip-domain` is partial.** It protects the *custom* domain
  (`issues.blackcode.ch`) from being re-aliased. It does **not** protect the
  project's default `.vercel.app` aliases, which still move to the new
  deployment. Reach for it when you want the custom domain to stay put; do not
  read it as "this deploy is invisible".
- **Do not test reachability with `curl -L`.** Deployment Protection covers
  preview *and* production-target `.vercel.app` aliases. `curl -L` follows the
  SSO redirect and returns **200 for the login page**, which is
  indistinguishable from a healthy app. Check the *unfollowed* status
  (`curl -sI`, or `curl -o /dev/null -w '%{http_code}'` without `-L`) and treat
  a 3xx to `vercel.com` as protected-not-broken. Verify the real surface on the
  custom domain.

- **Watch the upload size on the first deploy of a new app.** It should be about
  **66 MB**. Vercel does **not** read `.gitignore` — it reads `.vercelignore`,
  which lives at the repo root and is shared by every app. Before that file
  existed the first production deploy of 2026-08-10 reported an **8.5 GB** upload
  (`.turbo` is 16 GB on disk, `cli/dist` 1.1 GB) and was cancelled. If you ever
  see gigabytes, stop: something is excluded that should not be, or the file is
  not being applied.

> This is the deploy-side instance of the standing rule: a green reading that
> cannot distinguish success from a login page is not a check.

### Adding an app to the release script

Add one line to `app_registry()` near the top of `devops/release.sh`:

```
slug|vercel-project-name|prj_xxxxxxxx|https://slug.blackcode.ch
```

Everything else in the script is app-agnostic. This is a step in
[`adding-an-app.md`](adding-an-app.md).

### Release CLI to GitHub + npm

```bash
./devops/release.sh cli patch    # bug fix:        v1.0.0 → v1.0.1
./devops/release.sh cli minor    # new feature:    v1.0.0 → v1.1.0
./devops/release.sh cli major    # breaking change: v1.0.0 → v2.0.0
./devops/release.sh cli v1.2.3  # explicit version (optional)
```

The version is auto-resolved from the latest git tag — you never need to type a version number manually.

> **Three steps, not one: deploy web → release CLI → deploy web AGAIN.**
> Step 4 below bumps `CLI_LATEST_VERSION` **in a commit the script creates
> itself**, so it necessarily lands *after* whatever deploy preceded it —
> production keeps advertising the previous version, and no installed client is
> ever told an update exists. Since that nudge is the adoption signal a
> `CLI_MIN_VERSION` raise depends on, skipping the second deploy quietly stalls
> the next release. Full reasoning in
> [`../docs/2026-08-platform-migration.md`](2026-08-platform-migration.md) →
> *The operational rules it bought*. Confirm the last step:
>
> ```bash
> curl -sI https://issues.blackcode.ch/api/meta | grep x-bk-cli
> ```

Full CLI release pipeline:
1. Preflight — checks gh auth, npm auth, git branch, clean tree, no duplicate tag/version
2. Resolves the next version from the latest git tag + bump type
3. Bumps version in `cli/npm/package.json` and `cli/npm/install.js`
4. Bumps `CLI_LATEST_VERSION` in `packages/platform-agent/src/cli-version.ts` — located by
   SEARCH, not a hardcoded path (the gate has moved twice: root → `apps/issues/lib`
   in Phase 1, → `packages/platform-agent/src` in Phase 6, and the first move broke
   the release halfway through) — and
   `CLI_MIN_VERSION` too, **only** if you answer `forced` at the upgrade-policy
   prompt. Answer `normal` unless you have deliberately decided to hard-block
   every older client; publishing must always precede a floor raise.
5. Commits + pushes the version bump to `main`
6. Creates and pushes the git tag
7. Builds binaries for all 6 platforms via `make dist`
8. Creates a GitHub Release and uploads the binaries + `SHA256SUMS`
9. Publishes `@blackcode_sa/bc-issues` to npm (prompts for OTP)

**Have your authenticator app ready** — npm requires a 2FA code during publish.

---

## Prerequisites

| Tool | Install | Auth command |
|---|---|---|
| `vercel` | `npm install -g vercel` | `vercel login` |
| `gh` | `brew install gh` | `gh auth login` |
| `npm` | bundled with Node.js | `npm login` |
| `go` | https://go.dev/dl | — |

---

## Typical bug-fix release workflow

```bash
# 1. Fix the bug, commit to main
git add .
git commit -m "fix: ..."
git push origin main

# 2. Deploy the web fix immediately — name the app
./devops/release.sh web issues

# 3. If the CLI was also changed, cut a new CLI release
./devops/release.sh cli patch

# 4. Deploy web AGAIN to make the new version gate live —
#    EVERY app, not just the one you fixed. See below.
./devops/release.sh web issues
./devops/release.sh web sales
```

> **Step 4 is every app in `app_registry()`.** Each deployment answers "what CLI
> version is current?" from the same shared constant, and `bk` asks whichever app
> the user is *homed* on. Deploy only one and everyone homed on the other is
> never told an update exists — and on a forced release, one host locks them out
> while the other does not. `release.sh` prints the per-app list at the end of a
> CLI release; run all of it. Verified 2026-08-10: both apps returned
> `x-bk-cli-latest: 2.1.0` only after the second pair of deploys.
>
> Step 4 is also not optional busywork. The CLI release bumps the version in a
> commit **it creates itself**, which lands after step 2's deploy — so without
> step 4 production keeps advertising the old version.

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

After changing env vars, redeploy the affected app: `./devops/release.sh web issues`

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
| ~~`PLATFORM_ENFORCE_APP_ACCESS`~~ | **Removed 2026-08-10** — the per-app gate is gone; delete it from both projects (`docs/env.md`) |

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
> **`RUN_MIGRATIONS=1` must exist in Vercel Production.** `devops/release.sh`
> does not run migrations, so `postbuild` is the only thing that applies them in
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
