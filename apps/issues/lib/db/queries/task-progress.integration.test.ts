// A task's status and progress are DERIVED from its issues, against a real
// Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
// ---------------------------------------------------------------------------
// The derivation IS the SQL — a CASE over four FILTERed aggregates in
// `taskProgressSql`. There is no TypeScript function to unit-test; anything I
// could stub would be a second implementation agreeing with itself, which is
// exactly the shape of a guard that cannot fail.
//
// ---------------------------------------------------------------------------
// WHY IT ASSERTS THE NUMBERS AND NOT "A NUMBER APPEARED"
// ---------------------------------------------------------------------------
// A derived value has a failure mode that looks like data: a wrong count is
// byte-indistinguishable from a right one, and there is no error, no exception
// and no log line to notice. `expect(count).toBeTypeOf('number')` would pass
// against every wrong answer this query can give — including the one it used to
// give, where `completed_issues` was the literal `i.status = 'done'` in five
// separate copies of the query.
//
// So each case below fixes an EXACT expected tuple, and the cases are chosen to
// disagree with each other: if `open_issues` silently counted cancelled issues,
// the mixed case's `open` would be 3 instead of 2 AND the all-cancelled case's
// status would be 'active' instead of 'cancelled'. One mistake, two red tests.
//
// The two edge cases from lib/work-items.ts → "tasks" each get their own case,
// because both are the kind that a reasonable-looking implementation gets
// wrong by accident:
//
//   * a task with no issues is `empty`, NOT `done` (vacuous truth: "no issues
//     are open" is true of a task with nothing in it, so a naive
//     `open === 0 → done` returns 'done' for an empty task), and
//   * a task whose issues were all cancelled is `cancelled`, NOT `done`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues task progress: derived status + counts',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('task progress is derived from its issues (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let tasksQ: typeof import('./tasks')

  let workspaceId: number
  let actorUserId: number

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    tasksQ = await import('./tasks')

    // Any existing user — events and `tasks.lead_id` carry real FKs, so a
    // synthetic id would fail the insert rather than the assertion.
    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    const user = u.rows[0] as { id: number } | undefined
    if (!user) throw new Error('no users in the test database — cannot own a workspace')
    actorUserId = user.id

    // A throwaway workspace of our own, so the assertions are about rows this
    // file created and nothing else. Counting rows in a shared workspace would
    // make every number depend on whatever else is in the dev database.
    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('task-progress-test', ${'task-progress-test-' + Date.now()}, ${actorUserId})
      RETURNING id`)
    workspaceId = (ws.rows[0] as { id: number }).id
    await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id) VALUES (${workspaceId})
      ON CONFLICT DO NOTHING`)
  })

  afterAll(async () => {
    if (workspaceId) {
      await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM issues.tasks WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${workspaceId}`)
      await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${workspaceId}`)
    }
  })

  /** Creates a task with issues in the given statuses, returns its joined row. */
  async function taskWith(name: string, statuses: string[]) {
    const task = await tasksQ.createTask({ workspaceId, name, actorUserId })
    for (const [i, status] of statuses.entries()) {
      await db.execute(sql`
        INSERT INTO issues.issues (workspace_id, task_id, title, status, seq)
        VALUES (${workspaceId}, ${task.id}, ${name + ' #' + i}, ${status},
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.issues WHERE workspace_id = ${workspaceId}))`)
    }
    const row = await tasksQ.getTaskInWorkspace(workspaceId, task.id)
    if (!row) throw new Error('task vanished')
    return row
  }

  it('EDGE CASE 1: a task with no issues is `empty`, not `done`', async () => {
    const t = await taskWith('no issues', [])
    expect({
      status: t.progress_status,
      issues: t.issue_count,
      done: t.completed_issues,
      cancelled: t.cancelled_issues,
      open: t.open_issues,
    }).toEqual({ status: 'empty', issues: 0, done: 0, cancelled: 0, open: 0 })
  })

  it('MIXED STATES: counts split done / cancelled / open exactly', async () => {
    // 2 done, 1 cancelled, 2 open (one todo, one in_progress) = 5 issues.
    // Every number below is distinct from every other, so no two of them can
    // be swapped without this failing.
    const t = await taskWith('mixed', ['done', 'done', 'cancelled', 'todo', 'in_progress'])
    expect({
      status: t.progress_status,
      issues: t.issue_count,
      done: t.completed_issues,
      cancelled: t.cancelled_issues,
      open: t.open_issues,
    }).toEqual({ status: 'active', issues: 5, done: 2, cancelled: 1, open: 2 })
  })

  it('a task whose issues are all done is `done`', async () => {
    const t = await taskWith('all done', ['done', 'done'])
    expect(t.progress_status).toBe('done')
    expect(t.open_issues).toBe(0)
    expect(t.completed_issues).toBe(2)
  })

  it('done + cancelled with nothing open is `done` — cancelled is not "still open"', async () => {
    const t = await taskWith('done and cancelled', ['done', 'cancelled'])
    expect({
      status: t.progress_status,
      done: t.completed_issues,
      cancelled: t.cancelled_issues,
      open: t.open_issues,
    }).toEqual({ status: 'done', done: 1, cancelled: 1, open: 0 })
  })

  it('EDGE CASE 2: a task whose issues were ALL cancelled is `cancelled`, not `done`', async () => {
    const t = await taskWith('all cancelled', ['cancelled', 'cancelled'])
    expect({
      status: t.progress_status,
      done: t.completed_issues,
      cancelled: t.cancelled_issues,
      open: t.open_issues,
    }).toEqual({ status: 'cancelled', done: 0, cancelled: 2, open: 0 })
  })

  it('a soft-deleted issue leaves the group — it is not counted anywhere', async () => {
    const t = await taskWith('with deleted', ['done', 'todo', 'todo'])
    expect(t.open_issues).toBe(2)
    await db.execute(sql`
      UPDATE issues.issues SET deleted_at = now()
      WHERE task_id = ${t.id} AND status = 'todo'`)
    const after = await tasksQ.getTaskInWorkspace(workspaceId, t.id)
    expect({
      status: after!.progress_status,
      issues: after!.issue_count,
      done: after!.completed_issues,
      open: after!.open_issues,
    }).toEqual({ status: 'done', issues: 1, done: 1, open: 0 })
  })

  it('listTasksInWorkspace derives the same numbers as getTaskInWorkspace', async () => {
    // The two queries are separate SQL statements sharing one fragment. If the
    // fragment stops being shared, this is what notices — a listing that
    // disagrees with the detail page is the bug that reads as a caching
    // problem for a week.
    const list = await tasksQ.listTasksInWorkspace(workspaceId, {})
    for (const item of list) {
      const one = await tasksQ.getTaskInWorkspace(workspaceId, item.id)
      expect({
        status: one!.progress_status,
        issues: one!.issue_count,
        done: one!.completed_issues,
        cancelled: one!.cancelled_issues,
        open: one!.open_issues,
      }).toEqual({
        status: item.progress_status,
        issues: item.issue_count,
        done: item.completed_issues,
        cancelled: item.cancelled_issues,
        open: item.open_issues,
      })
    }
    // Assert the input: a loop over an empty list passes while checking nothing.
    expect(list.length).toBeGreaterThanOrEqual(6)
  })

  it('the derived status filter selects on the derivation, not the dead column', async () => {
    // Every row's `issues.tasks.status` column is 'active' (12/12 in local dev
    // on 2026-08-12, and no write path has ever set another value). So a filter
    // reading the COLUMN returns every task for 'active' and nothing for the
    // rest — which is what this asserts is no longer happening.
    const done = await tasksQ.listTasksInWorkspace(workspaceId, { status: 'done' })
    const empty = await tasksQ.listTasksInWorkspace(workspaceId, { status: 'empty' })
    const cancelled = await tasksQ.listTasksInWorkspace(workspaceId, { status: 'cancelled' })

    expect(done.map((t) => t.name).sort()).toEqual(
      ['all done', 'done and cancelled', 'with deleted'].sort()
    )
    expect(empty.map((t) => t.name)).toEqual(['no issues'])
    expect(cancelled.map((t) => t.name)).toEqual(['all cancelled'])
  })

  it('updateTask REFUSES a status write rather than dropping it', async () => {
    // Silently ignoring the field would leave a caller believing the write
    // landed — and then reading back a different value with no error in
    // between. See lib/work-items.ts → "tasks".
    const t = await taskWith('refuses status', [])
    await expect(
      tasksQ.updateTask(workspaceId, t.id, { status: 'done' } as never, actorUserId)
    ).rejects.toThrow('task_status_derived')
  })
})
