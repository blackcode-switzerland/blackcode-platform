// GET /api/workspaces/{ws}/activity — mounted from the shared Class-B factory.
//
// ---------------------------------------------------------------------------
// THIS IS NOT A THREE-LINE MOUNT, AND THE SECOND ARGUMENT IS THE POINT
// ---------------------------------------------------------------------------
// `docs/frontend.md` §8 wrote this mount as three lines (`activityRoute(appContext)`)
// while the page it describes did not exist. It does not compile: the factory is
// Class B (D-22), so it takes a SECOND argument. The query over the feed is
// shared, but an event's `entity_id` is an internal serial and the API must
// never serve one — swapping it for the workspace #number means reading
// `sales.*`, which a platform package cannot do. Since Phase 3 the same argument
// also says WHICH TABLE the feed is: this app's events are `sales.events`.
//
// So the app-shaped half arrives here, named and typed, rather than as a field
// on `AppContext` that every future app would pay for whether it mounts this
// route or not.
//
// ---------------------------------------------------------------------------
// THE TWO VOCABULARIES ARE THIS APP'S, AND THEY ARE IMPORTED
// ---------------------------------------------------------------------------
// `?entity_type=` and `?action=` are validated against the platform set (which
// the factory already knows) plus these. **A value the writer can produce and
// this list has not heard of returns the WHOLE FEED rather than a 400** —
// `parseList` drops an unrecognised filter — so the lists have to come from the
// same place `recordEvent` writes from. They do, and there is no second copy to
// keep honest: `lib/db/queries/events.ts` DERIVES its `EntityType` and
// `EventAction` unions from these two arrays, so an action added to the writer
// is an action this filter accepts, checked by `tsc` rather than by a test.
import { activityRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import {
  SALES_EVENT_ACTIONS,
  SALES_EVENT_ENTITY_TYPES,
  resolveEventEntitySeqs,
  salesEventSource,
} from '@/lib/db/queries/events'
import { ENTITY_TYPES } from '@/lib/entity-address'

export const GET = activityRoute(appContext, {
  // WHERE THIS APP'S EVENTS LIVE — `sales.events` since Phase 3. Required by the
  // contribution with no default: `platform.events` used to be everybody's, and
  // an app serving another app's feed for a workspace id that means a different
  // team is precisely what this refactor removes.
  events: salesEventSource,
  entityTypes: SALES_EVENT_ENTITY_TYPES,
  actions: SALES_EVENT_ACTIONS,
  // The six whose `entity_id` is a serial that must be swapped for the #number.
  // DERIVED from the projection's own list rather than retyped: these are
  // exactly the types that have a #number, which is the same question
  // `lib/entity-address.ts` already answers. A contact, stage entry, objection
  // or match keeps its own-domain id, which is correct — that id IS its address.
  numberedEntityTypes: ENTITY_TYPES,
  resolveEntitySeqs: resolveEventEntitySeqs,
})
