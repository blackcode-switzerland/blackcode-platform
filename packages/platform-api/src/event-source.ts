// WHERE AN APP'S ACTIVITY FEED IS READ FROM.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (multiAppFinalRefactor Phase 3, 2026-08-10)
// ---------------------------------------------------------------------------
// `platform.events` used to hold every app's events, which is what made
// GET /api/workspaces/{ws}/activity a shared route with a small app-shaped
// contribution (D-22). `apps/sales` now writes `sales.events`, so the shared
// half can no longer name a table — the same seam `workspace-source.ts` cut for
// tenancy, in the one route that reads the spine.
//
// It goes on the CONTRIBUTION rather than on `AppContext`, and that is a
// deliberate difference from `workspaces` and `uploads`. Those are read by many
// entry points (the request layer, `/api/meta`, upload attribution), so an app
// must answer for them before it serves anything. This is read by exactly one
// route. An app that does not mount `/api/workspaces/{ws}/activity` should not
// have to say where its events live, and `app-context.ts`'s bar — "a field here
// is a thing EVERY future app must supply" — says so.
//
// ---------------------------------------------------------------------------
// REQUIRED WITHIN THE CONTRIBUTION, THOUGH
// ---------------------------------------------------------------------------
// An app mounting this route must say. A default of `platform.events` would
// mean an app whose events live elsewhere serving another app's feed for a
// workspace id that means a different team — silently, and looking right.
// Required means it does not compile.

import { listEvents, type EventsPage, type ListEventsFilter } from '@blackcode/platform-db'
import type { PlatformDb } from '@blackcode/platform-db'

export type { EventsPage, ListEventsFilter }

/**
 * One page of an app's activity feed.
 *
 * The rows are typed loosely on purpose — the route serializes them and the
 * shapes differ by one column (`platform.events` carries `app`; an app-owned
 * table does not need to, because the schema name is the answer). An app-owned
 * implementation should still ANSWER `app`, with its own slug: the field is on
 * the wire, `bk activity` prints it, and a column that silently became empty
 * reads as "unknown app" rather than "this one".
 */
export interface EventSource {
  list(filter: ListEventsFilter): Promise<EventsPage>
}

/** The `platform.events`-backed source — what `apps/issues` supplies. */
export function platformEventSource(db: PlatformDb): EventSource {
  return { list: (filter) => listEvents(db, filter) }
}
