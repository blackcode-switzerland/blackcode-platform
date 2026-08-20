# Environment Variables Guide

All production env vars live in Vercel. This guide covers where each one comes from, how to set or update it, and what breaks if it's missing.

**Each Vercel project has its own set, and most of these values are per-project.
Two are not.** Get the distinction wrong on a new app and the failure is silent:

| Scope | Vars | What a mismatch does |
|---|---|---|
| **Platform-wide — the same value in every project** | `NEXTAUTH_SECRET` (D-39), `AUTH_COOKIE_DOMAIN` | One sign-in stops covering every app, with no error anywhere |
| **Shared resource, same value, different reason** | `DATABASE_URL` and `MIGRATE_DATABASE_URL` point at the **same Neon project** (different roles per app); `BLOB_READ_WRITE_TOKEN` at the **same Blob store** | A second database or store breaks every cross-app feature |
| **Per project** | `NEXTAUTH_URL`, `SUPER_ADMINS`, `GOOGLE_CLIENT_ID`/`SECRET`, `RESEND_*`, `RUN_MIGRATIONS` | Nothing shared; set them per app |

## What is actually set, per project — audited 2026-08-10

Every `Status: Set ✓` further down was written when `bc-issues` was the only
project, and means "set on issues". This table is the THREE-app truth
(`bc-books` added 2026-08-20). Re-audit it with `vercel env ls` rather than
trusting it; it is a snapshot, not a mechanism.

| Variable | `bc-issues` | `bc-sales` | `bc-books` | Note |
|---|---|---|---|---|
| `DATABASE_URL` | ✅ prod + preview | ✅ prod | ✅ prod | different Postgres ROLE per app, same Neon project — books runs as `books_app` |
| `MIGRATE_DATABASE_URL` | ✅ prod | ✅ prod | ✅ prod | `neondb_owner`, same value |
| `NEXTAUTH_URL` | ✅ prod | ✅ prod | ✅ prod | per app. **Was wrong on issues until 2026-08-10** |
| `NEXTAUTH_SECRET` | ✅ prod + preview | ✅ prod | ✅ prod | **same value on all three** — it is what makes one sign-in work across them |
| `AUTH_COOKIE_DOMAIN` | ✅ prod only | ✅ prod only | ✅ prod only | `.blackcode.ch`. Never on preview |
| `BLOB_READ_WRITE_TOKEN` | ✅ prod + preview | ✅ prod + preview | ✅ prod | **prod → real store, preview → preview store**. b/books serves no upload route, but the shared delete gate still reads the store |
| `RUN_MIGRATIONS` | ✅ prod only | ✅ prod only | ✅ prod only | on preview it writes to the production database |
| `SUPER_ADMINS` | ✅ | ✅ | ✅ | issues has two addresses, sales and books one each — deliberate, per app |
| `GOOGLE_CLIENT_ID` / `_SECRET` | ✅ | ✅ | ✅ | **the same client and secret on all three**, project `blackcode-platform` since 2026-08-10 |
| ~~`PLATFORM_ENFORCE_APP_ACCESS`~~ | — | — | — | **removed 2026-08-10** — nothing reads it; delete it from every project |
| `RESEND_API_KEY` / `_FROM_EMAIL` | ✅ | ✅ **required** | ✅ **required** | **2026-08-11: every app sends its own email.** `packages/platform-email` takes a four-field identity and the app's own db handle, so password reset, forgot-password and invitation mail work without sending anyone to another app. Sender is `admin@blackcode.ch` on the apex domain since 2026-08-10; the app identity is the display name |

**b/books adds NO variable of its own.** That is worth stating rather than
leaving to inference: the third app was provisioned entirely from the list above,
which is the check that `docs/adding-an-app.md` step 9 actually describes a
repeatable process rather than issues' history.

**Removed 2026-08-10:** 17 `NEON_*` variables that were injected by the Neon
integration and read by no code in this repo — they duplicated live database
credentials. Verified gone. If they reappear, the integration re-added them and
that is still not a signal they are needed. The paragraph below is kept because
the reasoning applies to any integration-injected set.

**Was set on `bc-issues` and read by NOTHING:** 17 `NEON_*` variables
(`NEON_PGPASSWORD`, `NEON_DATABASE_URL`, …) injected by the Neon integration,
plus `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` from the Blob integration.
No code in this repo reads any of them — the apps use `DATABASE_URL` and
`BLOB_READ_WRITE_TOKEN`. The `NEON_*` set duplicates live database credentials,
which is the reason to remove them rather than tidiness. Expect the integration
to re-add them; if it does, that is the integration's business and not a signal
they are needed.

**Quick commands:**
```bash
vercel env ls production                          # list all
vercel env add <NAME> production --value "..." --yes   # add
vercel env rm <NAME> production --yes             # remove
# then redeploy:
./devops/release.sh web issues   # the project you changed
```

---

## DATABASE_URL

| | |
|---|---|
| **Purpose** | PostgreSQL connection string — the app's primary database |
| **Status** | Set ✓ |
| **Source** | Neon (via Vercel Storage integration) |
| **Impact if missing** | App crashes on startup — nothing works |

**Where to find it:**
Neon console → project **`blackcode-platform-db`** → Connect → copy the pooled
connection string. (Also reachable via Vercel dashboard → Storage.) Renamed off
`bc-issues` on 2026-08-10 — it is the platform's one database, not the first
app's, and there is exactly one: `platform.*` + a schema per app, never a second
project.

**How to update:**
Only needed if you migrate to a different database. Remove old value, add new:
```bash
vercel env rm DATABASE_URL production --yes
vercel env add DATABASE_URL production --value "<new-url>" --yes
./devops/release.sh web issues   # the project you changed
```

After changing, always run migrations against the new DB:
```bash
DATABASE_URL="<new-url>" npm run db:migrate:issues   # name the app
```

---

## NEXTAUTH_SECRET

| | |
|---|---|
| **Purpose** | Signs and encrypts NextAuth session tokens |
| **Status** | Set ✓ |
| **Source** | Generated with `openssl rand -base64 32` — **once, for the whole platform** |
| **Scope** | **PLATFORM-WIDE (D-39).** Every app's Vercel project holds the *same* value |
| **Impact if missing** | All authentication breaks — no one can log in |

> ### This is not a per-project value. Copy it; never generate a second one.
>
> Since D-16 the session cookie is one credential shared across every deployment
> on `.blackcode.ch`, and it is **encrypted** with this secret. An app holding a
> different one cannot decrypt a cookie the others issued — it sees
> `JWEDecryptionFailed`, treats the caller as signed out, and bounces them to its
> own login page.
>
> The failure is silent in every way that matters: both deploys are green, both
> apps work in isolation, nothing appears in the logs, and the symptom is one
> person saying "it keeps asking me to sign in again". **Provisioning a new app
> is where this gets got wrong**, because generating a secret is what every
> NextAuth guide tells you to do.
>
> ### But you may not be able to copy it. Check before you plan around copying.
>
> This value is typically stored as a **sensitive** variable, and Vercel will not
> reveal one — not in the dashboard, and not to `vercel env pull`, which writes
> the literal string `[SENSITIVE]` in place of the value. Found on 2026-08-10
> while provisioning the second app; the instruction here until then was "copy
> it", with no way to.
>
> ```bash
> vercel env pull .env.check       # from an EXISTING app's project
> grep NEXTAUTH_SECRET .env.check  # a real value, or "[SENSITIVE]"?
> ```
>
> - **A real value** → paste it verbatim into the new project. Done.
> - **`[SENSITIVE]`** → there is nothing to copy. **Rotate instead:** generate ONE
>   new value and set it on EVERY project, then redeploy every project. Follow
>   *How to rotate* below — it is the same procedure, and the requirement it
>   satisfies is unchanged: all apps hold the same value. Whether that value is
>   the old one is irrelevant.
>
> Rotating signs everyone out once, so prefer to do it on a day when a sign-out
> is already happening — the deploy that introduces `AUTH_COOKIE_DOMAIN` signs
> everyone out anyway, and that is the cheapest moment to absorb it.

**How to rotate** (e.g. if compromised — invalidates every active session, in
every app, and signs everyone out once):

```bash
openssl rand -base64 32   # copy the output — ONE new value for all apps
```

Then, **for every app in `devops/release.sh`'s `app_registry()`** — not just the
one you were thinking about:

```bash
vercel env rm  NEXTAUTH_SECRET production --yes   # against that app's project
vercel env add NEXTAUTH_SECRET production --value "<the same new secret>" --yes
```

…and only then redeploy them, one per app:

```bash
./devops/release.sh web issues
./devops/release.sh web sales      # and every other registered app
```

Rotating one app and not the others produces exactly the split-brain above,
except now it is the app you *did* rotate that cannot read anyone's cookie.
`./devops/release.sh apps` is the authoritative list.

**Setting the variable is not the change; the redeploy is.** A build that has
already happened keeps serving the value it was built with, so between the
`env add` and the redeploy the apps genuinely disagree. This bites hardest when
one of the apps is NEW: it goes live on the new secret while every existing app
is still serving the old one, and the split-brain looks identical to having
mistyped the value. Redeploy every app before testing sign-in-once behaviour.

---

## NEXTAUTH_URL

| | |
|---|---|
| **Purpose** | The app's public URL — used by NextAuth for OAuth callbacks and redirects |
| **Status** | Set ✓ — `https://issues.blackcode.ch` |
| **Source** | Your deployment URL |
| **Impact if missing** | OAuth sign-in (Google) breaks; redirect loops |

**How to update when you get a custom domain:**
```bash
vercel env rm NEXTAUTH_URL production --yes
vercel env add NEXTAUTH_URL production --value "https://yourdomain.com" --yes
./devops/release.sh web issues   # the project you changed
```

Also update Google OAuth (see `GOOGLE_CLIENT_ID` section below).

---

## AUTH_COOKIE_DOMAIN

| | |
|---|---|
| **Purpose** | Makes one sign-in cover every app on the platform (D-16). Sets the session cookie's `Domain`, so `issues.blackcode.ch` and `sales.blackcode.ch` share it |
| **Status** | **Production only** — `.blackcode.ch` |
| **Impact if missing** | Nothing breaks. The cookie is host-only, exactly as before; each app needs its own sign-in |
| **Impact if WRONG** | **Nobody can sign in anywhere**, see below |

**Leave it UNSET for local development and for every preview deployment.** A
preview runs on `*.vercel.app`, which is not under `.blackcode.ch`, so a browser
would refuse the cookie outright.

Refusal has no error attached to it: the `Set-Cookie` is dropped, no session is
established, and every sign-in appears to succeed and then bounces back to
`/login` — on every browser, for every user, with a green deploy and nothing in
the logs. That is why `packages/platform-auth/src/session-cookie.ts` validates
the value against `NEXTAUTH_URL` at startup and **throws** if it could not be
set. A boot failure is loud and obviously about this; a rejected cookie is
neither.

```bash
vercel env add AUTH_COOKIE_DOMAIN production --value ".blackcode.ch" --yes
```

**Setting it signs everyone out once.** The cookie is renamed, not widened —
`packages/platform-auth/src/session-cookie.ts` explains why the rename is
unavoidable. Schedule it as its own release, at a quiet hour, with the changelog
entry published first.

---

## SUPER_ADMINS

| | |
|---|---|
| **Purpose** | Comma-separated emails with super admin access at `/dashboard/super-admin` |
| **Status** | Set ✓ — `balathanusan@blackcode.ch,andrea@blackcode.ch` |
| **Source** | Manual — your admin email(s) |
| **Impact if missing** | No super admin UI; whitelist enforcement disabled |

**How to add more admins:**
```bash
vercel env rm SUPER_ADMINS production --yes
vercel env add SUPER_ADMINS production --value "admin1@example.com,admin2@example.com" --yes
./devops/release.sh web issues   # the project you changed
```

---

## GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET

| | |
|---|---|
| **Purpose** | Enables "Continue with Google" OAuth sign-in |
| **Status** | Set ✓ on **both** apps — the SAME client, deliberately |
| **Source** | Google Cloud Console → project **`blackcode-platform`** → APIs & Services → Credentials → OAuth client `blackcode-platform-web` |
| **Impact if missing** | Google sign-in hidden; email/password still works |

### One OAuth client, every app

Moved 2026-08-10 off the old project `Blackcode-issues` (`431515708156`), which
was created for the first app and could not be renamed. `blackcode-platform`
(`740837313186`) is generic, and app #3 adds two lines to the existing client
rather than standing up its own project.

**Both apps hold the same client id and secret.** The apps are distinguished by
their redirect URIs, not by separate clients:

    origins   https://issues.blackcode.ch      https://sales.blackcode.ch
    redirect  https://issues.blackcode.ch/api/auth/callback/google
              https://sales.blackcode.ch/api/auth/callback/google

> **Which project a client belongs to is the number in front of its id**, and
> nothing else — not its name, not the folder you downloaded it into. A client id
> beginning `740837313186-` is on `blackcode-platform`; `431515708156-` is the
> retired project. Check this before wiring a client into anything.

**Consent screen: `Internal`.** Available because `blackcode.ch` is a Google
Workspace org, and it avoids Google's verification review, the publishing step
and the 100-user cap. The cost: only `blackcode.ch` accounts can use *Google*
sign-in. Email/password is unaffected. Letting an outside address sign in with
Google means switching the screen to External and accepting verification.

**Switching clients does not disturb existing users.** `upsertUserFromOAuth`
(`packages/platform-db/src/sign-in.ts`) matches on `users.email` — the
`onConflictDoUpdate` target — not on `google_id`. Everyone lands on their
existing account with their workspaces intact, whatever identifier Google sends.

**How to update, if rotated — every app, or Google sign-in breaks on the ones
you missed:**
```bash
# per project: the repo root is linked to bc-issues; use --cwd for others
vercel env rm  GOOGLE_CLIENT_ID production --yes
vercel env add GOOGLE_CLIENT_ID production --value "<id>" --yes
vercel env rm  GOOGLE_CLIENT_SECRET production --yes
vercel env add GOOGLE_CLIENT_SECRET production --value "<secret>" --yes
./devops/release.sh web issues
./devops/release.sh web sales
```

**Verify what is actually live** — the env listing only proves a value was
stored, not which client the running app sends. Drive the handshake:
```bash
CSRF=$(curl -sS -c /tmp/c "https://issues.blackcode.ch/api/auth/csrf" | jq -r .csrfToken)
curl -sS -b /tmp/c -X POST "https://issues.blackcode.ch/api/auth/signin/google" \
     -d "csrfToken=$CSRF&json=true" | grep -o 'client_id=[^&]*'
```

**Adding an app:** add its two URLs to the existing client. Do not create a
second client, and do not create a project.

**Adding a domain to an app** — no new OAuth client needed, ever:
1. Google Cloud Console → project `blackcode-platform` → Credentials → the
   `blackcode-platform-web` client
2. **Authorised JavaScript origins** → add `https://<new-host>`
3. **Authorised redirect URIs** → add `https://<new-host>/api/auth/callback/google`
4. Save. It is usually live in seconds; Google warns it can take longer
5. Update that app's `NEXTAUTH_URL` and redeploy it

`redirect_uri_mismatch` means step 3 is missing or unsaved — the error names the
exact URI Google expected, so add that string verbatim rather than retyping it.

---

## BLOB_READ_WRITE_TOKEN

| | |
|---|---|
| **Purpose** | Enables file/image uploads via Vercel Blob storage |
| **Status** | Set ✓ — auto-injected via Vercel Storage integration |
| **Source** | Vercel dashboard → Storage → `blackcode-platform-blob` (Blob) |
| **Impact if missing** | All file uploads return 500 error in production |

**Where to find it:**
Vercel dashboard → Storage → `blackcode-platform-blob` → Settings → Tokens → `BLOB_READ_WRITE_TOKEN`.

**How to regenerate** (e.g. if compromised):
1. Vercel dashboard → Storage → `blackcode-platform-blob` → Settings → Tokens → Create new token
2. Update the env var:
```bash
vercel env rm BLOB_READ_WRITE_TOKEN production --yes
vercel env add BLOB_READ_WRITE_TOKEN production --value "<new-token>" --yes
./devops/release.sh web issues   # the project you changed
```

---

## RESEND_API_KEY + RESEND_FROM_EMAIL

| | |
|---|---|
| **Purpose** | Transactional email — workspace invitations and password reset codes |
| **Status** | Required on **both** `bc-issues` and `bc-sales` as of 2026-08-11. It was set on `bc-issues` only while sales had no email module — see the note below, because that absence was documented as deliberate and stopped being true |
| **Source** | [resend.com](https://resend.com) |
| **Impact if missing** | In **production**, the password-reset routes refuse with `503 email_not_configured` rather than accepting the request and delivering nothing (`canDeliverEmail()`); invitations still work and fall back to `accept_url` plus the in-app inbox. Outside production the OTP is printed to the server log instead, so local development needs no key |

### The sending domain is `blackcode.ch`, not a per-app subdomain

Changed 2026-08-10, and the reason is structural rather than cosmetic. Resend's
free plan verifies **one domain per account**. A per-app sender
(`admin@issues.blackcode.ch`) meant the second app that needed email would have
had to either take the slot from issues or force a paid plan. The apex domain
covers every app forever, and the app identity lives in the *display name*
instead — `fromAddress(identity)` in `packages/platform-email` returns
`Blackcode Issues <admin@blackcode.ch>` or `b/sales <admin@blackcode.ch>`
depending on which app asked. Verified end to end on 2026-08-11: both strings
appear in the Resend record for real delivered messages.

    verified in Resend   blackcode.ch          (was issues.blackcode.ch)
    sender               admin@blackcode.ch    (was admin@issues.blackcode.ch)

```bash
vercel env add RESEND_API_KEY production --value "re_..." --yes
vercel env add RESEND_FROM_EMAIL production --value "admin@blackcode.ch" --yes
./devops/release.sh web issues   # the project you changed
```

`RESEND_FROM_EMAIL` must be on a domain verified in Resend —
`onboarding@resend.dev` works for testing only.

### A second app needs to send email — this is DONE (2026-08-11)

This section used to say "do **not** copy `apps/issues/lib/email/` into it —
promote it to `packages/platform-email` first". That promotion happened, so
there is nothing to decide any more:

```ts
// apps/<app>/lib/email/send.ts — the ONLY place identity meets the sender
export const { canDeliverEmail, emailEnabled, sendInvitationEmail, sendPasswordResetEmail } =
  createEmailSender({ app: APP_SLUG, getDb: () => getDb(), identity: {
    name: APP_NAME, appUrl: …, accent: …, contactEmail: … } })
```

Everything else in the app imports from that binding, never from the package —
the same rule `@/lib/storage` follows. The app supplies four fields and **not a
palette or a template set**; `packages/platform-email/src/identity.ts` argues
why, at length, because that is the question the next app will re-ask.

**Setting the two variables is still per project**, and that is the part that
did not become automatic: a new app with no `RESEND_API_KEY` builds, deploys and
serves, and then refuses password resets with `503 email_not_configured` in
production. That refusal is deliberate — the alternative is a reset that reports
success and delivers nothing — but it means provisioning the key is a real step
on the checklist, not a nice-to-have.

---

## MIGRATE_DATABASE_URL

| | |
|---|---|
| **Purpose** | The **migrator's** connection string. `postbuild` runs `drizzle-kit migrate` as this role, not as the app. |
| **Status** | **Required in Production** once `DATABASE_URL` points at an app role. |
| **Source** | Neon → the `neondb_owner` (schema owner) connection string |
| **Impact if missing in Production** | **Every deploy fails at postbuild** with `permission denied for schema drizzle` (42501). |

From Phase 3, `DATABASE_URL` is `issues_app` — a role that owns nothing and has
no rights on the `drizzle` schema, so it **cannot** migrate. That is the whole
point: it is what stops an app reshaping the shared `platform` schema. Verified,
not assumed — `drizzle-kit migrate` as `issues_app` exits 1 because it cannot
read `drizzle.__drizzle_migrations` to learn what has been applied.

So the two credentials are split by job:

| Var | Role | Used for |
|---|---|---|
| `DATABASE_URL` | `issues_app` | everything the app does at runtime |
| `MIGRATE_DATABASE_URL` | `neondb_owner` | `postbuild` migrations only |

Unset locally: `apps/issues/scripts/migrate-if-enabled.mjs` falls back to
`DATABASE_URL`, so local dev — one role doing both jobs — needs no extra config.

---

## RUN_MIGRATIONS

| | |
|---|---|
| **Purpose** | Gates the `postbuild` Drizzle migration. Set → migrations run on build. Unset → they are skipped and the build is pure. |
| **Status** | **Required in Production.** Must not be set locally, in CI, or for preview. |
| **Value** | `1` |
| **Source** | Introduced 2026-08-04 with the monorepo move; implemented in `apps/issues/scripts/migrate-if-enabled.mjs` |
| **Impact if missing in Production** | **Deploys keep succeeding while migrations silently stop.** Schema changes never reach the database and the app fails later, far from the cause. |
| **Impact if set locally** | `npm run build` migrates whatever `DATABASE_URL` points at — the hazard this variable exists to remove. |

Before 2026-08-04 `postbuild` was a bare `drizzle-kit migrate`, which made
`npm run build` a database write and made it exit 1 whenever the local Postgres
was not running. `devops/release.sh` does **not** run migrations, so `postbuild`
remains the only thing applying them in production — hence the flag rather than
deleting the hook.

Recognised falsey values (treated as unset): empty, `0`, `false`, `no`, `off`.

```bash
vercel env add RUN_MIGRATIONS production --value "1" --yes
```

---

## PLATFORM_ENFORCE_APP_ACCESS — REMOVED 2026-08-10

**Delete it from both Vercel projects.** Nothing reads it any more.

It was the Phase 4 kill switch for per-app access: the 403 on a workspace you
held no grant in, and the filtering of workspace listings to the apps you could
reach. multiAppFinalRefactor Phase 5 dropped `platform.workspace_apps` and
`platform.app_access` along with `requireAppAccess` and
`isAppAccessEnforced()`, so the variable now gates nothing in either direction.

Leaving it set is harmless but not neutral: an env var that names a behaviour the
code no longer has is the thing somebody sets in an incident expecting it to do
something. Remove it.

```bash
vercel env rm PLATFORM_ENFORCE_APP_ACCESS production   # both projects
```

**Why it is gone rather than defaulted.** The gate asked "may this member open
THIS app in this workspace?" — a question that needs one workspace shared by
several apps. Each app owns its workspaces now, so a workspace belongs to exactly
one app and its members are that app's users. There is no second thing to
enforce, which is different from enforcing it permissively.

---

## Local development

Copy the following into **`apps/issues/.env.local`** (never commit this file).
Note the path: since the monorepo move it lives in the app workspace, not the
repo root — Next and `drizzle.config.ts` both resolve it relative to
`apps/issues/`.

```env
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=any-random-string-for-local-dev
SUPER_ADMINS=balathanusan@blackcode.ch

# Optional — omit to use local file fallback for uploads
# BLOB_READ_WRITE_TOKEN=

# Optional — omit to disable Google sign-in locally
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Do NOT set RUN_MIGRATIONS here. Leaving it unset is what keeps
# `npm run build` from writing to your database. Migrate explicitly instead:
#   npm run db:migrate:issues   (name the app)
```

Start the local Postgres with `docker compose up -d`, then — **from the repo
root** — `npm run dev`.

### The other apps' local env

Each app reads its OWN `apps/<app>/.env.local`; there is no root one. The other
two need the same three variables and a different port and database:

| App | File | Port | `NEXTAUTH_URL` |
|---|---|---|---|
| issues | `apps/issues/.env.local` | 3000 | `http://localhost:3000` |
| sales | `apps/sales/.env.local` | 3100 | `http://localhost:3100` |
| books | `apps/books/.env.local` | 3200 | `http://localhost:3200` |

Start one at a time with `npm run dev --workspace=<app>`; the root `npm run dev`
is filtered to issues.

`bk` finds a locally running app through its **app registry**, not through the
port: `~/.config/bk/config.json` carries `app_servers`, and `bk meta` rewrites
that map from whatever the home server answers. Pointing `bk books` at a local
build is `bk login --server http://localhost:3200`, or editing that map by hand.
