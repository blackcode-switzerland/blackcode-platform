// The two routes that describe the DEPLOYMENT rather than its data: the health
// probe and the client-error beacon.
//
// Every app needs its own copies on its own origin. A status endpoint served by
// a different deployment answers a different question — it says the issues
// functions are up, which tells you nothing about whether the sales ones are.
// That is the whole reason /api/status is Tier 1.

import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { insertErrorEvent } from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'
import { sanitize } from '../sanitize'

// ---------------------------------------------------------------------------
// POST /api/errors/client
// ---------------------------------------------------------------------------

const MAX_STACK = 8_000
const MAX_MESSAGE = 2_000

/**
 * Receive client-side error reports from the app's top-level Error Boundary.
 *
 * Auth is required so anonymous callers cannot spam-fill the table. Oversize
 * stacks are dropped and context is sanitised.
 *
 * NOTE: this beacon is NOT covered by `AppContext.redactBody`. That option
 * governs what the shared `apiHandler` records when a route THROWS; here the
 * body is the report — an app with nothing to say would send nothing. An app
 * that must not record client context should not mount this route.
 */
export function clientErrorsRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      throw Errors.badRequest('invalid_body', 'expected JSON object')
    }
    const message =
      typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE) : 'Client error'
    const code = typeof body.code === 'string' ? body.code.slice(0, 50) : 'client_error'
    const stack = typeof body.stack === 'string' ? body.stack.slice(0, MAX_STACK) : null
    const route = typeof body.route === 'string' ? body.route.slice(0, 255) : null
    const context = body.context !== undefined ? sanitize(body.context) : null

    await insertErrorEvent(app.db, {
      // The SERVING deployment, like every other writer of this column. A
      // client-side error reported to the sales origin is a sales error even
      // though the browser is where it happened.
      app: app.appSlug,
      level: 'error',
      code,
      message,
      stack,
      route,
      method: null,
      status_code: null,
      user_id: user.id,
      workspace_id: null,
      context: context as Record<string, unknown> | null,
    })

    return NextResponse.json({ logged: true })
  })
}

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 2_500

interface ProbeResult {
  status: 'ok' | 'error' | 'not_configured'
  latency_ms: number
  error?: string
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms)
    ),
  ])
}

/**
 * Public health endpoint. No auth. Cheap to call — three quick probes:
 *   db_ping   : SELECT 1 against Postgres
 *   blob_ping : HEAD on a known Vercel Blob endpoint if configured; else marked
 *               "not_configured" (still green — the local-fs fallback works)
 *   app_ping  : uptime of this instance
 *
 * Each probe is capped at a short timeout so a hung dependency cannot stall
 * /status — a health check that hangs is worse than one that says "down",
 * because a monitor waiting on it reports nothing at all.
 *
 * NOT under apiHandler: a health probe must answer even when the machinery that
 * wraps every other route is the thing that is broken.
 *
 * `/api/status/errors` and `/api/status/errors/{id}` are deliberately NOT here.
 * They are the feed behind the public `/status` PAGE, not part of being
 * monitorable, so an app inherits them only if it ships that page. Decided
 * 2026-08-06 (docs/sales-app-plan.md Phase 1b review §4); the sales app's answer
 * comes at Phase 6. An app that wants them keeps its own copies, as issues does.
 */
export function statusRoute(app: AppContext) {
  // Per mounted instance, not per request — this is what `uptime_ms` measures.
  const startedAt = Date.now()

  async function dbProbe(): Promise<ProbeResult> {
    const t0 = Date.now()
    try {
      await withTimeout(app.db.execute(sql`SELECT 1`), PROBE_TIMEOUT_MS)
      return { status: 'ok', latency_ms: Date.now() - t0 }
    } catch (err) {
      return {
        status: 'error',
        latency_ms: Date.now() - t0,
        error: (err as Error)?.message ?? 'unknown',
      }
    }
  }

  async function blobProbe(): Promise<ProbeResult> {
    const t0 = Date.now()
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { status: 'not_configured', latency_ms: 0 }
    }
    try {
      // Light HEAD against the Vercel blob origin. Treat any 2xx/3xx as ok.
      const res = await withTimeout(
        fetch('https://blob.vercel-storage.com/', { method: 'HEAD' }),
        PROBE_TIMEOUT_MS
      )
      return {
        status: res.status < 500 ? 'ok' : 'error',
        latency_ms: Date.now() - t0,
        ...(res.status >= 500 ? { error: `HTTP ${res.status}` } : {}),
      }
    } catch (err) {
      return {
        status: 'error',
        latency_ms: Date.now() - t0,
        error: (err as Error)?.message ?? 'unknown',
      }
    }
  }

  return async function GET() {
    const [dbR, blobR] = await Promise.all([dbProbe(), blobProbe()])
    const appR: ProbeResult = { status: 'ok', latency_ms: 0 }

    const overall: 'ok' | 'degraded' | 'down' =
      dbR.status === 'error'
        ? 'down'
        : blobR.status === 'error' || appR.status === 'error'
          ? 'degraded'
          : 'ok'

    return NextResponse.json(
      {
        overall,
        probes: {
          database: dbR,
          blob: blobR,
          app: { ...appR, uptime_ms: Date.now() - startedAt },
        },
        checked_at: new Date().toISOString(),
      },
      {
        status: overall === 'down' ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }
}
