// AppContext — the narrow bundle a SHARED handler needs from the app mounting it.
//
// ---------------------------------------------------------------------------
// WHY THIS TYPE IS SMALL, AND MUST STAY SMALL
// ---------------------------------------------------------------------------
// Every field here is a thing each future app must supply before it can serve a
// single shared route. That is the cost side of the trade, and it is paid once
// per app, forever. So the bar for adding a field is: **a shared route cannot be
// written without it, and no app could supply a sensible default.**
//
// If a field would only serve one app, it does not belong here — that is the
// standing rule ("if you have to add a parameter to make it generic, leave it in
// the app", docs/2026-08-platform-migration.md). Adding an app-shaped callback so
// one route can keep an app-specific behaviour is that rule being broken with
// extra steps.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE
// ---------------------------------------------------------------------------
// `schema`. docs/sales-app-plan.md D-2 sketched `{ db, schema, appSlug }`, and
// the sketch was one field too generous. Shared code cannot use an app's schema:
// it does not know what tables the app defines, and every table a shared route
// DOES touch is a `platform.*` table it can import from `@blackcode/platform-db`
// directly. A `schema` field would be an untyped bag that every app supplies and
// no shared route reads — the exact shape of a parameter that exists to look
// general.

import type { NextRequest } from 'next/server'
import type { PlatformDatabase, User } from '@blackcode/platform-db'
import type * as platformSchema from '@blackcode/platform-db/schema'
import type { WorkspaceSource } from './workspace-source'

/**
 * A Drizzle client that knows the `platform.*` tables — and only those.
 *
 * Every app's real client is `createDb(appSchema)` where `appSchema` is the
 * platform tables PLUS its own, so it is a SUPERSET and assigns to this
 * happily. Typing the narrow half is what lets shared code use the ordinary
 * query builder against platform tables without ever naming a table an app
 * defines.
 *
 * The earlier version of this field was `Executor` — platform-db's narrow
 * `execute(sql)` shape. That is the right type THERE, because those helpers must
 * also accept a transaction handle and the two Drizzle builders do not share a
 * type. It is the wrong type here: a route factory is the top of a request, never
 * inside a caller's transaction, and forcing raw SQL on shared routes means
 * hand-rewriting queries that already exist. That is not free —
 * `workspaces.storage_limit_bytes` is a bigint the driver returns as a STRING,
 * and only Drizzle's `mode: 'number'` was turning it back into a number before a
 * route serialized it. One rewrite, one silently changed response.
 *
 * A Drizzle client still satisfies `Executor`, so anything in platform-db that
 * wants the narrow shape keeps working.
 */
export type AppDatabase = PlatformDatabase<typeof platformSchema>

/**
 * Where a stuck agent goes, advertised on every response as `X-BK-Help` /
 * `X-BK-Changelog`.
 *
 * Optional on purpose: an app with no agent landing page must not advertise a
 * URL that 404s. A missing breadcrumb is a smaller failure than a wrong one.
 */
export interface AppManifest {
  /** Path to the app's "you are out of date, here is how to catch up" page. */
  help: string
  /** Path to the changelog feed, normally `/api/changelog`. */
  changelog: string
}

export interface AppContext {
  /**
   * This app's slug in `platform.apps` — the identity the per-app access check
   * is made against. Lives in the app (`lib/app.ts`), never in a platform
   * package: a platform package that knew a slug would be one that knew about
   * one app.
   */
  appSlug: string

  /**
   * The app's Drizzle client.
   *
   * Typed as `AppDatabase` (above): the platform tables only, which every app's
   * wider client assigns to.
   *
   * **Supply it as a getter if the app's client is lazy.** `createDb()` throws
   * when `DATABASE_URL` is unset, and `next build` imports every route module to
   * collect page data, so `db: getDb()` at module scope makes the app
   * unbuildable without a database. `apps/_scaffold/lib/api.ts` shows the shape;
   * `apps/_scaffold/lib/db/client.ts` records where that was found.
   */
  db: AppDatabase

  /**
   * WHERE THIS APP'S WORKSPACES LIVE — see `./workspace-source.ts`.
   *
   * Added 2026-08-10 (multiAppFinalRefactor Phase 2), and it is the field that
   * makes this type's own rule true rather than aspirational: `db` was always
   * enough only because every app's workspaces were in the same table. They are
   * not any more.
   *
   * REQUIRED, with no platform default, and that is the whole safety property.
   * A default would mean an app that never answered the question serves,
   * correctly and silently, against ANOTHER app's tenancy — the same shape as
   * `resolveSessionUser` falling back to `resolveUser`, with a wider blast
   * radius. `apps/issues` supplies `platformWorkspaceSource(db, APP_SLUG)`,
   * which is the set of calls it already made.
   */
  workspaces: WorkspaceSource

  /**
   * Who is calling, or null.
   *
   * App-supplied because the browser half is genuinely app-specific: a next-auth
   * session depends on that app's providers, callbacks and cookie
   * (`packages/platform-auth/src/index.ts` explains at length why `authOptions`
   * did not move). The token half is shared — `verifyToken` from
   * `@blackcode/platform-auth` — and an app with no UI can implement this as
   * just that, which is what `apps/_scaffold` does.
   */
  resolveUser(req: NextRequest): Promise<User | null>

  /**
   * Who is calling, **from a browser session only** — never from a bearer token.
   *
   * ── WHY THIS IS A SECOND FIELD AND NOT A FLAG ON THE FIRST ─────────────────
   * Do not "simplify" these into one. They answer different questions and one of
   * them is a security boundary.
   *
   * `resolveUser` accepts a `bk_live_…` token OR a session. That is right for
   * almost everything: it is how an agent works.
   *
   * `resolveSessionUser` accepts ONLY a session, and `/api/tokens` uses it
   * because **a bearer token minting another bearer token is privilege
   * escalation**. A token that leaks is bad; a token that can mint fresh,
   * longer-lived tokens is unrecoverable — revoking the original does not revoke
   * what it created. The route has said so since it was written.
   *
   * If the two were one resolver with a `sessionOnly` option, the safe value
   * would be the one you have to remember to pass, and the failure would be
   * silent: token auth would simply start working on a route where it must not.
   * Two fields make omission visible instead.
   *
   * OPTIONAL, and the routes that need it FAIL LOUDLY AT MOUNT TIME when it is
   * absent rather than falling back to `resolveUser`. A token-only app (the
   * scaffold) has no sessions and simply does not mount them.
   */
  resolveSessionUser?(req: NextRequest): Promise<User | null>

  /** Breadcrumb headers. Omit if the app has no agent landing page. */
  manifest?: AppManifest

  /**
   * Omit the request-derived payload from what gets written to
   * `platform.error_events.context` (D-19 item 2, docs/sales-app-plan.md §12).
   *
   * `sanitize()` strips credentials by KEY NAME — it was designed for issue
   * titles and knows nothing about a person's name, email or the notes from a
   * call with them. An app holding data about people at other companies cannot
   * rely on it, so it opts out of context capture entirely rather than trusting
   * a denylist to be complete.
   *
   * Absent/false is today's behaviour and what `apps/issues` uses. Redaction is
   * per-app rather than per-route deliberately: a route added later must not be
   * able to forget it.
   */
  redactBody?: boolean
}

/**
 * `app.resolveSessionUser`, or a mount-time throw naming the app and the route.
 *
 * Session-only routes must never fall back to `resolveUser` — see the field's
 * comment above. A factory calls this at construction time, which is module
 * IMPORT time, so an app that mounts one of these without a session resolver
 * fails its build rather than silently accepting bearer tokens on a route where
 * a bearer token must not be accepted.
 */
export function requireSessionResolver(
  app: AppContext,
  route: string
): NonNullable<AppContext['resolveSessionUser']> {
  if (!app.resolveSessionUser) {
    throw new Error(
      `${route} requires AppContext.resolveSessionUser, and "${app.appSlug}" does not supply one. ` +
        'This route is session-only on purpose: a bearer token minting another bearer token is ' +
        'privilege escalation. It will NOT fall back to resolveUser. Either give this app a ' +
        'session resolver, or do not mount this route.'
    )
  }
  return app.resolveSessionUser
}
