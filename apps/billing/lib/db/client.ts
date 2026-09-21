// This app's Drizzle client.
//
// The connection wiring is identical for every app and lives in
// `@blackcode/platform-db`; only the SCHEMA differs, which is why `createDb`
// takes it as a parameter. Each app connects as its OWN Postgres role
// (`<slug>_app`), so the same code reaches a different set of tables depending
// on the credential — that is the app boundary, and it is a grant rather than a
// convention. See docs/sql/app-role.sql.
//
// ---------------------------------------------------------------------------
// LAZY, AND THAT IS NOT A STYLE CHOICE
// ---------------------------------------------------------------------------
// `createDb()` throws when `DATABASE_URL` is unset. Calling it at module scope
// means every module that imports this one needs a database AT IMPORT TIME —
// including `next build`, which evaluates route modules to collect page data.
// An app wired that way cannot be built in CI, in a container image step, or by
// anyone who has not yet been given a connection string.
//
// This was not theoretical: the first `npm run build` of this scaffold failed
// with "Failed to collect page data for /api/workspaces/[ws]/notes" for exactly
// that reason. `apps/issues` does it at module scope and gets away with it only
// because a `.env.local` happens to be present.
//
// So: resolved on first use, memoised after. Copy this shape.
import { createDb, type PlatformDatabase } from '@blackcode/platform-db'
import * as schema from './schema'

let cached: PlatformDatabase<typeof schema> | undefined

export function getDb(): PlatformDatabase<typeof schema> {
  return (cached ??= createDb(schema))
}

export { schema }
