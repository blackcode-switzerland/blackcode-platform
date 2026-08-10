// GET /api/workspaces/{ws}/activity — the workspace activity feed.
//
// ---------------------------------------------------------------------------
// THE FIRST CLASS-B FACTORY (D-22)
// ---------------------------------------------------------------------------
// This route is 90% platform and 10% not, and the 10% is the interesting part.
// The query, the filters and the envelope are shared — but an event's
// `entity_id` is an INTERNAL ROW ID, and the API must never expose one. For an
// app's own entities it has to be swapped for the workspace #number, which means
// reading that app's tables. This package cannot do that and must not try.
//
// Since Phase 3 (2026-08-10) the TABLE is app-shaped too: `platform.events` was
// every app's, and `apps/sales` now writes `sales.events`. So the contribution
// carries an `events` source as well — see `../event-source.ts`.
//
// So the factory takes a SECOND ARGUMENT: a named, typed contribution from the
// app. Not a field on `AppContext` — AppContext is what every app supplies for
// every route, and a field two routes read is a tax every future app pays to
// mount neither of them. A second argument is explicit, local, and costs nothing
// to an app that does not mount this route.
//
//     export const GET = activityRoute(appContext, {
//       events: platformEventSource(db),
//       entityTypes: [...],
//       actions: [...],
//       numberedEntityTypes: ['issue', 'task', 'project'],
//       resolveEntitySeqs,
//     })
//
// An app that contributes nothing still gets a working feed of the platform
// events — workspace, membership, invitations, app access.

import { NextRequest, NextResponse } from 'next/server'
import { parseUrn, PLATFORM_ENTITY_TYPES, PLATFORM_EVENT_ACTIONS } from '@blackcode/platform-db'
import type { EventSource } from '../event-source'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace } from '../handler'

interface Params {
  params: Promise<{ ws: string }>
}

/**
 * The entity types and actions that exist for EVERY app, because the platform
 * records them: workspaces, membership, invitations, and per-app access.
 *
 * An app's own nouns and verbs arrive in the contribution. Keeping the two lists
 * separate is what stops one app's vocabulary leaking into another's filter
 * validation.
 *
 * **Imported, not restated.** These are the same lists `recordPlatformEvent`
 * writes from (`packages/platform-db/src/events-write.ts`, 2026-08-06 / D-23),
 * and they have to be: `parseList` below DROPS an unrecognised filter rather
 * than rejecting it, so an action the writer can produce and this list has not
 * heard of returns the whole feed instead of a 400. That is not hypothetical —
 * it is what Phase 4's `app_*` actions did here for months.
 */
export interface ActivityContribution {
  /**
   * WHERE THIS APP'S EVENTS LIVE — see `../event-source.ts`.
   *
   * Required, with no default (Phase 3, 2026-08-10). `platform.events` used to
   * hold every app's rows; `apps/sales` now writes `sales.events`, and a
   * default here would mean an app serving another app's feed for a workspace
   * id that means a different team. `apps/issues` supplies
   * `platformEventSource(db)`, which is the call this route already made.
   */
  events: EventSource

  /** This app's own entity types, beyond the platform ones above. */
  entityTypes?: readonly string[]
  /** This app's own actions, beyond the platform ones above. */
  actions?: readonly string[]
  /**
   * Entity types whose `entity_id` is an internal row id that MUST be replaced
   * by the workspace #number before it leaves the server.
   *
   * Separate from `entityTypes` on purpose. A type listed here but missing from
   * `resolveEntitySeqs`' answer — a purged row — has its id replaced with
   * `meta.seq` or null, never passed through. A type NOT listed here keeps its
   * own-domain id, which is correct for comments and labels. Getting this list
   * wrong is how an internal serial reaches an agent, and once it does it ends
   * up in a script and becomes a contract.
   */
  numberedEntityTypes?: readonly string[]
  /**
   * `${entity_type}:${entity_id}` → workspace #number, for the rows on this page.
   * Only the app can answer this: it means reading the app's own tables.
   */
  resolveEntitySeqs(
    rows: Array<{ entity_type: string; entity_id: number }>
  ): Promise<Map<string, number>>
}

type EventRow = Record<string, unknown>

/**
 * Expose `entity_id` as the #number for the app's numbered entities.
 *
 * Exported because it IS the wire contract — `apps/issues` pins it against a
 * frozen copy of the pre-extraction implementation
 * (`lib/api/activity-serialization.test.ts`), which is the only thing standing
 * between a serializer move and a silently changed response field.
 *
 * The fallback chain is load-bearing and unchanged from the pre-extraction
 * version: the seq map first, then the event's own `meta.seq` (recorded at write
 * time, so it survives the row being purged), then null. Never the raw id.
 *
 * ---------------------------------------------------------------------------
 * THE FOURTH ARGUMENT, AND THE BUG IT CLOSES (2026-08-07)
 * ---------------------------------------------------------------------------
 * This feed is MERGED: `platform.events` holds every app's rows, and every
 * deployment serves the whole thing. But `numberedEntityTypes` and
 * `resolveEntitySeqs` describe the MOUNTING app, and only it can read its own
 * tables. So a row belonging to another app fell through untouched and its
 * `entity_id` — an internal serial — went out on the wire:
 *
 *     via issues:3000    sales   created  prospect  29    ← sales' row id
 *     via sales:3100     sales   created  prospect  9     ← the #number
 *     via sales:3100     issues  created  issue     #727  ← issues' row id
 *     via issues:3000    issues  created  issue     #3    ← the #number
 *
 * Each host got its OWN app right and the other wrong, and `bk activity` prints
 * a `#` in front of it either way — so a serial was presented AS a #number,
 * which is worse than omitting it. "The serial `id` is never exposed — not in a
 * route, not in CLI output, not in a URL" is one of the platform's oldest rules.
 *
 * The fix needs no cross-schema read, which is the whole reason it is possible:
 * `platform.events.subject_urn` was written by the producing app, in the same
 * transaction as the row, and the #number is IN it.
 *
 * **Where a foreign row has no `subject_urn`, the answer is null and not a
 * fallback.** An unprojected type has no #number to report, and nothing is
 * better than a plausible wrong number — that is the entire finding.
 *
 * `appSlug` is optional so the frozen pinning test keeps calling this with three
 * arguments and keeps proving the LOCAL path is byte-identical. Omitting it
 * means "every row is local", which is what a single-app world was.
 *
 * It also closes a latent one: `numbered.has(type)` never consulted the row's
 * app, so a foreign row whose type name matched a local type would have been
 * resolved against the WRONG TABLE and reported a confidently wrong #number.
 * No two apps share a type name today. That is not a guarantee.
 */
export function publicEventIds(
  row: EventRow,
  seqMap: Map<string, number>,
  numbered: ReadonlySet<string>,
  appSlug?: string
): EventRow {
  const type = row.entity_type as string
  const eid = row.entity_id as number | null

  const rowApp = row.app as string | null | undefined
  if (appSlug && rowApp && rowApp !== appSlug) {
    // Another app's row. This deployment cannot resolve its id and must not try.
    const parsed = typeof row.subject_urn === 'string' ? parseUrn(row.subject_urn) : null
    return { ...row, entity_id: parsed ? parsed.number : null }
  }

  if (numbered.has(type) && eid != null) {
    const meta = row.meta as { seq?: number } | null
    return { ...row, entity_id: seqMap.get(`${type}:${eid}`) ?? meta?.seq ?? null }
  }
  return row
}

function parseList(raw: string | null, allowed: ReadonlySet<string>): string[] | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Undefined for an unrecognised value, which DROPS the filter. That is the
  // pre-existing behaviour and it is not great — Phase 4's app_* actions were
  // missing from the allow-list for months, so `?action=app_access_granted`
  // silently returned the whole feed. Kept identical here because this is a
  // move; the allow-lists themselves are now assembled from the platform set
  // plus the app's, which is what stopped that particular hole recurring.
  for (const p of parts) {
    if (!allowed.has(p)) return undefined
  }
  return parts
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function parseCsv(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

// A relative window: <number><m|h|d>. Deliberately not a general date parser —
// `from` already takes an absolute timestamp, and a lenient parser here would
// turn a typo into a silently wrong window rather than a 400.
const DURATION_RE = /^(\d+)\s*(m|h|d)$/i
const DURATION_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

function parseDuration(raw: string): number | null {
  const m = DURATION_RE.exec(raw.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return n * DURATION_MS[m[2].toLowerCase()]
}

function parseInts(raw: string | null): number[] | undefined {
  if (!raw) return undefined
  const out: number[] = []
  for (const p of raw.split(',').map((s) => s.trim())) {
    const n = parseInt(p)
    if (!Number.isNaN(n)) out.push(n)
  }
  return out.length > 0 ? out : undefined
}

export function activityRoute(app: AppContext, contribution: ActivityContribution) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const entityTypes = new Set<string>([
    ...PLATFORM_ENTITY_TYPES,
    ...(contribution.entityTypes ?? []),
  ])
  const actions = new Set<string>([...PLATFORM_EVENT_ACTIONS, ...(contribution.actions ?? [])])
  const numbered = new Set<string>(contribution.numberedEntityTypes ?? [])

  return apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)

    const sp = req.nextUrl.searchParams
    const cursor = sp.get('cursor') ? parseInt(sp.get('cursor')!) : null
    if (cursor !== null && Number.isNaN(cursor)) {
      throw Errors.badRequest('invalid_cursor', 'cursor must be an integer')
    }
    const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      throw Errors.badRequest('invalid_limit', 'limit must be a positive integer')
    }

    // `since` is a relative window (24h, 7d, 90m) — the shape `bk activity --since`
    // takes. It resolves to the same `from` filter; passing both is a caller error
    // rather than a silent precedence rule nobody would guess.
    const sinceRaw = sp.get('since')
    if (sinceRaw && sp.get('from')) {
      throw Errors.badRequest(
        'since_and_from',
        'pass either since or from, not both',
        'since is a relative window (24h); from is an absolute timestamp'
      )
    }
    let fromOccurredAt = parseDate(sp.get('from'))
    if (sinceRaw) {
      const ms = parseDuration(sinceRaw)
      if (ms === null) {
        throw Errors.badRequest(
          'invalid_since',
          `since must be a duration like 30m, 24h or 7d — got ${sinceRaw}`,
          'use m (minutes), h (hours) or d (days)'
        )
      }
      fromOccurredAt = new Date(Date.now() - ms)
    }

    const page = await contribution.events.list({
      workspaceId: ctx.workspace.id,
      actorUserIds: parseInts(sp.get('actor')),
      entityTypes: parseList(sp.get('entity_type'), entityTypes),
      actions: parseList(sp.get('action'), actions),
      apps: parseCsv(sp.get('app')),
      subjectUrn: sp.get('subject_urn') ?? undefined,
      fromOccurredAt,
      toOccurredAt: parseDate(sp.get('to')),
      cursor,
      limit,
    })

    const seqMap = await contribution.resolveEntitySeqs(
      page.data as unknown as Array<{ entity_type: string; entity_id: number }>
    )
    return NextResponse.json({
      data: (page.data as unknown as EventRow[]).map((e) =>
        publicEventIds(e, seqMap, numbered, app.appSlug)
      ),
      next_cursor: page.next_cursor,
    })
  })
}
