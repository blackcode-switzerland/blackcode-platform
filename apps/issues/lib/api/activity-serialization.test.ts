// The activity feed must serialize byte-identically after the Class-B move.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A FROZEN COPY AND NOT A LIVE DIFF
// ---------------------------------------------------------------------------
// The ask was "capture one real activity response before and after and diff
// them". There is no database in this suite, so the diff is done one layer down
// and made permanent instead of one-off: `LEGACY_PUBLIC_EVENT` below is the
// pre-move implementation, copied verbatim from
// `apps/issues/lib/api/serialize.ts` as it stood on 2026-08-06, and the shared
// factory's serializer is asserted to agree with it on every row of a page built
// to contain each case that behaves differently.
//
// A frozen copy is better than a captured response here, because a captured
// response only proves the two agreed on the rows that happened to exist that
// day. This one names the cases:
//
//   - a numbered entity present in the seq map        → #number
//   - a numbered entity ABSENT from the map, with     → meta.seq
//     meta.seq (a purged row)
//   - a numbered entity absent with no meta.seq       → null, NEVER the serial
//   - a non-numbered app entity (comment, label)      → its own id, untouched
//   - a platform entity (workspace, member, invite)   → untouched
//   - entity_id null                                  → untouched
//
// The third case is the one that matters most: an internal serial reaching an
// agent ends up in a script, and then it is a contract.
//
// DELETE THIS FILE only when the legacy copy stops being meaningful — i.e. when
// the shape deliberately changes and this test is updated in the same commit
// with a changelog entry saying so.
import { describe, expect, it } from 'vitest'
import { publicEventIds as publicEvent } from '@blackcode/platform-api/routes'

/** The pre-move implementation, verbatim. Do not "improve" it. */
type Row = Record<string, unknown>
function LEGACY_PUBLIC_EVENT(input: object, seqMap: Map<string, number>): Row {
  const row = input as Row
  const type = row.entity_type as string
  const eid = row.entity_id as number | null
  if ((type === 'issue' || type === 'task' || type === 'project') && eid != null) {
    const meta = row.meta as { seq?: number } | null
    return { ...row, entity_id: seqMap.get(`${type}:${eid}`) ?? meta?.seq ?? null }
  }
  return row
}

/** Exactly what apps/issues passes to the factory. */
const NUMBERED = new Set(['issue', 'task', 'project'])

const event = (over: Row): Row => ({
  id: 1,
  workspace_id: 3,
  app: 'issues',
  subject_urn: null,
  actor_user_id: 9,
  actor_token_id: null,
  entity_type: 'issue',
  entity_id: 4210,
  action: 'created',
  diff: null,
  meta: null,
  idempotency_key: null,
  occurred_at: new Date('2026-08-05T09:00:00Z'),
  actor_name: 'Ada',
  actor_email: 'ada@example.test',
  ...over,
})

const PAGE: Row[] = [
  // numbered, in the map
  event({ id: 1, entity_type: 'issue', entity_id: 4210 }),
  event({ id: 2, entity_type: 'task', entity_id: 88 }),
  event({ id: 3, entity_type: 'project', entity_id: 12 }),
  // numbered, purged — falls back to meta.seq
  event({ id: 4, entity_type: 'issue', entity_id: 9999, meta: { seq: 77 } }),
  // numbered, purged, no meta.seq — must be null, never 9998
  event({ id: 5, entity_type: 'issue', entity_id: 9998 }),
  // app entities that keep their own id
  event({ id: 6, entity_type: 'comment', entity_id: 501, action: 'commented' }),
  event({ id: 7, entity_type: 'label', entity_id: 22, action: 'labeled' }),
  event({ id: 8, entity_type: 'attachment', entity_id: 31, action: 'attached' }),
  // platform entities
  event({ id: 9, entity_type: 'workspace', entity_id: 3, action: 'updated' }),
  event({ id: 10, entity_type: 'workspace_member', entity_id: 9, action: 'member_added' }),
  event({ id: 11, entity_type: 'invitation', entity_id: 4, action: 'invitation_created' }),
  // HISTORICAL, and deliberately kept. Nothing writes `workspace_app` events any
  // more — the routes that did went with `platform.app_access` on 2026-08-10 —
  // but `platform.events` still HOLDS them, and an activity feed that cannot
  // render a row it is going to be handed is the bug. Do not delete this case
  // with the writer; it outlives it by exactly the retention of the table.
  event({
    id: 12,
    entity_type: 'workspace_app',
    entity_id: 3,
    action: 'app_access_granted',
    meta: { app: 'sales' },
  }),
  // null entity_id
  event({ id: 13, entity_type: 'issue', entity_id: null as unknown as number }),
]

const SEQ_MAP = new Map<string, number>([
  ['issue:4210', 482],
  ['task:88', 15],
  ['project:12', 3],
])

describe('activity feed serialization is unchanged by the Class-B move', () => {
  it('THE PREMISE: the page exercises rows the two could disagree on', () => {
    // Without this, "the two agree" is satisfied by a page of rows neither one
    // touches — the same vacuous pass the parity guard's input assertions exist
    // to prevent.
    const rewritten = PAGE.filter(
      (r) => LEGACY_PUBLIC_EVENT(r, SEQ_MAP).entity_id !== r.entity_id
    )
    expect(
      rewritten.map((r) => r.id),
      'no row in the fixture is rewritten by the serializer at all'
    ).toEqual([1, 2, 3, 4, 5])
  })

  it('every row serializes identically', () => {
    const before = PAGE.map((r) => LEGACY_PUBLIC_EVENT(r, SEQ_MAP))
    const after = PAGE.map((r) => publicEvent(r, SEQ_MAP, NUMBERED))
    // JSON, not toEqual: this is the wire format, and the question is whether a
    // client sees the same bytes.
    expect(JSON.stringify(after, null, 2)).toBe(JSON.stringify(before, null, 2))
  })

  it('never exposes the internal serial for a purged numbered entity', () => {
    const purged = publicEvent(
      event({ entity_type: 'issue', entity_id: 9998 }),
      SEQ_MAP,
      NUMBERED
    )
    expect(purged.entity_id, 'an internal row id reached the response').toBeNull()
  })
})

// ---------------------------------------------------------------------------
// THE MERGED FEED: ROWS THAT BELONG TO ANOTHER APP
// ---------------------------------------------------------------------------
// The shape above is frozen against the pre-extraction implementation and stays
// frozen. THIS block is the deliberate change of 2026-08-07, made in the same
// commit as the changelog entry, exactly as the header of this file requires.
//
// `platform.events` is merged and every deployment serves the whole thing, but
// `numberedEntityTypes` and `resolveEntitySeqs` describe the MOUNTING app. A
// foreign row therefore fell through with its `entity_id` intact — an internal
// serial, printed by `bk activity` with a `#` in front of it. Measured on a real
// pair of dev servers: the same feed reported prospect `29` from the issues host
// and `9` from the sales host, for one row whose #number is 9.
//
// The two assertions below are one property in two halves, and the master's
// instruction was explicit about why: "a fix that made both hosts agree by
// breaking the local one would look identical from one side."
describe('the merged feed does not leak another app\'s row ids', () => {
  const foreign = (over: Row = {}): Row =>
    event({
      app: 'sales',
      entity_type: 'prospect',
      entity_id: 29, // the sales serial
      subject_urn: 'bc:sales:acme/prospect/9', // …whose #number is 9
      ...over,
    })

  it('reports the #number from subject_urn, never the foreign serial', () => {
    const out = publicEvent(foreign(), SEQ_MAP, NUMBERED, 'issues')
    expect(out.entity_id, "another app's internal row id reached the response").toBe(9)
  })

  it('reports NOTHING when the foreign row has no subject_urn', () => {
    // An unprojected type has no #number to report. Nothing is better than a
    // plausible wrong number — falling back to entity_id here is the whole bug.
    const out = publicEvent(foreign({ subject_urn: null }), SEQ_MAP, NUMBERED, 'issues')
    expect(out.entity_id).toBeNull()
  })

  it('and a malformed subject_urn is also nothing, not a parse artefact', () => {
    const out = publicEvent(foreign({ subject_urn: 'not-a-urn' }), SEQ_MAP, NUMBERED, 'issues')
    expect(out.entity_id).toBeNull()
  })

  it('THE OTHER HALF: a LOCAL row is untouched by any of this', () => {
    // Same call, same app slug, a row that belongs here. If this ever changes,
    // the fix above achieved agreement by breaking the side that already worked
    // — which reads as success from the foreign side alone.
    const local = event({ app: 'issues', entity_type: 'issue', entity_id: 4210 })
    const withSlug = publicEvent(local, SEQ_MAP, NUMBERED, 'issues')
    const withoutSlug = publicEvent(local, SEQ_MAP, NUMBERED)
    expect(JSON.stringify(withSlug)).toBe(JSON.stringify(withoutSlug))
    expect(withSlug.entity_id).toBe(SEQ_MAP.get('issue:4210'))
  })

  it('a foreign row is NOT resolved against a local table of the same name', () => {
    // The latent one. `numbered.has(type)` never consulted the row's app, so a
    // foreign row whose type name matched a local type would have been looked up
    // in the WRONG table and reported a confidently wrong #number. No two apps
    // share a type name today; that is not a guarantee.
    const collision = event({
      app: 'sales',
      entity_type: 'issue', // a name this app also uses
      entity_id: 4210, // …and an id that IS in this app's seq map
      subject_urn: 'bc:sales:acme/issue/77',
    })
    const out = publicEvent(collision, SEQ_MAP, NUMBERED, 'issues')
    expect(out.entity_id, 'resolved a foreign row against this app\'s tables').toBe(77)
  })
})
