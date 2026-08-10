// The shared request layer: `apiHandler`, `resolveWorkspace`, `requireOwner`.
//
// Every app binds these once to its own `AppContext` and re-exports them from
// `lib/api`, so route files are unchanged by the extraction:
//
//   // apps/<app>/lib/api/handler.ts
//   export const apiHandler = createApiHandler(appContext)
//
//   // any route
//   export const GET = apiHandler(async (req, { params }) => { … })
//
// ---------------------------------------------------------------------------
// WHERE THIS CAME FROM
// ---------------------------------------------------------------------------
// `apps/issues/lib/api/{handler,workspace-context}.ts`, moved here on 2026-08-06
// (docs/sales-app-plan.md Phase 1a, decision D-2). It was NOT extracted during
// the platform migration, deliberately — the scaffold's `lib/api.ts` header
// recorded the reason and named the trigger: "when a REAL second app lands".
// `apps/sales` is that app. It is deployed on its own domain and would otherwise
// serve none of the shared routes.
//
// The move is behaviour-preserving for `apps/issues` by design. Three things it
// would have been easy to drop, and why none of them may be:
//
//   `platform.error_events` logging — this is what gives every future app
//     `bk super-admin errors` coverage for free, instead of it being an item
//     docs/adding-an-app.md tells each app to remember. An app that forgets it
//     has no error record at all, and nothing goes red.
//
//   the CLI version headers — `bk` reads `X-BK-CLI-Min` and hard-blocks itself
//     (exit 8) when it is below the floor. An app that omits them is an app
//     whose users can never be told to upgrade.
//
//   the 401 / 404 / 403 distinctions in `resolveWorkspace` — see its own
//     comment. The reasoning is load-bearing, not stylistic.

import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from '@blackcode/platform-agent'
import {
  errorEvents,
  getWorkspaceForUser,
  type User,
  type Workspace,
} from '@blackcode/platform-db'
import type { AppContext } from './app-context'
import { ApiError, Errors, errorBody } from './errors'
import { requireAppAccess } from './require-app-access'
import { sanitize, truncate } from './sanitize'

// ---------------------------------------------------------------------------
// Standard headers
// ---------------------------------------------------------------------------

// A standing "this is not a supported interface" signal for DIRECT HTTP
// CALLERS. There is no sunset date: the users are internal and were told
// directly, so there is no notice period to run down. The signal stays
// indefinitely because its real audience is an agent working from stale context
// — one that learned these routes before 1.9.0 and still has them in its
// prompt. That agent can show up at any time, and a header costs nothing.
//
// It is safe because no route changed (we withdrew the support promise, not the
// endpoint) and the signal travels in headers, never the body, so it cannot
// break anyone's response parsing.
const DEPRECATION_WARNING =
  '299 - "The HTTP API is no longer a supported interface. Use the bk CLI: ' +
  'npm install -g @blackcode_sa/bc-issues && bk skill install"'

// The CLI identifies itself as `bk-cli/<version>` (see cli/internal/client). It
// IS the supported interface, so warning it would be noise that its users can do
// nothing about — and noise teaches agents to ignore headers.
function isCliCaller(req: NextRequest): boolean {
  const ua = req.headers.get('user-agent') ?? ''
  return ua.startsWith('bk-cli/') || req.headers.get('x-bk-client') === 'cli'
}

// Standard headers on EVERY API response (success and error alike):
//  - X-BK-CLI-Latest / X-BK-CLI-Min: the supported bk CLI versions. The CLI reads
//    these to show a soft "update available" notice and to hard-block when it is
//    below the minimum supported version.
//  - X-BK-Help / X-BK-Changelog: passive breadcrumbs so an agent that hits a wall
//    can find its own way back. They sit out-of-band in headers (never in the
//    body), so they cost nothing to a client that ignores them. Sourced from the
//    app's manifest so they can't drift from /llms.txt and the per-page manifest.
//    Omitted entirely when the app has no manifest — a breadcrumb pointing at a
//    404 is worse than none.
function withStandardHeaders<T extends NextResponse | Response>(
  app: AppContext,
  res: T,
  req?: NextRequest
): T {
  res.headers.set('X-BK-CLI-Latest', CLI_LATEST_VERSION)
  res.headers.set('X-BK-CLI-Min', CLI_MIN_VERSION)
  if (app.manifest) {
    res.headers.set('X-BK-Help', app.manifest.help)
    res.headers.set('X-BK-Changelog', app.manifest.changelog)
  }

  if (req && !isCliCaller(req)) {
    if (app.manifest) res.headers.set('X-BK-Migration', app.manifest.help)
    res.headers.set('Warning', DEPRECATION_WARNING)
  }
  return res
}

// ---------------------------------------------------------------------------
// apiHandler
// ---------------------------------------------------------------------------

type RouteContext = unknown

type Handler<TCtx extends RouteContext> = (
  req: NextRequest,
  ctx: TCtx
) => Promise<NextResponse | Response> | NextResponse | Response

/**
 * Bind the request wrapper to one app.
 *
 * The returned `apiHandler` wraps a Next.js App Router route handler with:
 *  1. the canonical error response shape (`{ error, code, suggestion?, details? }`)
 *  2. `platform.error_events` logging for 5xx and unexpected throws
 *  3. the standard headers above
 *
 * 4xx ApiErrors (unauthorized, forbidden, not_found, bad_request, conflict) are
 * returned to the client but NOT logged — they are normal client errors. 5xx
 * ApiErrors and any non-ApiError throwable ARE logged.
 */
export function createApiHandler(app: AppContext) {
  return function apiHandler<TCtx extends RouteContext = RouteContext>(
    handler: Handler<TCtx>
  ): (req: NextRequest, ctx: TCtx) => Promise<NextResponse | Response> {
    return async (req, ctx) => {
      try {
        return withStandardHeaders(app, await handler(req, ctx), req)
      } catch (err) {
        return withStandardHeaders(app, await handleError(app, err, req), req)
      }
    }
  }
}

async function handleError(
  app: AppContext,
  err: unknown,
  req: NextRequest
): Promise<NextResponse> {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      await safeLog(app, {
        level: 'error',
        code: err.code,
        message: err.message,
        stack: err.stack ?? null,
        route: routePath(req),
        method: req.method,
        status_code: err.status,
        context: errorLogContext({ details: err.details }, app),
      })
    }
    return NextResponse.json(errorBody(err), { status: err.status })
  }

  const e = err as { message?: string; stack?: string; name?: string } | null | undefined
  await safeLog(app, {
    level: 'error',
    code: 'internal_error',
    message: e?.message ?? 'Unknown error',
    stack: e?.stack ?? null,
    route: routePath(req),
    method: req.method,
    status_code: 500,
    context: errorLogContext({ name: e?.name ?? 'Unknown' }, app),
  })

  return NextResponse.json(
    {
      error: 'Internal server error',
      code: 'internal_error',
    },
    { status: 500 }
  )
}

/**
 * What gets written to `platform.error_events.context`.
 *
 * Exported because it is the whole of D-19 item 2 and needs a test that watches
 * it fail — see `redact-body.test.ts`. Keeping the decision in one pure function
 * is what makes that test possible without a live request.
 *
 * ── THE TWO INPUTS, AND WHICH ONE IS REQUEST-DERIVED ────────────────────────
 * `name` is the thrown error's constructor name (`TypeError`, `DatabaseError`).
 * It carries no request data and is always kept.
 *
 * `details` is `ApiError.details` — arbitrary structured context a route chose
 * to attach, which is the ONLY request-derived value that reaches this column.
 * Normally it is passed through `sanitize()`, a denylist of credential-shaped
 * KEY NAMES. That denylist cannot know that `contact_email` or `call_notes`
 * matter, so an app holding data about people at other companies opts out of
 * carrying `details` at all rather than trusting it (`redactBody`).
 *
 * ── WHAT `redactBody` DOES NOT COVER — read before relying on it ────────────
 * `message` and `stack` are recorded regardless, and a database driver will
 * happily put a rejected value inside an error message ("Key (email)=(…)
 * already exists"). Redaction here is about the CONTEXT column, which is what
 * D-19 names; it is not a promise that no request value can ever reach the
 * table. Anything stronger has to redact the message too, at the cost of the
 * only thing that makes an error row worth keeping.
 *
 * The `redacted` marker is not decoration: without it, "this app withheld
 * context" and "this error had no context" look identical to whoever is reading
 * the row at 3am. It is written only when something was ACTUALLY withheld — an
 * error that carried no details logs `null` under either setting, because
 * claiming a redaction that did not happen is its own kind of lie.
 */
export function errorLogContext(
  input: { details?: unknown; name?: string },
  opts: { redactBody?: boolean }
): Record<string, unknown> | null {
  // The unexpected-throw path. `name` is the error's constructor name, never
  // request data, so redaction has nothing to do here.
  if (input.name !== undefined) return { name: input.name }

  // Truthiness, not `!== undefined`, because that is what the pre-extraction
  // handler did: `err.details ? { details: sanitize(...) } : null`.
  if (!input.details) return null

  return opts.redactBody ? { redacted: 'body' } : { details: sanitize(input.details) }
}

interface ErrorEventRow {
  level: string
  code: string | null
  message: string
  stack: string | null
  route: string | null
  method: string | null
  status_code: number | null
  user_id?: number | null
  workspace_id?: number | null
  context: Record<string, unknown> | null
}

async function safeLog(app: AppContext, row: ErrorEventRow): Promise<void> {
  try {
    const context = row.context === null ? null : JSON.stringify(row.context)
    // `app` is stamped from the AppContext, never from `row` — the same reason
    // `recordUpload` and `recordEvent` stamp theirs centrally: a column that a
    // call site can supply is a column a call site can omit, and this one has
    // to be right on EVERY row for the refactor's Phase 5 to be able to make it
    // NOT NULL. `safeLog` is not reachable except through a handler that already
    // holds the context, so there is nothing to thread.
    await app.db.execute(sql`
      INSERT INTO ${errorEvents}
        (app, level, code, message, stack, route, method, status_code, user_id, workspace_id, context)
      VALUES (
        ${truncate(app.appSlug, 40)},
        ${row.level},
        ${truncate(row.code ?? null, 50)},
        ${truncate(row.message, 8_000) ?? 'Unknown'},
        ${truncate(row.stack ?? null, 8_000)},
        ${truncate(row.route ?? null, 255)},
        ${truncate(row.method ?? null, 10)},
        ${row.status_code ?? null},
        ${row.user_id ?? null},
        ${row.workspace_id ?? null},
        ${context}::jsonb
      )
    `)
  } catch (logErr) {
    // Never let logging block the response. Surface to stderr so it's visible
    // in dev / vercel logs, but don't propagate.
    console.error('[apiHandler] failed to write error_events:', logErr)
  }
}

function routePath(req: NextRequest): string {
  try {
    return new URL(req.url).pathname
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Workspace-scoped request context
// ---------------------------------------------------------------------------

// Every workspace-scoped API route resolves the user + workspace + membership
// up front via resolveWorkspace(). It throws the right ApiError on each gate:
//   - no auth                    → 401 unauthorized
//   - workspace not found OR     → 404 workspace_not_found
//     user is not a member         (we return 404, not 403, so we don't leak
//                                   the existence of workspaces the user can't
//                                   see)
//   - member, but no access to    → 403 app_access_denied, WITH a suggestion
//     THIS app here                naming who can grant it
//   - owner-only action and      → 403 forbidden
//     caller is not the owner
//
// The two 403s are different failures and the distinction matters: "you are not
// the owner" is final, while "you don't have the app here" is grantable, so it
// carries a hint. 403 rather than 404 for app access is deliberate — the caller
// IS a member, so hiding the workspace would hide the one fact they need.
//
// The returned context object is meant to be passed to the query layer:
//
//   export const GET = apiHandler(async (req, { params }) => {
//     const ctx = await resolveWorkspace(req, (await params).ws)
//     return NextResponse.json(await getProjectsInWorkspace(ctx.workspace.id))
//   })

export interface WorkspaceContext {
  user: User
  workspace: Workspace
  role: 'owner' | 'member'
}

/**
 * Bind the workspace resolver to one app.
 *
 * The lookup itself is `getWorkspaceForUser` in platform-db — the same function
 * `apps/issues` always used, moved beside the tables it reads. Read its note
 * before changing what it matches.
 */
export function createResolveWorkspace(app: AppContext) {
  return async function resolveWorkspace(
    req: NextRequest,
    slugOrId: string
  ): Promise<WorkspaceContext> {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    if (!slugOrId) throw Errors.notFound('workspace')

    const ws = await getWorkspaceForUser(app.db, slugOrId, user.id)
    if (!ws) throw Errors.notFound('workspace')

    // Membership gets you into the organisation; this gets you into THIS app.
    // Behind PLATFORM_ENFORCE_APP_ACCESS — unset means enforced.
    await requireAppAccess(app.db, {
      app: app.appSlug,
      workspaceId: ws.id,
      userId: user.id,
      userEmail: user.email,
      workspaceSlug: ws.slug,
    })

    return {
      user,
      workspace: ws,
      role: ws.member_role,
    }
  }
}

export function requireOwner(ctx: WorkspaceContext): void {
  if (ctx.role !== 'owner') {
    throw Errors.forbidden('Only the workspace owner can perform this action')
  }
}
