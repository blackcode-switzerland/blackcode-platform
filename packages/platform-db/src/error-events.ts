// Writing to `platform.error_events`.
//
// Only the INSERT is here. The listings and the triage mutations
// (`listPublicErrorEvents`, `listAdminErrorEvents`, `setErrorEventResolved`, …)
// stay in `apps/issues/lib/db/queries/error-events.ts` for now: the routes that
// use them — the public status feed and the super-admin Errors tab — are Tier 2
// in docs/sales-app-plan.md D-2 and have not been factory-ised. Moving a query
// nothing shared calls yet is speculative extraction.
//
// The shared `apiHandler` does NOT use this. It writes its row with an
// interpolated `sql` statement in `platform-api/src/handler.ts`, because the
// only thing it is guaranteed to hold is a client, and its logging must survive
// anything — including being handed a transaction handle. This function exists
// for the deliberate, application-level report: a client error beacon.

import type { PlatformDb } from './client'
import { errorEvents, type NewErrorEvent } from './schema'

/**
 * `app` is REQUIRED here even though the column is nullable.
 *
 * The column has to be nullable for the length of the expand→migrate→contract
 * window (see the schema), but that is a statement about rows written by code
 * that predates it — not a licence for new code to omit it. Widening the
 * parameter type is what makes "every writer sets it" checkable by `tsc`
 * instead of by a test that has to enumerate call sites, which is the same
 * trade `uploads.app` made and the reason that column reached 0 NULLs.
 *
 * `NewErrorEvent['app']` is `string | null | undefined`; intersecting it with a
 * required `string` is what turns an omission into a compile error.
 */
export async function insertErrorEvent(
  db: PlatformDb,
  row: Omit<NewErrorEvent, 'id' | 'occurred_at' | 'app'> & { app: string }
): Promise<void> {
  await db.insert(errorEvents).values(row)
}
