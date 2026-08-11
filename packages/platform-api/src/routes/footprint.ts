// /api/me/footprint — what THIS app holds for the caller, and removing it.
//
//   GET     "what is mine here?"      — read only, this app only
//   DELETE  "remove what is mine here" — this app only, NEVER the account
//
// ---------------------------------------------------------------------------
// TWO CALLERS, AND THE SECOND ONE IS WHY THE FIRST IS A ROUTE AT ALL
// ---------------------------------------------------------------------------
//   1. This app's own deletion screen ("delete my b/sales data and sign me out").
//   2. ANOTHER app's server, during the whole-account close: it reads the
//      address book and asks each app in turn. See `../account-census.ts`.
//
// Caller 2 is why this is HTTP rather than a function: no deployment can read
// another app's tables, so "what does this person hold everywhere?" has to be
// asked, not queried.
//
// ---------------------------------------------------------------------------
// SESSION-ONLY, AND THAT IS BOTH THE SAFETY PROPERTY AND THE PARITY REASON
// ---------------------------------------------------------------------------
// `requireSessionResolver`, not `app.resolveUser`. A bearer token cannot reach
// either method.
//
//   * DELETE is destructive and inherits `DELETE /api/me`'s settled reasoning —
//     an agent must never delete its owner's data. `Confirm()` is not a guard
//     for agents (it auto-approves under `BK_NO_PROMPT=1` and on a non-TTY), so
//     the guard has to be that the credential does not work at all.
//   * GET is session-only for a duller reason that is also the right one: the
//     fan-out forwards a COOKIE, because a token is valid at exactly one origin.
//     Accepting tokens here would add an agent-reachable capability that the one
//     caller cannot use.
//
// Both are therefore in every app's EXCLUDED_PATHS with the reason
// `/api/me/password/*` already carries: session-only by design. That is an
// honest exclusion rather than a convenient one — the route is structurally
// unreachable from `bk`, not merely un-implemented there.

import { NextRequest, NextResponse } from 'next/server'
import { requireSessionResolver, type AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'

export function footprintRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveSessionUser = requireSessionResolver(app, 'GET /api/me/footprint')

  const GET = apiHandler(async (req: NextRequest) => {
    const user = await resolveSessionUser(req)
    if (!user) throw Errors.unauthorized()
    return NextResponse.json({
      app: app.appSlug,
      footprint: await app.footprint.read(user.id),
    })
  })

  /**
   * Delete this person's data in THIS app. The account is not touched.
   *
   * The 409 is the same rule the account close has always had, asked one app at
   * a time: a workspace they own with other people in it must survive, and
   * ownership has to move before their data can go.
   *
   * The response carries `remaining` — a fresh read AFTER the delete — because
   * the whole-account close asserts on it. A 200 says the request was handled;
   * `remaining` says the app is empty, and only the second one is the thing the
   * caller needs to know before it soft-deletes the account (finding #16: assert
   * the positive, treat the refusals as the weaker half).
   */
  const DELETE = apiHandler(async (req: NextRequest) => {
    const user = await resolveSessionUser(req)
    if (!user) throw Errors.unauthorized()

    const before = await app.footprint.read(user.id)
    if (before.blocked_by.length > 0) {
      throw Errors.conflict(
        'owner_with_members',
        `You must transfer ownership of these ${app.appSlug} workspaces before deleting your data here`,
        before.blocked_by
      )
    }

    const remaining = await app.footprint.purge(user.id)
    return NextResponse.json({ deleted: true, app: app.appSlug, remaining })
  })

  return { GET, DELETE }
}
