// The app ADDRESS BOOK — `platform.apps`.
//
// One row per app in the suite: its slug, its human name, and where it is
// deployed. That is the whole of it, and the whole of what any deployment can
// honestly say about an app other than itself.
//
// ---------------------------------------------------------------------------
// THIS REPLACED A GRANT-DERIVED REGISTRY ON 2026-08-10 (refactor Phase 5)
// ---------------------------------------------------------------------------
// Until then, `/api/meta`'s `apps` block came from `appsReachableByUser`, which
// joined `platform.app_access` to `platform.workspace_apps` and answered "which
// apps may this person open, and in which workspaces?". Both tables are dropped,
// and neither the query nor the question survives:
//
//   - The question has no subject. Apps stopped sharing workspaces in Phase 2,
//     so "may this person open sales in workspace 7" names a workspace id that
//     belongs to whichever app is asking, not to sales.
//   - The answer is unobtainable. Reachability lives in each app's own
//     membership table (`platform.workspace_members` for issues,
//     `sales.workspace_members` for sales), and an app's Postgres role has no
//     grant on another app's schema (docs/platform-architecture.md §4.3). This
//     is the same wall as CLAUDE.md finding #14: a reconciler that could only
//     ever see one deployment's data.
//
// The old shape was not just about to become wrong; it was already wrong. A
// brand-new `apps/issues` signup got an `app_access` grant for every enabled app
// (the default-on policy), so `/api/meta` reported `apps.sales.workspaces` as
// their PLATFORM workspace slug — a workspace `apps/sales` answers 404 for, and
// which sales' own `/api/meta` correctly reported as `workspaces: []`.
//
// ---------------------------------------------------------------------------
// WHAT THIS COSTS, STATED PLAINLY
// ---------------------------------------------------------------------------
// docs/platform-architecture.md §4.5 said an agent must not be able to discover
// an app its user cannot reach. That rule is retired, not quietly bent. It was
// already only skin-deep: `bk` embeds `topics/*/*.md` for EVERY app into one
// binary, so anybody who installs the CLI already holds every app's guide.
// What replaces it is honesty about scope — this server lists addresses, and
// whether you can get in is answered by the app at that address, not here.

import { sql } from 'drizzle-orm'
import type { Executor } from './client'
import { apps } from './schema'

export interface AppRegistryEntry {
  slug: string
  name: string
  base_url: string | null
}

/**
 * Every enabled app, ordered by slug.
 *
 * `enabled = false` is the one filter, and it is the global kill switch: a
 * disabled app must not appear in the address book at all, or the CLI would
 * happily route to a deployment the platform has turned off.
 */
export async function listAppRegistry(db: Executor): Promise<AppRegistryEntry[]> {
  const res = await db.execute(sql`
    SELECT a.slug, a.name, a.base_url
    FROM ${apps} a
    WHERE a.enabled = true
    ORDER BY a.slug
  `)
  return res.rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    base_url: r.base_url == null ? null : String(r.base_url),
  }))
}
