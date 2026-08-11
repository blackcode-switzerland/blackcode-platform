// GET    /api/me/footprint — what THIS app holds for the caller
// DELETE /api/me/footprint — remove it. The ACCOUNT is not touched.
//
// Mounted from the shared factory. Two callers: this app's own deletion screen,
// and another app's server during a whole-account close — it reads
// `platform.apps` and asks each app in turn, because no deployment can read
// another app's tables.
//
// Session-only, by construction (`requireSessionResolver` inside the factory),
// so both methods are in `lib/cli-parity.test.ts`'s EXCLUDED_PATHS with the
// reason `/api/me/password/*` already carries. An agent must never delete its
// owner's data, and the guard for that is that the credential does not work —
// `Confirm()` auto-approves under `BK_NO_PROMPT=1`.
//
// One `export const` per method: the destructured form serves traffic
// identically and matches none of the patterns the parity guard reads.

import { footprintRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = footprintRoute(appContext)

export const GET = handlers.GET
export const DELETE = handlers.DELETE
