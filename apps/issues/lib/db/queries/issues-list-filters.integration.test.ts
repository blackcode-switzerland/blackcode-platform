// `listIssuesInWorkspace`'s filters, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// EVERY CASE ASSERTS WHAT THE FILTER EXCLUDES
// ---------------------------------------------------------------------------
// A filter has two failure modes and only one is visible. Returning too much
// looks like a filter that did not run — but only if you already know what the
// right answer was. Returning too little looks like an empty project, and
// nothing anywhere says otherwise.
//
// The consequence for a guard is sharp: `expect(rows.length).toBeGreaterThan(0)`
// and `expect(rows.every(r => r.status === 'todo')).toBe(true)` BOTH PASS against
// a filter that was silently dropped, as long as a matching row happens to come
// back — and the second passes vacuously against a filter that returns nothing.
//
// So each case below fixes the EXACT SET of titles, and the fixture is built so
// that every filter has at least one row it must leave out AND at least one row
// another filter would have kept. A dropped clause returns the whole fixture; a
// clause that is too strict returns fewer titles than named. Both are red.
//
// The fixture is deliberately small and hand-written rather than generated: the
// expected sets are checked by reading them against the table below, and a
// generator would only agree with itself.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues list filters: label, priority, due date, task, status, assignee',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

// title            status       prio  due          labels         task    assignee
// ---------------------------------------------------------------------------
// crash-on-save    todo         1     2026-08-10   bug            alpha   user
// slow-search      in_progress  3     2026-08-20   bug, perf      alpha   —
// copy-tweak       todo         4     (none)       —              beta    user
// old-regression   done         1     2026-08-14   regression     —       —
// no-metadata      backlog      5     (none)       —              —       —
run('list filters exclude what they should (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let issuesQ: typeof import('./issues')

  let workspaceId: number
  let userId: number
  let otherUserId: number | null = null
  let alphaTaskId: number
  let betaTaskId: number

  const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title).sort()

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    issuesQ = await import('./issues')

    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 2`)
    const users = u.rows as Array<{ id: number }>
    if (users.length === 0) throw new Error('no users in the test database — cannot own a workspace')
    userId = users[0].id
    otherUserId = users[1]?.id ?? null

    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('list-filters-test', ${'list-filters-test-' + Date.now()}, ${userId})
      RETURNING id`)
    workspaceId = (ws.rows[0] as { id: number }).id
    await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id) VALUES (${workspaceId})
      ON CONFLICT DO NOTHING`)

    const mkTask = async (name: string) => {
      const r = await db.execute(sql`
        INSERT INTO issues.tasks (workspace_id, name, seq)
        VALUES (${workspaceId}, ${name},
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.tasks WHERE workspace_id = ${workspaceId}))
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    alphaTaskId = await mkTask('alpha')
    betaTaskId = await mkTask('beta')

    const mkLabel = async (name: string) => {
      const r = await db.execute(sql`
        INSERT INTO platform.labels (workspace_id, name, color, app)
        VALUES (${workspaceId}, ${name}, '#888888', 'issues')
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    const bug = await mkLabel('Bug')
    const perf = await mkLabel('perf')
    const regression = await mkLabel('regression')

    const mkIssue = async (
      title: string,
      status: string,
      priority: number,
      dueDate: string | null,
      taskId: number | null,
      labelIds: number[],
      assigneeId: number | null
    ) => {
      const r = await db.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, status, priority, due_date, task_id, seq)
        VALUES (${workspaceId}, ${title}, ${status}, ${priority}, ${dueDate}, ${taskId},
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.issues WHERE workspace_id = ${workspaceId}))
        RETURNING id`)
      const id = (r.rows[0] as { id: number }).id
      for (const lid of labelIds) {
        await db.execute(sql`INSERT INTO issues.issue_labels (issue_id, label_id) VALUES (${id}, ${lid})`)
      }
      if (assigneeId != null) {
        await db.execute(sql`INSERT INTO issues.issue_assignees (issue_id, user_id) VALUES (${id}, ${assigneeId})`)
      }
      return id
    }

    await mkIssue('crash-on-save', 'todo', 1, '2026-08-10', alphaTaskId, [bug], userId)
    await mkIssue('slow-search', 'in_progress', 3, '2026-08-20', alphaTaskId, [bug, perf], null)
    await mkIssue('copy-tweak', 'todo', 4, null, betaTaskId, [], userId)
    await mkIssue('old-regression', 'done', 1, '2026-08-14', null, [regression], null)
    await mkIssue('no-metadata', 'backlog', 5, null, null, [], null)
  })

  afterAll(async () => {
    if (!workspaceId) return
    await db.execute(sql`DELETE FROM issues.issue_labels WHERE issue_id IN (
      SELECT id FROM issues.issues WHERE workspace_id = ${workspaceId})`)
    await db.execute(sql`DELETE FROM issues.issue_assignees WHERE issue_id IN (
      SELECT id FROM issues.issues WHERE workspace_id = ${workspaceId})`)
    await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.tasks WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.labels WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${workspaceId}`)
  })

  // THE BASELINE. Every case below is a subset of this, and its existence is
  // what makes "the filter returned everything" distinguishable from "the filter
  // returned the right rows". Without it, an expected set that happens to be the
  // whole fixture would look like a pass.
  it('the unfiltered listing returns the whole fixture', async () => {
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, {})
    expect(titles(page.data)).toEqual([
      'copy-tweak',
      'crash-on-save',
      'no-metadata',
      'old-regression',
      'slow-search',
    ])
    expect(page.total).toBe(5)
  })

  it('--label matches by NAME, case-insensitively, and excludes the unlabelled', async () => {
    // 'Bug' is stored capitalised and asked for in lower case: the match is on
    // lower(name) at both ends, and a case-sensitive comparison returns [].
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, { labels: ['bug'] })
    expect(titles(page.data)).toEqual(['crash-on-save', 'slow-search'])
  })

  it('several --labels are an OR, and the union is still not everything', async () => {
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, {
      labels: ['perf', 'regression'],
    })
    // slow-search carries perf, old-regression carries regression. crash-on-save
    // carries `bug` and must NOT appear — an AND would return [] and a dropped
    // clause would return all five.
    expect(titles(page.data)).toEqual(['old-regression', 'slow-search'])
  })

  it('a label nobody carries returns nothing, not everything', async () => {
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, { labels: ['no-such-label'] })
    expect(page.data).toEqual([])
  })

  it('--priority selects one value and excludes the other four', async () => {
    const p1 = await issuesQ.listIssuesInWorkspace(workspaceId, { priority: 1 })
    expect(titles(p1.data)).toEqual(['crash-on-save', 'old-regression'])
    const p5 = await issuesQ.listIssuesInWorkspace(workspaceId, { priority: 5 })
    expect(titles(p5.data)).toEqual(['no-metadata'])
  })

  it('--due-before is INCLUSIVE on the boundary day, and excludes issues with no due date', async () => {
    // 2026-08-14 is old-regression's exact due date. This is the assertion that
    // pins the decision: a strict `<` returns only crash-on-save, and losing a
    // whole day off the end of a sprint view is invisible to the caller.
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, { dueBefore: '2026-08-14' })
    expect(titles(page.data)).toEqual(['crash-on-save', 'old-regression'])

    // Undated issues are never returned — `NULL <= date` is NULL, not true, and
    // the clause says so explicitly so nobody has to remember that.
    const wide = await issuesQ.listIssuesInWorkspace(workspaceId, { dueBefore: '2099-01-01' })
    expect(titles(wide.data)).toEqual(['crash-on-save', 'old-regression', 'slow-search'])
  })

  it('--task selects one grouping and excludes the other and the ungrouped', async () => {
    const alpha = await issuesQ.listIssuesInWorkspace(workspaceId, { taskId: alphaTaskId })
    expect(titles(alpha.data)).toEqual(['crash-on-save', 'slow-search'])
    const beta = await issuesQ.listIssuesInWorkspace(workspaceId, { taskId: betaTaskId })
    expect(titles(beta.data)).toEqual(['copy-tweak'])
    // taskId: null is a DIFFERENT request from taskId: undefined — the first
    // asks for the ungrouped, the second asks for everything.
    const none = await issuesQ.listIssuesInWorkspace(workspaceId, { taskId: null })
    expect(titles(none.data)).toEqual(['no-metadata', 'old-regression'])
  })

  it('--status excludes the other four statuses', async () => {
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, { status: 'todo' })
    expect(titles(page.data)).toEqual(['copy-tweak', 'crash-on-save'])
  })

  it('--assignee and unassigned are complementary, and neither is everything', async () => {
    const mine = await issuesQ.listIssuesInWorkspace(workspaceId, { assigneeIds: [userId] })
    expect(titles(mine.data)).toEqual(['copy-tweak', 'crash-on-save'])

    const nobody = await issuesQ.listIssuesInWorkspace(workspaceId, { assigneeIds: null })
    expect(titles(nobody.data)).toEqual(['no-metadata', 'old-regression', 'slow-search'])

    // The two partition the fixture: any row appearing in both, or in neither,
    // means one of the clauses is not the negation of the other.
    expect([...titles(mine.data), ...titles(nobody.data)].sort()).toEqual([
      'copy-tweak',
      'crash-on-save',
      'no-metadata',
      'old-regression',
      'slow-search',
    ])

    if (otherUserId != null && otherUserId !== userId) {
      const theirs = await issuesQ.listIssuesInWorkspace(workspaceId, { assigneeIds: [otherUserId] })
      expect(theirs.data).toEqual([])
    }
  })

  // FILTERS COMBINE WITH AND, and this is where a wrong one hides: each clause
  // alone returns two rows, so a listing that applied only one of them still
  // looks like a plausible answer.
  it('two filters are an AND, not whichever one ran last', async () => {
    const page = await issuesQ.listIssuesInWorkspace(workspaceId, {
      status: 'todo',
      priority: 1,
    })
    expect(titles(page.data)).toEqual(['crash-on-save'])

    const withLabel = await issuesQ.listIssuesInWorkspace(workspaceId, {
      labels: ['bug'],
      taskId: alphaTaskId,
      dueBefore: '2026-08-12',
    })
    expect(titles(withLabel.data)).toEqual(['crash-on-save'])
  })

  // A label another app owns must not select rows here. The filter reads
  // `lower(lb.name)`, and without the app predicate a sales label sharing a name
  // with an issues one would widen this listing by whatever it is attached to.
  it('a label belonging to another app is invisible to this filter', async () => {
    const r = await db.execute(sql`
      INSERT INTO platform.labels (workspace_id, name, color, app)
      VALUES (${workspaceId}, 'foreign', '#888888', 'sales')
      RETURNING id`)
    const foreignId = (r.rows[0] as { id: number }).id
    const target = await db.execute(sql`
      SELECT id FROM issues.issues WHERE workspace_id = ${workspaceId} AND title = 'no-metadata'`)
    const issueId = (target.rows[0] as { id: number }).id
    await db.execute(sql`INSERT INTO issues.issue_labels (issue_id, label_id) VALUES (${issueId}, ${foreignId})`)

    const page = await issuesQ.listIssuesInWorkspace(workspaceId, { labels: ['foreign'] })
    expect(page.data).toEqual([])
  })
})
