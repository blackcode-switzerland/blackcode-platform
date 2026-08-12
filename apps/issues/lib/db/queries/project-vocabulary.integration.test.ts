// The other half of project-vocabulary.test.ts: that `createProject` and
// `updateProject` actually CALL the validator.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// ---------------------------------------------------------------------------
// WHY THE UNIT TEST IS NOT ENOUGH
// ---------------------------------------------------------------------------
// A pure test of a pure function cannot see whether anything invokes it.
// `assertProjectVocabulary` could be perfect and unreferenced, and every case
// in project-vocabulary.test.ts would still pass — the guard would be green and
// the hole it exists to close would be wide open. That is CLAUDE.md finding #4
// in a different costume: a check whose subject is not the thing in the path.
//
// Deleting the two `assertProjectVocabulary(...)` calls from queries/projects.ts
// leaves the unit file 100% green and turns every case here red.
//
// ---------------------------------------------------------------------------
// WHY IT NEEDS A DATABASE
// ---------------------------------------------------------------------------
// The POSITIVE case is the point (finding #16), and "P0 was accepted" can only
// be observed as a row that exists with priority 'P0'. Asserting "it did not
// throw" would pass against a `createProject` that had been gutted entirely.
// The rejection cases genuinely do not need Postgres — the assert runs before
// `db.transaction` — but splitting them across two files by that accident would
// hide which half is load-bearing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues project vocabulary: the validator is actually wired in',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('project vocabulary is enforced by the write paths (integration)', () => {
  let db: (typeof import('../client'))['db']
  let sql: (typeof import('drizzle-orm'))['sql']
  let projectsQ: typeof import('./projects')

  let workspaceId: number
  let actorUserId: number

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    projectsQ = await import('./projects')

    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    const user = u.rows[0] as { id: number } | undefined
    if (!user) throw new Error('no users in the test database')
    actorUserId = user.id

    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('project-vocab-test', ${'project-vocab-test-' + Date.now()}, ${actorUserId})
      RETURNING id`)
    workspaceId = (ws.rows[0] as { id: number }).id
    await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id) VALUES (${workspaceId})
      ON CONFLICT DO NOTHING`)
  })

  afterAll(async () => {
    if (workspaceId) {
      await db.execute(sql`DELETE FROM issues.projects WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${workspaceId}`)
    }
  })

  it('POSITIVE: createProject stores a valid priority, and the row proves it', async () => {
    const p = await projectsQ.createProject({
      workspaceId,
      name: 'valid priority',
      priority: 'P0',
      actorUserId,
    })
    // The ROW, not the return value and not "it did not throw" — the outcome.
    const row = await db.execute(sql`
      SELECT priority, status FROM issues.projects WHERE id = ${p.id}`)
    expect(row.rows[0]).toEqual({ priority: 'P0', status: 'backlog' })
  })

  it('POSITIVE: updateProject stores a valid priority change', async () => {
    const p = await projectsQ.createProject({
      workspaceId,
      name: 'to be repriorityed',
      priority: 'P2',
      actorUserId,
    })
    await projectsQ.updateProject(workspaceId, p.id, { priority: 'P3' }, actorUserId)
    const row = await db.execute(sql`SELECT priority FROM issues.projects WHERE id = ${p.id}`)
    expect(row.rows[0]).toEqual({ priority: 'P3' })
  })

  it('createProject REFUSES `urgent` and writes no row', async () => {
    const before = await db.execute(sql`
      SELECT count(*)::int AS n FROM issues.projects WHERE workspace_id = ${workspaceId}`)

    await expect(
      projectsQ.createProject({
        workspaceId,
        name: 'corrupt priority',
        priority: 'urgent',
        actorUserId,
      })
    ).rejects.toThrow('invalid_priority')

    // A refusal that still wrote the row would be the worst of both.
    const after = await db.execute(sql`
      SELECT count(*)::int AS n FROM issues.projects WHERE workspace_id = ${workspaceId}`)
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('updateProject REFUSES `urgent` and leaves the stored value alone', async () => {
    const p = await projectsQ.createProject({
      workspaceId,
      name: 'stays P1',
      priority: 'P1',
      actorUserId,
    })
    await expect(
      projectsQ.updateProject(workspaceId, p.id, { priority: 'urgent' }, actorUserId)
    ).rejects.toThrow('invalid_priority')
    const row = await db.execute(sql`SELECT priority FROM issues.projects WHERE id = ${p.id}`)
    expect(row.rows[0]).toEqual({ priority: 'P1' })
  })

  it('createProject REFUSES an out-of-vocabulary status', async () => {
    await expect(
      projectsQ.createProject({
        workspaceId,
        name: 'corrupt status',
        status: 'done',
        actorUserId,
      })
    ).rejects.toThrow('invalid_status')
  })
})
