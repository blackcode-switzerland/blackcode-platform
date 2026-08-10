// What every write path in this app owes, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=sales
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE REPLACED, AND WHY IT IS NOT SIMPLY GONE (Phase 3, 2026-08-10)
// ---------------------------------------------------------------------------
// It was `entities.integration.test.ts`, and its headline property was the
// cross-app projection: `projectEntity` inside the source write's transaction,
// asserted BOTH ways round. That projection no longer exists — this app stopped
// writing `platform.entities` — so those cases went with it.
//
// The rest did not, and deleting the file wholesale would have silently dropped
// two things that still matter and are not covered anywhere else:
//
//   * the #number allocator under concurrency, and
//   * **the blob-reference triggers**, which CLAUDE.md names as one of the two
//     things standing between a code change and unrecoverable data loss.
//
// So they moved here, and the same-transaction property moved WITH them, now
// asserted about the write it still applies to: `recordEvent`. There is no
// event trigger in the database, by design, so a mutation that commits without
// its event has lost it permanently — the identical failure shape the projection
// case was written for.
//
// ---------------------------------------------------------------------------
// WHY THE INCORRECT CASE IS ALSO ASSERTED
// ---------------------------------------------------------------------------
// "A rolled-back write leaves no event" passes just as well against a
// `recordEvent` that quietly does nothing at all, or against a database that
// rejected every insert. So the SAME sequence is written the WRONG way —
// `recordEvent(db, …)` instead of `recordEvent(tx, …)` — and the row is required
// to SURVIVE. D-26 step 3 made permanent: it is not enough to watch the correct
// case pass, the two spellings have to produce OBSERVABLY DIFFERENT results.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

// `describe.skip` prints one dimmed line and reports green. This says, on
// stderr, that nothing below was checked — and honours REQUIRE_INTEGRATION_TESTS
// for an environment that wants a missing database to be an error instead.
const run = integrationDescribe({
  describe,
  name: 'sales write paths: events + counters + blob triggers',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('sales write paths (integration)', () => {
  let db: ReturnType<(typeof import('../client'))['getDb']>
  let schema: typeof import('../schema')
  let eventsQ: typeof import('./events')
  let prospectsQ: typeof import('./prospects')
  let ledgerQ: typeof import('./ledger')
  let eq: (typeof import('drizzle-orm'))['eq']
  let and: (typeof import('drizzle-orm'))['and']

  const APP = 'sales'
  let suffix: string
  let ownerId: number
  let wsId: number
  let wsSlug: string

  const actor = () => ({ userId: ownerId, tokenId: null, label: 'Companion' })

  beforeAll(async () => {
    db = (await import('../client')).getDb()
    schema = await import('../schema')
    eventsQ = await import('./events')
    prospectsQ = await import('./prospects')
    ledgerQ = await import('./ledger')
    const orm = await import('drizzle-orm')
    eq = orm.eq
    and = orm.and

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `sales_wp_${suffix}@test.local`, name: 'Write Path Owner' })
      .returning({ id: schema.users.id })
    ownerId = owner!.id

    // Asserted, never created. Seeding the registry row here would hide a
    // database that had never run this app's migrations.
    const registered = await db.select().from(schema.apps).where(eq(schema.apps.slug, APP))
    expect(
      registered.length,
      `platform.apps has no '${APP}' row — is TEST_DATABASE_URL migrated and registered?`
    ).toBe(1)

    // `sales.workspaces`, not `platform.workspaces` (Phase 2): every table this
    // suite writes has a foreign key on the former.
    wsSlug = `sales-wp-${suffix}`.slice(0, 40)
    const [ws] = await db
      .insert(schema.salesWorkspaces)
      .values({ name: `Write Path WS ${suffix}`.slice(0, 80), slug: wsSlug, owner_id: ownerId })
      .returning({ id: schema.salesWorkspaces.id })
    wsId = ws!.id
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.salesWorkspaces).where(eq(schema.salesWorkspaces.id, wsId))
    if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId))
  })

  /** Rows in the SHARED index for one url — the table another app reads. */
  const blobRefs = async (url: string) => {
    const { sql } = await import('drizzle-orm')
    const res = await db.execute(
      sql`SELECT app, source_type, source_id FROM platform.blob_references WHERE url = ${url}`
    )
    return res.rows
  }

  const eventCount = async () =>
    (
      await db
        .select()
        .from(schema.salesEvents)
        .where(eq(schema.salesEvents.workspace_id, wsId))
    ).length

  // -------------------------------------------------------------------------
  // 1. THE SAME-TRANSACTION PROPERTY, BOTH WAYS ROUND
  // -------------------------------------------------------------------------

  it('a rolled-back write leaves NO event (recordEvent inside the tx)', async () => {
    const before = await eventCount()
    const marker = `rollback-${suffix}`

    await expect(
      db.transaction(async (tx) => {
        await eventsQ.recordEvent(tx, {
          workspaceId: wsId,
          actorUserId: ownerId,
          entityType: 'prospect',
          entityId: 999_000_001,
          action: 'created',
          meta: { marker },
          subjectUrn: null,
        })
        throw new Error('deliberate rollback')
      })
    ).rejects.toThrow('deliberate rollback')

    expect(await eventCount(), 'the event outlived the transaction that produced it').toBe(before)
  })

  it('THE CONTRAST: recordEvent on `db` SURVIVES the rollback (the bug this shape prevents)', async () => {
    const marker = `contrast-${suffix}`

    await expect(
      db.transaction(async () => {
        // `db`, not `tx` — the mistake. It opens its own implicit transaction and
        // commits independently of the caller's.
        await eventsQ.recordEvent(db as never, {
          workspaceId: wsId,
          actorUserId: ownerId,
          entityType: 'prospect',
          entityId: 999_000_002,
          action: 'created',
          meta: { marker },
          subjectUrn: null,
        })
        throw new Error('deliberate rollback')
      })
    ).rejects.toThrow('deliberate rollback')

    const orphans = await db
      .select()
      .from(schema.salesEvents)
      .where(
        and(
          eq(schema.salesEvents.workspace_id, wsId),
          eq(schema.salesEvents.entity_id, 999_000_002)
        )
      )
    expect(
      orphans.length,
      'the WRONG spelling no longer survives a rollback, so the case above has ' +
        'stopped proving anything about WHERE recordEvent is called'
    ).toBe(1)
    await db.delete(schema.salesEvents).where(eq(schema.salesEvents.id, orphans[0].id))
  })

  // -------------------------------------------------------------------------
  // 2. THE SUBJECT URN IS DERIVED FROM `sales.*` ALONE
  // -------------------------------------------------------------------------
  // The whole reason `sales.events.subject_urn` survived Phase 3: the address is
  // a fact about this app's tables, not a lookup in a shared index. If this goes
  // red after `platform.entities` was already emptied of sales rows, the column
  // was being filled from somewhere it should not have been.

  it('a create records an event whose subject_urn names the workspace slug and #number', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'Urn Derivation SA',
    })
    const rows = await db
      .select()
      .from(schema.salesEvents)
      .where(
        and(eq(schema.salesEvents.workspace_id, wsId), eq(schema.salesEvents.entity_id, p.id))
      )
    expect(rows.length, 'the create wrote no event at all').toBeGreaterThan(0)
    expect(rows[0].subject_urn).toBe(`bc:sales:${wsSlug}/prospect/${p.seq}`)
  })

  // -------------------------------------------------------------------------
  // 3. THE #NUMBER ALLOCATOR UNDER CONCURRENCY
  // -------------------------------------------------------------------------
  // The failure it guards is a `seq` COLLISION, and a collision is not a crash:
  // two prospects share a #number, `bc:sales:ws/prospect/7` resolves to whichever
  // the query happens to return, and every link to one of them is a coin flip.

  it('parallel creates allocate distinct #numbers (no counter collision)', async () => {
    const N = 8
    const created = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prospectsQ.createProspect({ workspaceId: wsId, actor: actor(), name: `Race ${i} SA` })
      )
    )
    const seqs = created.map((p) => p.seq)
    expect(seqs).toHaveLength(N)
    expect(
      new Set(seqs).size,
      `parallel creates produced a duplicate #number: ${seqs.join(', ')}`
    ).toBe(N)
    // Allocated with `UPDATE … RETURNING` inside the insert's transaction, never
    // read-then-write, so the run is contiguous as well as distinct. A gap would
    // mean an allocation escaped its transaction.
    const sorted = [...seqs].sort((a, b) => a - b)
    expect(sorted[N - 1] - sorted[0], `#numbers are not contiguous: ${sorted.join(', ')}`).toBe(
      N - 1
    )
  })

  // -------------------------------------------------------------------------
  // 4. THE BLOB-REFERENCE TRIGGERS  (§10.2 row 15)
  // -------------------------------------------------------------------------
  // THE del() PATH, and the one part of this app that is still genuinely
  // cross-app. `platform.blob_references` is how another deployment learns that
  // a file is still in use; a reference that is missing is a file another app
  // will delete while this one is still serving it, and Vercel Blob's del() has
  // no undo. Phase 3 moved the upload LEDGER to `sales.uploads` and deliberately
  // did not touch this index — which is exactly why it still has to be checked
  // here after the move.
  //
  // It is trigger-maintained precisely so no application write path can forget
  // it — which means the thing to test is NOT a function but the DATABASE.

  it('a communication body carrying an upload URL creates a blob reference', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'Blob Trigger SA',
    })
    const url = `/uploads/sales/${wsSlug}/${suffix}-trigger-probe.pdf`
    const c = await ledgerQ.logCommunication({
      workspaceId: wsId,
      prospectId: p.id,
      actor: actor(),
      channel: 'note',
      direction: 'out',
      occurredAt: new Date(),
      body: `the proposal is at ${url}`,
    })
    const refs = await blobRefs(url)
    expect(refs, `no platform.blob_references row for ${url}`).toHaveLength(1)
    expect(refs[0].app).toBe(APP)
    expect(refs[0].source_type).toBe('communication')
    expect(Number(refs[0].source_id)).toBe(c.id)

    // And it UNFIRES. A reference that outlives its row is a file no app will
    // ever delete; a reference that never appears is a file another app WILL.
    await db.delete(schema.communications).where(eq(schema.communications.id, c.id))
    expect(await blobRefs(url), 'the reference outlived the row that held it').toHaveLength(0)
  })

  it('THE CONTRAST: a body with no URL creates NO reference', async () => {
    // Without this, the assertion above passes against a trigger that indexes
    // every row it sees — which would report every communication as holding a
    // file and make every delete refuse. The pair is what proves the trigger
    // reads the body rather than firing on the row.
    const { sql } = await import('drizzle-orm')
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'No Blob SA',
    })
    const c = await ledgerQ.logCommunication({
      workspaceId: wsId,
      prospectId: p.id,
      actor: actor(),
      channel: 'note',
      direction: 'out',
      occurredAt: new Date(),
      body: 'no url in this one at all',
    })
    const res = await db.execute(
      sql`SELECT count(*)::int AS n FROM platform.blob_references
          WHERE app = ${APP} AND source_type = 'communication' AND source_id = ${c.id}`
    )
    expect(Number(res.rows[0].n)).toBe(0)
  })

  it('THE PREMISE: this suite actually wrote events', async () => {
    // Every "no event row" assertion above passes against a database where
    // recording never works. Assert the inputs before trusting the conclusions —
    // CLAUDE.md finding #5.
    expect(
      await eventCount(),
      'no events at all in this workspace, so the rollback assertions proved nothing'
    ).toBeGreaterThanOrEqual(3)
  })

  it('THE OTHER PREMISE: nothing here wrote a platform.entities row', async () => {
    // The projection is gone (Phase 3). If this workspace acquired one anyway,
    // a write path is still calling something that projects — and the delete
    // ritual that emptied `platform.entities` of sales rows would silently start
    // refilling it.
    const { sql } = await import('drizzle-orm')
    const res = await db.execute(
      sql`SELECT count(*)::int AS n FROM platform.entities WHERE app = ${APP} AND workspace_id = ${wsId}`
    )
    expect(
      Number(res.rows[0].n),
      'a sales write path is still projecting into platform.entities'
    ).toBe(0)
  })
})
