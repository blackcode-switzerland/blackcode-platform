#!/usr/bin/env node
/**
 * postbuild migration gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `postbuild` used to be a bare `drizzle-kit migrate`. That made `npm run build`
 * write to whatever `DATABASE_URL` happened to resolve to — so the command the
 * migration plan uses as a *verification gate* was in fact a database mutation,
 * and it failed (exit 1) whenever the local Postgres was simply not running.
 * Both were observed on 2026-08-04; see docs/migration/baseline.md §2.
 *
 * So migrations are now opt-in: they run only where `RUN_MIGRATIONS` is set.
 *
 *   Vercel Production  → RUN_MIGRATIONS=1   (migrations run on deploy, as before)
 *   Local / CI / preview → unset            (`npm run build` is a pure build)
 *
 * DO NOT "simplify" this away by deleting the postbuild hook. `devops/release.sh`
 * does not run migrations, so postbuild is the only thing that applies them to
 * production. Removing it stops production migrations silently — which is far
 * worse than the problem this file solves.
 *
 * To run migrations by hand:  npm run db:migrate --workspace=books
 *
 * ── b/books SHIPPED WITHOUT THIS FILE, AND THAT WOULD HAVE BEEN SILENT ─────
 * Added 2026-08-20, while writing the deployment plan. `apps/books` had no
 * `postbuild` hook and no copy of this script, so `RUN_MIGRATIONS=1` on Vercel
 * would have matched nothing: the deploy would have succeeded, served traffic,
 * and applied **zero** of the nineteen migrations — against a database where
 * `books.*` does not exist yet.
 *
 * Nothing in the checklist catches it. It is the same shape as the extraction
 * that "worked" while psql printed 27 errors and exited 0 (finding #7) and the
 * provisioning script whose grants all failed silently (finding #15): the step
 * reports success having done none of its work.
 *
 * The check is the DEPLOY LOG. It must say "applying Drizzle migrations" and
 * "migrations applied". If it says "skipping migrations", `RUN_MIGRATIONS` is
 * not set on that environment and nothing was applied.
 */
/**
 * WHICH CREDENTIAL MIGRATES
 * -------------------------
 * `DATABASE_URL` is the APP's credential. From Phase 3 it is a role that owns
 * nothing and has no rights on the `drizzle` schema, so it cannot migrate — by
 * design. That is what stops an app reshaping the shared platform schema.
 *
 * Migrations therefore run as the MIGRATOR, via `MIGRATE_DATABASE_URL`. Verified
 * rather than assumed: `drizzle-kit migrate` as the app role exits 1 with
 * "permission denied for schema drizzle" (42501), because it cannot read
 * drizzle.__drizzle_migrations to learn what is applied.
 *
 * Falls back to DATABASE_URL when unset, so local dev — where one superuser-ish
 * role does both jobs — needs no extra configuration.
 */
import { spawnSync } from 'node:child_process'

const flag = process.env.RUN_MIGRATIONS
const migrateUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL

// Explicit opt-out values, so `RUN_MIGRATIONS=0` in a dashboard means what it looks like.
const enabled = flag !== undefined && !['', '0', 'false', 'no', 'off'].includes(flag.toLowerCase())

if (!enabled) {
  console.log(
    '• postbuild: skipping migrations (RUN_MIGRATIONS is not set).\n' +
      '  This is expected for local builds, CI and preview deploys.\n' +
      '  Production sets RUN_MIGRATIONS=1. To migrate by hand: npm run db:migrate --workspace=books'
  )
  process.exit(0)
}

if (!migrateUrl) {
  console.error(
    '✗ postbuild: RUN_MIGRATIONS is set but neither MIGRATE_DATABASE_URL nor DATABASE_URL is.'
  )
  process.exit(1)
}

const usingMigrator = Boolean(process.env.MIGRATE_DATABASE_URL)
console.log(
  `• postbuild: RUN_MIGRATIONS=${flag} — applying Drizzle migrations as the ` +
    `${usingMigrator ? 'MIGRATE_DATABASE_URL role (migrator)' : 'DATABASE_URL role (no MIGRATE_DATABASE_URL set)'}…`
)

// drizzle.config.ts reads DATABASE_URL, so hand the migrator's URL to the child
// under that name. The parent process env is untouched.
const result = spawnSync('npx', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, DATABASE_URL: migrateUrl },
})

if (result.error) {
  console.error(`✗ postbuild: could not start drizzle-kit — ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`✗ postbuild: drizzle-kit migrate failed (exit ${result.status}).`)
  process.exit(result.status ?? 1)
}

console.log('✓ postbuild: migrations applied.')
