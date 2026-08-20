import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })
config({ path: '.env' })

// Generation and migration both run as a HUMAN with the migrator credential,
// never as the app. `books_app` owns nothing and cannot create a table — see
// docs/platform-db.md for the two credentials. Locally they are the same
// superuser, which is exactly why the boundary probe has to be run by hand
// against the real role (docs/sql/app-boundary-probe.sql).
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set (load .env.local)')

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,

  // ═════════════════════════════════════════════════════════════════════════
  // A SEPARATE LEDGER PER APP (D-34). NOT A PREFERENCE — THE DEFAULT IS BROKEN
  // HERE, AND IT BREAKS BY DOING NOTHING.
  // ═════════════════════════════════════════════════════════════════════════
  // Every app on this platform shares ONE database: one Neon project, one Blob
  // store, per-app schemas. Drizzle's default ledger is
  // `drizzle.__drizzle_migrations`, and its migrator does this:
  //
  //     select … from <ledger> order by created_at desc limit 1
  //     for (const m of migrations)
  //       if (!last || Number(last.created_at) < m.folderMillis) apply(m)
  //
  // — a single high-water mark over the WHOLE table, with no notion of which app
  // wrote a row. Two apps sharing it means whichever migrated last raises the
  // mark for both, and the other app's next migration is **silently skipped**:
  // no error, no row inserted, and the same comparison skips it again on every
  // later run. The tables simply never appear, and the first symptom is a
  // runtime error about a relation that does not exist.
  //
  // Sales hit this on its first migration — issues' `0043` is stamped later than
  // anything a new app can generate — so it is not hypothetical. One ledger per
  // app, no coordination, no shared watermark.
  //
  // `packages/platform-testing` checks this across every app: a new app that
  // omits the block, or copies another app's table name, fails there rather than
  // in production. **Change `_scaffold` to your slug when you copy this.**
  migrations: {
    table: '__drizzle_migrations_books',
    schema: 'drizzle',
  },
})
