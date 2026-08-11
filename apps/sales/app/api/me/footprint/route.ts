// GET    /api/me/footprint — what THIS app holds for the caller
// DELETE /api/me/footprint — remove it. The ACCOUNT is not touched.
//
// ---------------------------------------------------------------------------
// THIS APP SERVES A DELETION ROUTE AFTER ALL, AND IT IS NOT `DELETE /api/me`
// ---------------------------------------------------------------------------
// `app/api/me/route.ts` explains at length why this app does not serve
// `DELETE /api/me`: closing a blackcode account is irreversible, reaches every
// app, and two deployments each offering their own button is two places to get
// it wrong. **That argument survives intact and this route does not contradict
// it.** Full account closure is still issues-only. This is the narrow half —
// "delete my b/sales data" — and it is the ONLY place that can do it, because
// no other deployment can read or write `sales.*`.
//
// Two callers: this app's own account screen, and `apps/issues`' server during a
// whole-account close, which forwards the caller's session cookie.
//
// Session-only by construction (`requireSessionResolver` inside the factory), so
// both methods are in `lib/cli-parity.test.ts`'s EXCLUDED_PATHS: an agent must
// never delete its owner's data, and the guard for that is that the credential
// does not work at all.
//
// One `export const` per method — the destructured form serves traffic
// identically and matches none of the patterns the parity guard reads.

import { footprintRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = footprintRoute(appContext)

export const GET = handlers.GET
export const DELETE = handlers.DELETE
