// GET   /api/me — who the caller is
// PATCH /api/me — edit your own profile
//
// `platform.users` is one row per person across every app, so a name changed
// here is the name every other app shows.
//
// ── ONE `export const` PER METHOD. NOT `export const { GET, PATCH } = …` ────
// The destructured form serves traffic identically and matches none of the
// patterns the parity guard reads — so the route works while silently dropping
// out of the coverage check. `lib/cli-parity.test.ts` has a case that detects
// it; this is the shape that avoids it.
//
// **DELETE is not exported, and that is a decision.** The factory returns one.
// Closing an account is irreversible and reaches across every app; one place
// does it (`apps/issues`, behind a typed confirmation) rather than every
// deployment growing its own button. Exporting it here would also put
// `DELETE /api/me` into this app's parity check as an uncovered capability —
// it is deliberately unreachable from `bk`, because an agent must never delete
// its owner's account.
import { meRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = meRoute(appContext)
export const GET = handlers.GET
export const PATCH = handlers.PATCH
