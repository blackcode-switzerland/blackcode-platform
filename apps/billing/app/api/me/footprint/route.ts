// GET    /api/me/footprint — what THIS app holds for the caller
// DELETE /api/me/footprint — remove it. The ACCOUNT is not touched.
//
// ── KEEP THIS ROUTE WHEN YOU COPY THIS APP ─────────────────────────────────
// `DELETE /api/me` is deliberately NOT here (see `../route.ts`): full account
// closure lives in one app. This is the other half, and every app needs it.
// Without it, a whole-account close cannot see what this app holds and cannot
// remove it — so the person's data survives, owned by an account that can no
// longer sign in. That was live behaviour until 2026-08-11; the interface note
// in `lib/db/queries/footprint.ts` has the measurements.
//
// Session-only by construction (`requireSessionResolver` inside the factory), so
// both methods are in `lib/cli-parity.test.ts`'s EXCLUDED_PATHS with the reason
// `/api/me/password/*` already carries.
//
// One `export const` per method — the destructured form serves traffic
// identically and matches none of the patterns the parity guard reads.

import { footprintRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = footprintRoute(appContext)

export const GET = handlers.GET
export const DELETE = handlers.DELETE
