# Environment variables

Copy the relevant values into **`apps/issues/.env.local`** for local development,
or set them in the Vercel dashboard for production. Only three are required; the
rest unlock optional integrations and the app runs fine without them.

> The file lives in the app workspace, not the repo root — Next and
> `drizzle.config.ts` resolve it relative to `apps/issues/`.
>
> **Never set `RUN_MIGRATIONS` locally.** It gates the `postbuild` migration and
> belongs only in Vercel Production; see `docs/env.md`.

## Required

```env
# Postgres connection string. The bundled docker-compose serves this on :5434.
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
```

## Optional integrations

```env
# Google OAuth — enables the "Continue with Google" button. If unset, only
# email/password sign-in is available. (Both vars must be set to enable it.)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Super admin — comma-separated emails granted super admin access at
# /dashboard/super-admin. When set, the whitelist feature activates: only
# whitelisted emails/domains + these super admins can register or sign in
# via Google OAuth. If unset, no whitelist enforcement and no super admin UI.
SUPER_ADMINS=admin@yourdomain.com

# Resend — transactional email (workspace invitations + password-reset codes).
# If unset, the app still works: invitations fall back to the in-app inbox +
# copyable accept links, and password reset is unavailable until configured.
# Both vars must be set; RESEND_FROM_EMAIL must be on a domain verified in Resend.
# The verified domain is the APEX `blackcode.ch`, shared by every app — the free
# plan verifies one domain per account, so a per-app subdomain would mean the
# second app that needs email takes the slot from the first. App identity lives
# in the display name, not the address.
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=admin@blackcode.ch

# Vercel Blob — file/image uploads in production. If unset, uploads are written
# to the local `public/uploads/` directory (fine for dev).
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

## Production (Vercel)

```env
NEXTAUTH_URL=https://issues.blackcode.ch
NEXTAUTH_SECRET=your-production-secret

# One sign-in across every app (D-16). PRODUCTION ONLY — leave it unset locally
# and on previews, which run on *.vercel.app and would have the cookie refused
# by the browser with no error anywhere. See docs/env.md.
AUTH_COOKIE_DOMAIN=.blackcode.ch

# TWO database credentials, and the split is deliberate.
# DATABASE_URL is the bounded per-app role (issues_app): it owns nothing and
# CANNOT migrate. That is the app boundary, not a limitation.
DATABASE_URL=postgres://issues_app:…@…/…

# MIGRATE_DATABASE_URL is the schema owner, used by `postbuild` and nothing else.
# WITHOUT IT, PRODUCTION DEPLOYS FAIL AT POSTBUILD WITH 42501 — the app role is
# refused, correctly. See docs/platform-db.md.
MIGRATE_DATABASE_URL=postgres://neondb_owner:…@…/…

# Gates the postbuild migration. Production ONLY — never locally, never preview.
# If this is ever removed, deploys keep succeeding while migrations silently stop.
RUN_MIGRATIONS=1

# plus any optional integrations above

# PLATFORM_ENFORCE_APP_ACCESS is GONE as of 2026-08-10. It gated per-app access;
# `platform.workspace_apps` and `platform.app_access` are dropped and membership
# is the whole gate now. If it is still set in a Vercel project, remove it — see
# docs/env.md.
```

After setting `DATABASE_URL`, run the migrations against that database:

```bash
npm run db:migrate
```

## Generate `NEXTAUTH_SECRET`

```bash
openssl rand -base64 32
```
