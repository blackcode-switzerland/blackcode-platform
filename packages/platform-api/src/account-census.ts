// THE CENSUS — what this person holds in every app, asked over HTTP.
//
// ---------------------------------------------------------------------------
// THE MECHANISM
// ---------------------------------------------------------------------------
// The deployment answering `DELETE /api/me` reads the address book
// (`platform.apps`) and, for each OTHER app, calls that app's own
// `GET /api/me/footprint`, forwarding the `Cookie` header it already received.
// Each app answers only for itself, from its own tables, under its own Postgres
// role. **Nothing shared is added** — which is the point of the eight phases
// before this one.
//
// It works because one credential is valid at both origins:
//   - the session cookie is renamed and domain-widened to `.blackcode.ch` by
//     `packages/platform-auth/src/session-cookie.ts` (D-16), so the browser
//     sends it to whichever app the person is on, and that app's SERVER
//     therefore holds a credential valid at the other;
//   - `NEXTAUTH_SECRET` is deliberately the same value in every app, so each can
//     decrypt a cookie issued by another.
//
// ** AND THAT IS THE ONE THING LOCAL DEV CANNOT DEMONSTRATE. ** With
// `NEXTAUTH_URL` on `localhost`, `session-cookie.ts` deliberately emits NO
// `Domain` attribute — the documented default that keeps localhost and
// `*.vercel.app` previews working. A local pass therefore exercises the census
// LOGIC (including every failure branch, which is what matters here) but not the
// production credential path. Do not read a local green as "the fan-out works".
//
// ---------------------------------------------------------------------------
// THE SAFETY PROPERTY IS A TYPE, NOT A CONVENTION
// ---------------------------------------------------------------------------
// A census must never report "no data" for an app it could not reach. That is
// CLAUDE.md finding #14 restated — `bk super-admin entity-drift` reported no
// drift, and exited 0, against a database with 51 unprojected rows, because it
// could only see one deployment.
//
// So `AppCensusEntry` is a discriminated union with exactly two shapes and no
// default. There is no field that could hold "0" when the truth is "unknown",
// because the shape carrying the counts does not exist on an unreachable entry.
// A caller that forgets to branch does not compile.
//
// Two rules follow, and they ARE the safety property:
//   - the UI renders unreachable apps BY NAME, as unknown. Not omitted, not zero.
//   - a whole-account close is REFUSED while any app is unreachable (409). An
//     irreversible operation may not run on a partial census.
// "This app only" stays allowed throughout — it is answerable locally and needs
// no census at all.

import type { NextRequest } from 'next/server'
import { listAppRegistry } from '@blackcode/platform-db'
import type { AppContext } from './app-context'
import type { AppFootprint } from './account-footprint'

interface CensusEntryBase {
  /** The app's slug in `platform.apps`. */
  app: string
  /** Its human name, for the screen. */
  name: string
  /** True for the deployment answering the request — read locally, not fetched. */
  is_current: boolean
}

export type AppCensusEntry =
  | (CensusEntryBase & { reachable: true; footprint: AppFootprint })
  | (CensusEntryBase & { reachable: false; error: string })

/** How long to wait for another app before calling it unreachable. */
const FOOTPRINT_TIMEOUT_MS = 5_000

/**
 * Ask every app what this person holds.
 *
 * The current app is answered LOCALLY and never over HTTP: a deployment asking
 * itself a question through its own load balancer is a way to be unreachable to
 * yourself, and it would make the one entry we can always answer the one most
 * likely to fail.
 *
 * Every failure mode collapses to `reachable: false` with the reason in `error`
 * — a missing `base_url`, a timeout, a non-200, a body that is not a footprint.
 * They are deliberately not distinguished further: the caller's only decision is
 * "is this census complete?", and four kinds of no-answer are one answer.
 *
 * **No cookie means no fan-out, and that is correct.** `DELETE /api/me` accepts
 * a bearer token (it is `resolveUser`), and a token is valid at ONE origin — the
 * app that minted it. Rather than pretend, every other app comes back
 * unreachable, which refuses the whole-account close. Fail-safe, in the safe
 * direction.
 */
export async function accountCensus(
  app: AppContext,
  req: NextRequest,
  userId: number
): Promise<AppCensusEntry[]> {
  const registry = await listAppRegistry(app.db)
  const cookie = req.headers.get('cookie')

  return Promise.all(
    registry.map(async (entry): Promise<AppCensusEntry> => {
      const base: CensusEntryBase = {
        app: entry.slug,
        name: entry.name,
        is_current: entry.slug === app.appSlug,
      }

      if (base.is_current) {
        return { ...base, reachable: true, footprint: await app.footprint.read(userId) }
      }
      if (!entry.base_url) {
        return {
          ...base,
          reachable: false,
          error: 'no base_url registered in platform.apps — this app cannot be asked',
        }
      }
      if (!cookie) {
        return {
          ...base,
          reachable: false,
          error: 'this request carries no session cookie, so another app cannot be asked on your behalf',
        }
      }
      return fetchFootprint(base, entry.base_url, cookie)
    })
  )
}

/**
 * Delete this person's data in ONE OTHER app, and report what is left there.
 *
 * Separate from the census on purpose: reading is safe to do everywhere at once,
 * and this is not. The caller sequences these and stops at the first failure —
 * see `routes/me.ts`, where the ORDER is the whole recovery story.
 */
export async function purgeRemoteApp(
  entry: AppCensusEntry & { reachable: true },
  baseUrl: string,
  cookie: string
): Promise<{ ok: true; remaining: AppFootprint } | { ok: false; error: string }> {
  try {
    const res = await fetch(join(baseUrl, '/api/me/footprint'), {
      method: 'DELETE',
      headers: { cookie, accept: 'application/json' },
      signal: AbortSignal.timeout(FOOTPRINT_TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = body && typeof body === 'object' && 'message' in body ? String(body.message) : ''
      return { ok: false, error: `${entry.name} answered HTTP ${res.status}${detail ? `: ${detail}` : ''}` }
    }
    const remaining = asFootprint(body && typeof body === 'object' ? body.remaining : null)
    if (!remaining) {
      return { ok: false, error: `${entry.name} answered 200 with a body this app cannot read` }
    }
    return { ok: true, remaining }
  } catch (e) {
    return { ok: false, error: `${entry.name} could not be reached: ${reasonOf(e)}` }
  }
}

/** True when this app still holds something the person owns. */
export function stillHolds(f: AppFootprint): boolean {
  return f.blocked_by.length > 0 || f.will_delete.length > 0
}

async function fetchFootprint(
  base: CensusEntryBase,
  baseUrl: string,
  cookie: string
): Promise<AppCensusEntry> {
  try {
    const res = await fetch(join(baseUrl, '/api/me/footprint'), {
      headers: { cookie, accept: 'application/json' },
      signal: AbortSignal.timeout(FOOTPRINT_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ...base, reachable: false, error: `answered HTTP ${res.status}` }
    }
    const body = await res.json().catch(() => null)
    const footprint = asFootprint(body && typeof body === 'object' ? body.footprint : null)
    if (!footprint) {
      return { ...base, reachable: false, error: 'answered 200 with a body this app cannot read' }
    }
    return { ...base, reachable: true, footprint }
  } catch (e) {
    return { ...base, reachable: false, error: reasonOf(e) }
  }
}

/**
 * A footprint, or null — validated rather than cast.
 *
 * A cast would make "the other app answered with an error page" indistinguishable
 * from "the other app said you have nothing", which is the one confusion this
 * whole module exists to prevent. `apps/sales`' members page went blank in
 * production because a cast renamed an envelope instead of opening it; this is
 * the same shape with a destructive operation on the other end.
 */
function asFootprint(v: unknown): AppFootprint | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Record<string, unknown>
  if (typeof f.known !== 'boolean') return null
  if (!Array.isArray(f.blocked_by) || !Array.isArray(f.will_delete) || !Array.isArray(f.holds)) {
    return null
  }
  return f as unknown as AppFootprint
}

function reasonOf(e: unknown): string {
  if (e instanceof Error) {
    return e.name === 'TimeoutError' ? `no answer within ${FOOTPRINT_TIMEOUT_MS}ms` : e.message
  }
  return 'unknown error'
}

/** `base_url` is stored with or without a trailing slash; neither may double it. */
function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}
