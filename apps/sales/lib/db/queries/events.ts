// This app's event spine — `sales.events`, since Phase 3.
//
// ---------------------------------------------------------------------------
// IT IS THIS APP'S TABLE NOW, AND THAT REMOVED A SEAM RATHER THAN MOVING IT
// ---------------------------------------------------------------------------
// Until 2026-08-10 this wrote `platform.events`, one table holding every app's
// activity, and it delegated four entity types — workspace, workspace_member,
// workspace_app, invitation — to `recordPlatformEvent` in @blackcode/platform-db
// (D-23). That delegation existed because those four rows are about PLATFORM
// subjects: a shared workspace, a membership in it, an invitation to it.
//
// None of that is true here any more. A workspace is `sales.workspaces`, a
// membership is `sales.workspace_members`, an invitation is `sales.invitations`
// — this app's rows, in this app's schema — and an event about one of them has
// to land in this app's table beside the rest. So the delegation is GONE, and
// with it the split: there is one recorder, writing one table.
//
// **The two VOCABULARIES are still imported, not restated.** `PLATFORM_ENTITY_
// TYPES` and `PLATFORM_EVENT_ACTIONS` remain the platform's lists because the
// shared activity route validates `?entity_type=` and `?action=` against them,
// and that route DROPS an unrecognised filter rather than rejecting it — so a
// second copy here would fail by silently returning the whole feed. What moved
// is where the row goes, not what a row may say.
//
// ---------------------------------------------------------------------------
// THREE DIFFERENCES FROM THE ISSUES RECORDER, EACH DELIBERATE
// ---------------------------------------------------------------------------
// 1. **No fan-out.** `platform.inbox_messages` is fed by watchers, mentions and
//    assignment notifications, and sales has none of them in v1: D-13 removed
//    platform comments from this app, so there is nothing to be mentioned in and
//    nobody watching. A fan-out call here would be a call into a rule set that
//    does not exist. When assignment notifications arrive, they arrive as a
//    `fanout.ts` beside this file — not as a shared one, because "everyone
//    watching this prospect" is this app's sentence. (Note that dropping the
//    `recordPlatformEvent` delegation dropped `fanOutPlatformEvent` with it, and
//    that changes nothing: this app has no inbox, and the four platform actions
//    that fan out there are ABOUT a platform workspace, which this app no longer
//    has.)
//
// 2. **No coalescing.** The issues recorder collapses consecutive `updated`
//    events because its web UI autosaves every ~1.2s while a human types. This
//    app is agent-written (the doctrine, `docs/backend.md` §1): writes arrive as
//    discrete commands, one per intent, and merging two of them would merge two
//    decisions. If the Phase 7 web surface ever autosaves prose, add it then,
//    with the window it actually needs.
//
// 3. **`actorTokenId` is populated**, from `lib/actor.ts`. It is a column both
//    apps have and only this one fills, because §3.4's "by Andrea / by
//    Companion" attribution is a validated feature here.
//
// MUST be called inside the transaction that produces the mutation. The database
// has no event triggers, by design — the application layer is the only place an
// event is invented — so a mutation that commits without its event has lost it
// permanently.

import {
  type PlatformEntityType,
  type PlatformEventAction,
  type PlatformTx,
} from '@blackcode/platform-db'
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import {
  communications,
  documents,
  meetings,
  products,
  prospects,
  salesEvents,
  salesWorkspaces,
  templates,
} from '../schema'
import type { SalesEvent, NewSalesEvent } from '../schema'
import { users } from '../schema'
import type { EventSource, EventsPage, ListEventsFilter } from '@blackcode/platform-api'
import { APP_SLUG } from '@/lib/app'
import { getDb } from '../client'
import { ENTITY_TYPES, entityUrnOrNull, type SalesEntityType } from '@/lib/entity-address'

/**
 * What an event can be about.
 *
 * The platform half is IMPORTED, never restated (D-23): the same list is what
 * `recordPlatformEvent` accepts and what the shared activity route validates
 * `?entity_type=` against, and that route DROPS an unrecognised filter rather
 * than rejecting it — so a third copy here would fail by silently returning the
 * whole feed.
 *
 * The sales half includes types that are NOT projected into `platform.entities`
 * (`contact`, `stage_entry`, `objection`, `match`). That is not an
 * inconsistency: an event is about something that happened, and "a contact was
 * added to StaffUp" happened whether or not a contact has its own address.
 * Those events simply carry `subject_urn: null` — see `resolveSubjectUrn`.
 *
 * ── AN ARRAY, AND THE UNION IS DERIVED FROM IT (2026-08-07) ─────────────────
 * `GET …/activity` has to validate `?entity_type=` at RUNTIME, and it DROPS an
 * unrecognised value rather than rejecting it — so a type this recorder can
 * write and that filter has not heard of returns the whole feed instead of a
 * 400. That is not hypothetical: it is what issues' `app_*` actions did for
 * months (`packages/platform-api/src/routes/activity.ts`).
 *
 * A `const` array beside the union would be a second list, and the failure of
 * the two disagreeing is silence. So the array is the ONLY list and the union
 * reads off it. There is nothing here for a test to hold together, which is
 * better than a test: `tsc` cannot let them drift.
 */
export const SALES_EVENT_ENTITY_TYPES = [
  'prospect',
  'contact',
  'stage_entry',
  'meeting',
  'communication',
  'objection',
  'product',
  'template',
  'document',
  'match',
  'label',
] as const

export type EntityType = PlatformEntityType | (typeof SALES_EVENT_ENTITY_TYPES)[number]

/**
 * What happened.
 *
 * Only actions this app actually writes are listed. A speculative member costs
 * nothing at the type level and quite a lot in a reader's head: it reads as a
 * feature that exists. Adding one when the noun that emits it lands is one line.
 *
 * An array with the union derived from it, for the reason above `EntityType`.
 */
export const SALES_EVENT_ACTIONS = [
  // prospect (Phase 5)
  'stage_changed',
  'assigned',
  'unassigned',
  'next_action_changed',
  'labeled',
  'unlabeled',
  // the recycle bin
  'restored',
  'purged',
] as const

export type EventAction = PlatformEventAction | (typeof SALES_EVENT_ACTIONS)[number]

export interface RecordEventInput {
  workspaceId: number
  actorUserId?: number | null
  actorTokenId?: number | null
  entityType: EntityType
  entityId: number
  action: EventAction
  diff?: { before?: unknown; after?: unknown } | null
  meta?: Record<string, unknown> | null
  idempotencyKey?: string | null
  occurredAt?: Date
  /**
   * Override the cross-app subject address.
   *
   * Leave it unset and `recordEvent` derives it from (entityType, entityId),
   * which is what every call site should do. Pass it explicitly only when the
   * subject row is already gone by the time the event is recorded (a purge),
   * because then there is nothing left to derive it from. Pass `null` to state
   * that this event has no addressable subject.
   */
  subjectUrn?: string | null
}

/**
 * Record one event inside the caller's transaction.
 *
 * ONE table, ONE path — including the platform entity types. Until Phase 3 the
 * four of them were delegated to `recordPlatformEvent`, which writes
 * `platform.events`; that row's `workspace_id` has a foreign key on
 * `platform.workspaces`, so after Phase 2 it would either fail loudly or land
 * against another tenant's workspace that happened to share the number. Neither
 * is a thing to keep. A sales workspace's events belong in sales' feed.
 *
 * There is no `app` column to fill: `platform.events.app` recorded WHICH app
 * produced a row in a shared table, and the schema name answers that here.
 * `salesEventSource` re-attaches it on the READ side, because it is still a
 * field on the wire that `bk activity` prints.
 */
export async function recordEvent(tx: PlatformTx, input: RecordEventInput): Promise<SalesEvent> {
  const subjectUrn =
    input.subjectUrn !== undefined
      ? input.subjectUrn
      : await resolveSubjectUrn(tx, input.workspaceId, input.entityType, input.entityId)

  const values: NewSalesEvent = {
    workspace_id: input.workspaceId,
    subject_urn: subjectUrn,
    actor_user_id: input.actorUserId ?? null,
    actor_token_id: input.actorTokenId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    diff: input.diff ?? null,
    meta: input.meta ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    occurred_at: input.occurredAt ?? new Date(),
  }
  const [row] = await tx.insert(salesEvents).values(values).returning()
  if (!row) throw new Error('event insert returned nothing')
  // NO FAN-OUT. See difference (1) in the header — this is an absence with a
  // reason, not a line somebody forgot.
  return row
}

// ---------------------------------------------------------------------------
// THE SUBJECT URN — DERIVED FROM `sales.*`, NOT LOOKED UP IN A SHARED INDEX
// ---------------------------------------------------------------------------
// `sales.events.subject_urn` is KEPT (Phase 3's open question from agent 2), and
// this is why it could be: a URN is `bc:<app>:<workspace-slug>/<type>/<number>`,
// and every part of that is in `sales.*`. `platform.entities` was where it used
// to be looked UP; it was never what made it true. The projection is gone and
// the address is not.
//
// Keeping it keeps `?subject_urn=` on the activity route and `bk activity
// --subject` working against this app — a read surface with a flag behind it,
// and the column costs one text field on a table that had no rows.
//
// The contract is narrow and strict: **null, never a throw.** This runs inside
// every create, update and delete this app performs, and a URN that cannot be
// built must cost an untagged event rather than a failed write.
//
// Null is also the CORRECT answer, not a gap, for the four sales entity types
// with no #number — a contact, a stage entry, an objection and a match are all
// reached through their prospect and have no address of their own. `entityType`
// is a plain string for exactly that reason: the caller's union is wider than
// the addressable six, and narrowing it is the whole job.

/** The source table behind each addressable type. `Record<>` so a seventh is a compile error. */
const URN_SOURCE: Record<SalesEntityType, typeof prospects | typeof meetings | typeof communications | typeof products | typeof templates | typeof documents> = {
  prospect: prospects,
  meeting: meetings,
  communication: communications,
  product: products,
  template: templates,
  document: documents,
}

function isAddressableType(t: string): t is SalesEntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t)
}

export async function resolveSubjectUrn(
  tx: PlatformTx,
  workspaceId: number,
  entityType: string,
  entityId: number
): Promise<string | null> {
  if (!isAddressableType(entityType)) return null
  const table = URN_SOURCE[entityType]
  // `sales.workspaces`, not `platform.workspaces`: the slug in a sales URN is
  // this app's workspace slug, and after Phase 2 the two tables are different
  // things that happen to share some ids.
  const res = await tx.execute(sql`
    SELECT w.slug AS slug, x.seq AS seq
    FROM ${table} x
    JOIN ${salesWorkspaces} w ON w.id = x.workspace_id
    WHERE x.id = ${entityId} AND x.workspace_id = ${workspaceId}
    LIMIT 1
  `)
  const row = res.rows[0]
  if (!row || row.seq == null) return null
  return entityUrnOrNull(String(row.slug), entityType, Number(row.seq))
}

// ---------------------------------------------------------------------------
// THE READ HALF — this app's activity feed
// ---------------------------------------------------------------------------
// `GET /api/workspaces/{ws}/activity` is still the shared factory: the filters,
// the cursor, the envelope and the #number substitution are the same everywhere.
// What it can no longer do for itself is name the table, so the mount supplies
// this (`EventSource`, packages/platform-api/src/event-source.ts).
//
// TWO THINGS IT DOES THAT A NAIVE PORT WOULD NOT:
//
//  1. **It answers `app`.** `sales.events` has no such column — the schema name
//     is the answer — but `app` is a FIELD ON THE WIRE that `bk activity`
//     prints, and a column that silently went empty would read as "unknown app"
//     rather than "this one". It is a constant, which is what it always meant.
//
//  2. **`?app=` filters, rather than being ignored.** A caller asking for
//     another app's rows gets an empty page, because this deployment genuinely
//     has none of them. Dropping the filter would return THIS app's feed to
//     somebody who asked for a different one, which is the same failure shape as
//     `parseList` silently dropping an unrecognised `?action=`.

const publicEventApp = APP_SLUG

export const salesEventSource: EventSource = {
  async list(filter: ListEventsFilter): Promise<EventsPage> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)

    // See (2) above: this app produces exactly one app's events.
    if (filter.apps && filter.apps.length > 0 && !filter.apps.includes(publicEventApp)) {
      return { data: [], next_cursor: null }
    }

    const wheres = [eq(salesEvents.workspace_id, filter.workspaceId)]
    if (filter.actorUserIds?.length) {
      wheres.push(inArray(salesEvents.actor_user_id, filter.actorUserIds))
    }
    if (filter.entityTypes?.length) {
      wheres.push(inArray(salesEvents.entity_type, filter.entityTypes))
    }
    if (filter.actions?.length) wheres.push(inArray(salesEvents.action, filter.actions))
    if (filter.subjectUrn) wheres.push(eq(salesEvents.subject_urn, filter.subjectUrn))
    if (filter.fromOccurredAt) wheres.push(gte(salesEvents.occurred_at, filter.fromOccurredAt))
    if (filter.toOccurredAt) wheres.push(lte(salesEvents.occurred_at, filter.toOccurredAt))
    if (filter.cursor) wheres.push(lt(salesEvents.id, filter.cursor))

    const rows = await getDb()
      .select({ e: salesEvents, actor_name: users.name, actor_email: users.email })
      .from(salesEvents)
      // LEFT, not INNER: `actor_user_id` is null for anything an agent did with
      // a token and no user behind it, and an inner join would drop those rows
      // from the feed entirely.
      .leftJoin(users, eq(users.id, salesEvents.actor_user_id))
      .where(and(...wheres))
      .orderBy(desc(salesEvents.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const data = rows.slice(0, limit).map((r) => ({
      ...r.e,
      app: publicEventApp,
      actor_name: r.actor_name,
      actor_email: r.actor_email,
    }))
    return {
      data: data as unknown as EventsPage['data'],
      next_cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
    }
  },
}

// ---------------------------------------------------------------------------
// The READ half's one app-shaped question (D-22)
// ---------------------------------------------------------------------------

/** Which table carries the #number for each projected type. */
const SEQ_SOURCE = {
  prospect: prospects,
  meeting: meetings,
  communication: communications,
  product: products,
  template: templates,
  document: documents,
} as const satisfies Record<SalesEntityType, unknown>

/**
 * `${entity_type}:${entity_id}` → the workspace #number, for the rows on one
 * page of the activity feed.
 *
 * This is the whole of what `activityRoute` cannot do for itself: an event's
 * `entity_id` is an internal serial, the API must never serve one, and only this
 * app can read `sales.*` to swap it for the #number.
 *
 * **The keys are `ENTITY_TYPES`, derived, not a second list.** A seventh
 * projected type would otherwise be one that quietly kept serving its row id —
 * and a leaked serial does not look wrong, it looks like a number, which is how
 * it ends up in somebody's script and becomes a contract. The four types with no
 * #number (contact, stage entry, objection, match) are absent for the same reason
 * they are absent from the projection: their row id IS their address, so it is
 * correct to pass it through, and the route only substitutes for the types the
 * mount lists in `numberedEntityTypes`.
 */
export async function resolveEventEntitySeqs(
  rows: Array<{ entity_type: string; entity_id: number }>
): Promise<Map<string, number>> {
  const wanted = new Map<SalesEntityType, Set<number>>()
  for (const r of rows) {
    if (!(ENTITY_TYPES as readonly string[]).includes(r.entity_type)) continue
    if (r.entity_id == null) continue
    const type = r.entity_type as SalesEntityType
    const set = wanted.get(type) ?? new Set<number>()
    set.add(r.entity_id)
    wanted.set(type, set)
  }

  const db = getDb()
  const map = new Map<string, number>()
  for (const [type, ids] of wanted) {
    const table = SEQ_SOURCE[type]
    const found = await db
      .select({ id: table.id, seq: table.seq })
      .from(table)
      .where(inArray(table.id, [...ids]))
    for (const f of found) {
      if (f.seq != null) map.set(`${type}:${f.id}`, f.seq)
    }
  }
  return map
}
