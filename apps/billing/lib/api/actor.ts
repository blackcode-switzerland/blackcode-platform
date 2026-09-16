// Who made this write, and how it arrived.
//
// ===========================================================================
// `via` IS THE ONLY STRUCTURAL DIFFERENCE BETWEEN A HUMAN AND AN AGENT
// ===========================================================================
// Both land in ONE audit log, because both are a user: an agent write is a
// user's token, so `actor_user_id` is always known. What differs is whether the
// request carried a bearer token or a session cookie, and that is worth
// recording — "Andrea changed the due date" and "Andrea's agent changed the due
// date" are different facts to a person reading the log.
//
// ── THE SPELLING MATCHES `/api/meta`'s `user.via`, DELIBERATELY ─────────────
// An agent correlating an audit row with its own identity should not have to
// learn a second vocabulary for one fact. `packages/platform-api` uses
// `session` / `token`; so does `billing.audit.via`, with a CHECK constraint.

import type { NextRequest } from 'next/server'
import type { ActorVia } from '@/types'

/**
 * Read it off the request, the same way the request layer resolved the caller.
 *
 * A bearer header means a token EVEN IF a session cookie is also present:
 * `lib/api.ts`'s `resolveUser` tries the token first and does not fall through
 * on a bad one, so the two must agree about which credential was used. Reading
 * the cookie first here would attribute an agent's write to a browser that
 * happened to be signed in on the same machine.
 */
export function authVia(req: NextRequest): ActorVia {
  return (req.headers.get('authorization') ?? '').startsWith('Bearer ') ? 'token' : 'session'
}
