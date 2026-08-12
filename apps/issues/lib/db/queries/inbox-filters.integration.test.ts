// The inbox's narrowing filters, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// THE DEFAULT IS GLOBAL AND THAT IS THE FIRST THING ASSERTED
// ---------------------------------------------------------------------------
// Decision Q3: the inbox stays global. Every filter here is opt-in, and the
// baseline case exists so "the filter returned the right rows" is
// distinguishable from "the filter did not run" — without a known full set, an
// expected list that happens to be everything reads as a pass.
//
// ---------------------------------------------------------------------------
// PROJECT AND TASK ARE THE ONES WORTH THE INK
// ---------------------------------------------------------------------------
// They are NOT columns on an inbox row — see the header on `ListInboxFilter`.
// They reach through `entity_id`, and the tempting implementation
// (`entity_type='issue' AND entity_id IN (issues of P)`) silently drops every
// notification about the project record itself and about its tasks. That is the
// failure mode that reads as "quiet week", so each of the three arms of the
// union gets a row in the fixture and each is named in the expected set.
//
// The rows are inserted directly rather than driven through the event fan-out:
// this file is about the READ, and going through the writer would make every
// case depend on which events happen to produce an inbox row today.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues inbox filters: workspace, type, actor, since, project, task',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('inbox filters exclude what they should (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let inboxQ: typeof import('./inbox')

  let workspaceId: number
  let otherWorkspaceId: number
  let userId: number
  let actorId: number
  let otherActorId: number
  let projectId: number
  let taskId: number
  let issueInProject: number
  let looseIssue: number

  const kinds = (rows: Array<{ payload: unknown }>) =>
    rows.map((r) => (r.payload as { tag: string }).tag).sort()

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    inboxQ = await import('./inbox')

    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 2`)
    const users = u.rows as Array<{ id: number }>
    if (users.length === 0) throw new Error('no users in the test database')
    userId = users[0].id
    actorId = users[0].id
    otherActorId = users[1]?.id ?? users[0].id

    const mkWs = async (name: string) => {
      const r = await db.execute(sql`
        INSERT INTO platform.workspaces (name, slug, owner_id)
        VALUES (${name}, ${name + '-' + Date.now()}, ${userId})
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    workspaceId = await mkWs('inbox-filters')
    otherWorkspaceId = await mkWs('inbox-filters-other')
    for (const w of [workspaceId, otherWorkspaceId]) {
      await db.execute(sql`
        INSERT INTO issues.workspace_counters (workspace_id) VALUES (${w}) ON CONFLICT DO NOTHING`)
    }

    const p = await db.execute(sql`
      INSERT INTO issues.projects (workspace_id, name, owner_id, seq)
      VALUES (${workspaceId}, 'Watched', ${userId}, 1) RETURNING id`)
    projectId = (p.rows[0] as { id: number }).id

    const t = await db.execute(sql`
      INSERT INTO issues.tasks (workspace_id, name, project_id, seq)
      VALUES (${workspaceId}, 'Grouping', ${projectId}, 1) RETURNING id`)
    taskId = (t.rows[0] as { id: number }).id

    const mkIssue = async (title: string, pid: number | null, tid: number | null, seq: number) => {
      const r = await db.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, project_id, task_id, seq)
        VALUES (${workspaceId}, ${title}, ${pid}, ${tid}, ${seq}) RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    issueInProject = await mkIssue('in the project', projectId, taskId, 1)
    looseIssue = await mkIssue('in no project', null, null, 2)

    // tag                 ws       type            entity            actor        created
    // -------------------------------------------------------------------------------
    // issue-in-project    main     assigned        issue/inProject   actor        2026-08-10
    // issue-loose         main     assigned        issue/loose       actor        2026-08-10
    // task-itself         main     status_changed  task/taskId       actor        2026-08-10
    // project-itself      main     commented       project/projectId other        2026-08-11
    // invitation          main     invitation      invitation/1      other        2026-08-11
    // other-workspace     other    assigned        issue/loose       actor        2026-08-11
    const mk = async (
      tag: string,
      ws: number,
      type: string,
      entityType: string | null,
      entityId: number | null,
      actor: number,
      createdAt: string
    ) => {
      await db.execute(sql`
        INSERT INTO platform.inbox_messages
          (user_id, workspace_id, type, entity_type, entity_id, actor_user_id, payload, created_at)
        VALUES (${userId}, ${ws}, ${type}, ${entityType}, ${entityId}, ${actor},
                ${JSON.stringify({ tag })}::jsonb, ${createdAt})`)
    }
    await mk('issue-in-project', workspaceId, 'assigned', 'issue', issueInProject, actorId, '2026-08-10T09:00:00Z')
    await mk('issue-loose', workspaceId, 'assigned', 'issue', looseIssue, actorId, '2026-08-10T09:00:00Z')
    await mk('task-itself', workspaceId, 'status_changed', 'task', taskId, actorId, '2026-08-10T09:00:00Z')
    await mk('project-itself', workspaceId, 'commented', 'project', projectId, otherActorId, '2026-08-11T09:00:00Z')
    await mk('invitation', workspaceId, 'invitation', 'invitation', 1, otherActorId, '2026-08-11T09:00:00Z')
    await mk('other-workspace', otherWorkspaceId, 'assigned', 'issue', looseIssue, actorId, '2026-08-11T09:00:00Z')
  })

  afterAll(async () => {
    for (const w of [workspaceId, otherWorkspaceId]) {
      if (!w) continue
      await db.execute(sql`DELETE FROM platform.inbox_messages WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM issues.tasks WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM issues.projects WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${w}`)
      await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${w}`)
    }
  })

  /** Only this fixture's rows — the test database has real inbox rows too. */
  const mine = async (filter: Partial<Parameters<typeof inboxQ.listInbox>[0]>) => {
    const page = await inboxQ.listInbox({ userId, limit: 200, ...filter })
    return page.data.filter((r) => {
      const tag = (r.payload as { tag?: string })?.tag
      return typeof tag === 'string'
    })
  }

  it('THE DEFAULT IS GLOBAL: no filter returns every workspace', async () => {
    const rows = await mine({})
    expect(kinds(rows)).toEqual([
      'invitation',
      'issue-in-project',
      'issue-loose',
      'other-workspace',
      'project-itself',
      'task-itself',
    ])
  })

  it('--ws narrows to one workspace and excludes the other', async () => {
    const rows = await mine({ workspaceId })
    expect(kinds(rows)).toEqual([
      'invitation',
      'issue-in-project',
      'issue-loose',
      'project-itself',
      'task-itself',
    ])
    const other = await mine({ workspaceId: otherWorkspaceId })
    expect(kinds(other)).toEqual(['other-workspace'])
  })

  it('--type selects one kind and excludes the rest', async () => {
    expect(kinds(await mine({ workspaceId, type: 'assigned' }))).toEqual([
      'issue-in-project',
      'issue-loose',
    ])
    expect(kinds(await mine({ workspaceId, type: 'commented' }))).toEqual(['project-itself'])
  })

  it('--from selects one actor, and the two actors partition the workspace', async () => {
    const fromActor = await mine({ workspaceId, actorUserId: actorId })
    const fromOther = await mine({ workspaceId, actorUserId: otherActorId })
    if (actorId === otherActorId) return // single-user database: nothing to partition
    expect(kinds(fromActor)).toEqual(['issue-in-project', 'issue-loose', 'task-itself'])
    expect(kinds(fromOther)).toEqual(['invitation', 'project-itself'])
    expect([...kinds(fromActor), ...kinds(fromOther)].sort()).toEqual([
      'invitation',
      'issue-in-project',
      'issue-loose',
      'project-itself',
      'task-itself',
    ])
  })

  it('--since is inclusive at the instant and excludes what came before', async () => {
    const rows = await mine({ workspaceId, since: new Date('2026-08-11T00:00:00Z') })
    expect(kinds(rows)).toEqual(['invitation', 'project-itself'])
    // And a bound before everything returns everything — so an empty result
    // above would be the filter being too strict, not the fixture being empty.
    const all = await mine({ workspaceId, since: new Date('2000-01-01T00:00:00Z') })
    expect(kinds(all)).toHaveLength(5)
  })

  // ---- the union, arm by arm ----

  it('--project covers ALL THREE ARMS: the project, its tasks, and its issues', async () => {
    const rows = await mine({ workspaceId, projectId })
    expect(kinds(rows)).toEqual(['issue-in-project', 'project-itself', 'task-itself'])
  })

  it('--project EXCLUDES the loose issue and the invitation', async () => {
    // Stated as its own case because it is the half a one-armed implementation
    // gets right by accident: `entity_type='issue' AND entity_id IN (…)` also
    // excludes these two, while silently losing the other two arms above.
    const rows = await mine({ workspaceId, projectId })
    const tags = kinds(rows)
    expect(tags).not.toContain('issue-loose')
    expect(tags).not.toContain('invitation')
  })

  it('--task covers the task and its issues, and excludes the project row', async () => {
    const rows = await mine({ workspaceId, taskId })
    expect(kinds(rows)).toEqual(['issue-in-project', 'task-itself'])
  })

  it('two filters are an AND, not whichever ran last', async () => {
    const rows = await mine({ workspaceId, projectId, type: 'assigned' })
    expect(kinds(rows)).toEqual(['issue-in-project'])
  })

  // ---- the unread count is scoped to the same filters as the list ----

  it('countUnread applies the SAME narrowing as the listing beside it', async () => {
    // Every fixture row is unread. A count that ignored the filters would print
    // the global number under a filtered list — a number answering a question
    // nobody asked, in the place the answer belongs.
    const scoped = await inboxQ.countUnread({ userId, workspaceId, projectId })
    const wider = await inboxQ.countUnread({ userId, workspaceId })
    expect(scoped).toBe(3)
    expect(wider).toBeGreaterThan(scoped)
  })
})
