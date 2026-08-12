// Integration tests for the cross-app entity projection (Phase 6). These hit a
// real Postgres, so they only run when TEST_DATABASE_URL is set (pointed at a
// throwaway/test DB with the migrations applied). They never touch DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHY THESE EXIST, AND WHY THEY ASSERT COUNTS RATHER THAN "IT RETURNED SOMETHING"
// ---------------------------------------------------------------------------
// Phase 3 failed loudly. Phase 4 failed quietly. Phase 6 fails SLOWLY.
//
// `platform.entities` is derived data. If a write path forgets to project,
// nothing breaks today: `bk search` returns a slightly stale set, `bk activity`
// misses an entry, and nobody notices for weeks — by which point you cannot tell
// which rows are wrong. There is no exception to catch and no 500 to alert on.
//
// So the assertions here are of two kinds only:
//
//   1. The SAME-TRANSACTION property, asserted directly: a source write that
//      rolls back must leave no projection row. This is the one guarantee that
//      makes the projection trustworthy at all, and it is a property of *how*
//      projectEntity is called, which no amount of reading the code proves.
//   2. COUNTS MATCH, per type, via the reconciler — not "search found a result".
//      A search that returns something is compatible with half the rows being
//      missing. `drift: []` is not.
//
// The lifecycle cases in between (soft delete, restore, purge, rename) exist
// because each one is a path where an earlier phase's code was written before
// entities existed, and each one had to be edited by hand.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
// Point the db client at the test DB before it is imported.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

run('cross-app entity projection (integration)', () => {
  let db: typeof import('../client')['db']
  let schema: typeof import('../schema')
  let workspacesQ: typeof import('./workspaces')
  let issuesQ: typeof import('./issues')
  let tasksQ: typeof import('./tasks')
  let projectsQ: typeof import('./projects')
  let deletionQ: typeof import('./deletion')
  let entitiesQ: typeof import('./entities')
  let platformDb: typeof import('@blackcode/platform-db')
  let eq: typeof import('drizzle-orm')['eq']
  let and: typeof import('drizzle-orm')['and']

  const APP = 'issues'
  let suffix: string
  let ownerId: number
  let wsId: number
  let wsSlug: string

  beforeAll(async () => {
    db = (await import('../client')).db
    schema = await import('../schema')
    workspacesQ = await import('./workspaces')
    issuesQ = await import('./issues')
    tasksQ = await import('./tasks')
    projectsQ = await import('./projects')
    deletionQ = await import('./deletion')
    entitiesQ = await import('./entities')
    platformDb = await import('@blackcode/platform-db')
    const orm = await import('drizzle-orm')
    eq = orm.eq
    and = orm.and

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `entities_owner_${suffix}@test.local`, name: 'Entities Owner' })
      .returning({ id: schema.users.id })
    ownerId = owner.id

    // Assert rather than create: a test that silently seeded the registry row
    // would hide a database that had never been migrated past 0034.
    const registered = await db.select().from(schema.apps).where(eq(schema.apps.slug, APP))
    expect(
      registered.length,
      `platform.apps has no '${APP}' row — is TEST_DATABASE_URL migrated?`
    ).toBe(1)

    const ws = await workspacesQ.createWorkspace({ name: `Entities WS ${suffix}`, ownerId })
    wsId = ws.id
    wsSlug = ws.slug
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsId))
    if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId))
  })

  async function entityByUrn(urn: string) {
    const rows = await db.select().from(schema.entities).where(eq(schema.entities.urn, urn))
    return rows[0] ?? null
  }

  async function projectionCount() {
    const rows = await db
      .select()
      .from(schema.entities)
      .where(and(eq(schema.entities.workspace_id, wsId), eq(schema.entities.app, APP)))
    return rows.length
  }

  // ---- 1. THE SAME-TRANSACTION PROPERTY ----

  it('a rolled-back source write leaves NO projection row', async () => {
    const before = await projectionCount()

    // Do exactly what createIssue does — allocate a seq, insert, project — and
    // then throw. If projectEntity opened its own transaction (or ran after the
    // caller's), the entities row would survive this and the projection would
    // permanently describe an issue that was never created.
    let seq = 0
    await expect(
      db.transaction(async (tx) => {
        seq = await workspacesQ.allocateNextIssueSeq(tx, wsId)
        await tx
          .insert(schema.issues)
          .values({ workspace_id: wsId, seq, title: 'Rolled back', reporter_id: ownerId })
        await entitiesQ.projectEntity(tx, {
          workspaceId: wsId,
          entityType: 'issue',
          number: seq,
          title: 'Rolled back',
        })
        // Prove the row IS there inside the transaction, so a passing test
        // cannot be one where projectEntity quietly did nothing at all.
        const inside = await tx
          .select()
          .from(schema.entities)
          .where(eq(schema.entities.urn, `bc:issues:${wsSlug}/issue/${seq}`))
        expect(inside.length, 'projection must exist inside the transaction').toBe(1)
        throw new Error('deliberate rollback')
      })
    ).rejects.toThrow('deliberate rollback')

    expect(await entityByUrn(`bc:issues:${wsSlug}/issue/${seq}`)).toBeNull()
    expect(await projectionCount()).toBe(before)
  })

  // ---- 2. CREATE / UPDATE ----

  it('creating an issue projects it with the #number, not the row id', async () => {
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Projected issue',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const urn = `bc:issues:${wsSlug}/issue/${issue.seq}`
    const row = await entityByUrn(urn)
    expect(row, `no projection for ${urn}`).not.toBeNull()
    expect(row!.title).toBe('Projected issue')
    expect(row!.number).toBe(issue.seq)
    expect(row!.deleted_at).toBeNull()
    // The url must point at the dashboard route, ending in the #number.
    expect(row!.url).toContain(`/dashboard/${wsSlug}/issues/${issue.seq}`)
    // ...and must NOT be addressable by the internal id, which is the rule the
    // whole URN scheme rests on.
    expect(await entityByUrn(`bc:issues:${wsSlug}/issue/${issue.id}`)).toBeNull()
  })

  it('tasks and projects project too', async () => {
    const task = await tasksQ.createTask({
      workspaceId: wsId,
      name: 'Projected task',
      actorUserId: ownerId,
    })
    const project = await projectsQ.createProject({
      workspaceId: wsId,
      name: 'Projected project',
      actorUserId: ownerId,
    })
    expect(await entityByUrn(`bc:issues:${wsSlug}/task/${task.seq}`)).not.toBeNull()
    expect(await entityByUrn(`bc:issues:${wsSlug}/project/${project.seq}`)).not.toBeNull()
  })

  it('renaming an issue updates the projected title', async () => {
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Before rename',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    await issuesQ.updateIssue(wsId, issue.id, { title: 'After rename' }, ownerId)
    const row = await entityByUrn(`bc:issues:${wsSlug}/issue/${issue.seq}`)
    expect(row!.title).toBe('After rename')
  })

  // ---- 3. LIFECYCLE: BIN, RESTORE, PURGE ----

  it('binning mirrors deleted_at; restoring clears it; the row survives both', async () => {
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Bin me',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const urn = `bc:issues:${wsSlug}/issue/${issue.seq}`

    await deletionQ.softDeleteIssue(wsId, issue.id, ownerId)
    const binned = await entityByUrn(urn)
    expect(binned, 'the projection row must SURVIVE a soft delete').not.toBeNull()
    expect(binned!.deleted_at, 'and must be flagged as binned').not.toBeNull()

    await deletionQ.restoreItems(wsId, [{ type: 'issue', id: issue.id }], ownerId)
    expect((await entityByUrn(urn))!.deleted_at).toBeNull()
  })

  it('a cascade bin also flags the children — the case a per-row call would miss', async () => {
    const project = await projectsQ.createProject({
      workspaceId: wsId,
      name: 'Cascade parent',
      actorUserId: ownerId,
    })
    const child = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Cascade child',
      projectId: project.id,
      reporterId: ownerId,
      actorUserId: ownerId,
    })

    await deletionQ.softDeleteProject(wsId, project.id, ownerId, 'cascade')

    expect(
      (await entityByUrn(`bc:issues:${wsSlug}/project/${project.seq}`))!.deleted_at
    ).not.toBeNull()
    expect(
      (await entityByUrn(`bc:issues:${wsSlug}/issue/${child.seq}`))!.deleted_at,
      'the cascaded child must be flagged too, or it stays searchable while binned'
    ).not.toBeNull()
  })

  it('purging removes the projection row outright; a soft delete leaves it', async () => {
    const a = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Purge me',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const b = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Survivor',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const urnA = `bc:issues:${wsSlug}/issue/${a.seq}`
    const urnB = `bc:issues:${wsSlug}/issue/${b.seq}`

    await deletionQ.softDeleteIssue(wsId, a.id, ownerId)
    const binned = await entityByUrn(urnA)
    expect(
      binned,
      'a soft delete keeps the row — the recycle bin has to be able to restore it'
    ).not.toBeNull()
    expect(binned!.deleted_at).not.toBeNull()

    await deletionQ.purgeItems(wsId, [{ type: 'issue', id: a.id }], ownerId)
    expect(await entityByUrn(urnA), 'but a purge is permanent').toBeNull()
    expect(await entityByUrn(urnB), 'and the other issue is untouched').not.toBeNull()
  })

  // ---- 4. RENAME: THE PROPERTY THE FOREIGN KEYS PROVIDE ----

  it('a workspace rename rewrites every urn in place, by cascade', async () => {
    const ws = await workspacesQ.createWorkspace({ name: `Rename WS ${suffix}`, ownerId })
    try {
      const a = await issuesQ.createIssue({
        workspaceId: ws.id,
        title: 'Rename A',
        reporterId: ownerId,
        actorUserId: ownerId,
      })
      const b = await issuesQ.createIssue({
        workspaceId: ws.id,
        title: 'Rename B',
        reporterId: ownerId,
        actorUserId: ownerId,
      })

      const renamed = await workspacesQ.updateWorkspace(ws.id, { slug: `renamed-${suffix}` }, ownerId)
      const newSlug = renamed!.slug

      // Old URN gone, new URN present — one row, not two.
      expect(await entityByUrn(`bc:issues:${ws.slug}/issue/${a.seq}`)).toBeNull()
      const moved = await entityByUrn(`bc:issues:${newSlug}/issue/${a.seq}`)
      expect(moved).not.toBeNull()
      expect(moved!.url).toContain(`/dashboard/${newSlug}/issues/${a.seq}`)

      // Every row moves, not just the one we looked at — the rename is one
      // cascading UPDATE, so a partial result would mean the projection had
      // written a urn it should have derived.
      expect(await entityByUrn(`bc:issues:${newSlug}/issue/${b.seq}`)).not.toBeNull()
      expect(await entityByUrn(`bc:issues:${ws.slug}/issue/${b.seq}`)).toBeNull()
    } finally {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id))
    }
  })

  // ---- 5. LINK INVARIANTS — GONE ----
  //
  // Two cases lived here — "refuses a link to an unknown URN, to itself, or
  // across workspaces", and "creating the same link twice is not an error" —
  // and both exercised `platform.links` through `createLink`/`deleteLink`.
  // Those helpers were deleted on 2026-08-12 with the last thing that called
  // them: `bk link` went on 2026-08-10, `linksRoute` was mounted by nobody, and
  // a relation whose far end lives in another app's schema cannot be validated
  // by the app holding it. The table is still there and nothing reads it.
  //
  // The cross-workspace case was the one worth keeping, and it has a successor
  // that is not about links at all: `entityByUrn` is scoped by urn, and the
  // reconciler below asserts counts PER WORKSPACE.

  // ---- 6. THE ONE THAT MATTERS: COUNTS MATCH ----

  it('reconciliation reports ZERO drift after all of the above', async () => {
    const result = await entitiesQ.reconcileEntities({ workspaceId: wsId })

    // Counts per type, source vs projection. This is the assertion the phase's
    // failure mode demands: a search that returns something proves nothing, and
    // "no errors" proves less than that.
    expect(result.projected_counts, 'projection must match the source, per type').toEqual(
      result.source_counts
    )
    expect(
      result.drift,
      `drift after normal use:\n${result.drift.map((d) => `  ${d.kind} ${d.urn}: ${d.detail}`).join('\n')}`
    ).toEqual([])
  })

  it('the reconciler DETECTS drift when it is introduced behind the write paths', async () => {
    // A reconciler that reports zero drift is only reassuring if it can report
    // non-zero. Corrupt the projection directly — the one thing no write path
    // does — and check all three kinds are found and repaired.
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Drift subject',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const urn = `bc:issues:${wsSlug}/issue/${issue.seq}`

    // (a) stale: title changed behind the projection's back
    await db
      .update(schema.entities)
      .set({ title: 'WRONG' })
      .where(eq(schema.entities.urn, urn))
    // (b) missing: a projection deleted outright
    const victim = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Missing subject',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const victimUrn = `bc:issues:${wsSlug}/issue/${victim.seq}`
    await db.delete(schema.entities).where(eq(schema.entities.urn, victimUrn))
    // (c) orphaned: a projection with no source row at all
    const orphanUrn = `bc:issues:${wsSlug}/issue/98765432`
    await db.insert(schema.entities).values({
      urn: orphanUrn,
      app: APP,
      workspace_id: wsId,
      entity_type: 'issue',
      number: 98765432,
      title: 'Orphan',
      url: `/dashboard/${wsSlug}/issues/98765432`,
    })

    const found = await entitiesQ.reconcileEntities({ workspaceId: wsId })
    const kinds = new Map(found.drift.map((d) => [d.urn, d.kind]))
    expect(kinds.get(urn)).toBe('stale')
    expect(kinds.get(victimUrn)).toBe('missing')
    expect(kinds.get(orphanUrn)).toBe('orphaned')

    const repaired = await entitiesQ.reconcileEntities({ workspaceId: wsId, repair: true })
    expect(repaired.repaired).toBeGreaterThanOrEqual(3)

    const after = await entitiesQ.reconcileEntities({ workspaceId: wsId })
    expect(after.drift, 'repair must leave zero drift').toEqual([])
    expect((await entityByUrn(urn))!.title).toBe('Drift subject')
    expect(await entityByUrn(victimUrn)).not.toBeNull()
    expect(await entityByUrn(orphanUrn)).toBeNull()
  })

  // ---- 7. SEARCH AND ACTIVITY READ THE PROJECTION ----

  it('search finds entities by title and by #number, and hides binned ones', async () => {
    const unique = `Zqx${suffix}`
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: `Searchable ${unique}`,
      reporterId: ownerId,
      actorUserId: ownerId,
    })

    const byTitle = await platformDb.searchEntities(db, { workspaceId: wsId, query: unique })
    expect(byTitle.map((e) => e.urn)).toContain(`bc:issues:${wsSlug}/issue/${issue.seq}`)

    const byNumber = await platformDb.searchEntities(db, {
      workspaceId: wsId,
      query: `#${issue.seq}`,
    })
    expect(byNumber.map((e) => e.number)).toContain(issue.seq)

    await deletionQ.softDeleteIssue(wsId, issue.id, ownerId)
    expect(
      (await platformDb.searchEntities(db, { workspaceId: wsId, query: unique })).map((e) => e.urn)
    ).not.toContain(`bc:issues:${wsSlug}/issue/${issue.seq}`)
    expect(
      (
        await platformDb.searchEntities(db, {
          workspaceId: wsId,
          query: unique,
          includeDeleted: true,
        })
      ).map((e) => e.urn)
    ).toContain(`bc:issues:${wsSlug}/issue/${issue.seq}`)
  })

  it('events carry the producing app and the subject URN', async () => {
    const issue = await issuesQ.createIssue({
      workspaceId: wsId,
      title: 'Event subject',
      reporterId: ownerId,
      actorUserId: ownerId,
    })
    const urn = `bc:issues:${wsSlug}/issue/${issue.seq}`
    const rows = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.workspace_id, wsId), eq(schema.events.subject_urn, urn)))
    expect(rows.length, `no event carries subject_urn ${urn}`).toBeGreaterThan(0)
    for (const r of rows) expect(r.app).toBe(APP)
  })
})
