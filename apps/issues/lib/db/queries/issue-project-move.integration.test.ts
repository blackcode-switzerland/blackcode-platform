// Moving an issue between projects, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// THE POSITIVE CASE IS FIRST, AND IT ASSERTS THE ROW
// ---------------------------------------------------------------------------
// CLAUDE.md finding #16: a guard built only on "was this refused?" cannot tell a
// working rule from a subject that refuses everything. `if (true) throw` would
// satisfy every refusal below.
//
// And finding #21: the positive case has to assert the OUTCOME, not a side
// effect on the way to it. So it re-reads the issue from the database and checks
// `project_id` actually changed — not that `updateIssue` returned without
// throwing, which a no-op that copies nothing would also do.
//
// ---------------------------------------------------------------------------
// WHAT THE REFUSAL IS FOR
// ---------------------------------------------------------------------------
// An issue in project A, grouped under a task that also belongs to A. Move the
// issue to B and the task link now crosses projects: the task's progress counts
// an issue that is no longer under it, and `project issues B` and
// `task view <t>` disagree about the same row. Nothing errors, nothing logs, and
// the numbers are wrong from then on.
//
// The decision (phase 4 §2) is to refuse and name the task. These cases pin both
// the refusal AND its exact scope — an unrelated edit on an already-crossed row
// is NOT blocked, because the rule is about the move, not about policing history.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues project move: the task link is not silently orphaned',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('moving an issue between projects (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let issuesQ: typeof import('./issues')

  let workspaceId: number
  let userId: number
  let projectA: number
  let projectB: number
  let taskInA: number
  let standaloneTask: number

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    issuesQ = await import('./issues')

    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    const user = u.rows[0] as { id: number } | undefined
    if (!user) throw new Error('no users in the test database — cannot own a workspace')
    userId = user.id

    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('project-move-test', ${'project-move-test-' + Date.now()}, ${userId})
      RETURNING id`)
    workspaceId = (ws.rows[0] as { id: number }).id
    await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id) VALUES (${workspaceId})
      ON CONFLICT DO NOTHING`)

    const mkProject = async (name: string) => {
      const r = await db.execute(sql`
        INSERT INTO issues.projects (workspace_id, name, owner_id, seq)
        VALUES (${workspaceId}, ${name}, ${userId},
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.projects WHERE workspace_id = ${workspaceId}))
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    projectA = await mkProject('Alpha')
    projectB = await mkProject('Beta')

    const mkTask = async (name: string, projectId: number | null) => {
      const r = await db.execute(sql`
        INSERT INTO issues.tasks (workspace_id, name, project_id, seq)
        VALUES (${workspaceId}, ${name}, ${projectId},
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.tasks WHERE workspace_id = ${workspaceId}))
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    taskInA = await mkTask('grouped under Alpha', projectA)
    standaloneTask = await mkTask('belongs to no project', null)
  })

  afterAll(async () => {
    if (!workspaceId) return
    await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.tasks WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.projects WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${workspaceId}`)
  })

  let n = 0
  async function mkIssue(projectId: number | null, taskId: number | null) {
    const r = await db.execute(sql`
      INSERT INTO issues.issues (workspace_id, title, project_id, task_id, seq)
      VALUES (${workspaceId}, ${'move-case-' + ++n}, ${projectId}, ${taskId},
              (SELECT COALESCE(MAX(seq), 0) + 1 FROM issues.issues WHERE workspace_id = ${workspaceId}))
      RETURNING id`)
    return (r.rows[0] as { id: number }).id
  }

  async function readBack(id: number) {
    const r = await db.execute(sql`
      SELECT project_id, task_id, title FROM issues.issues WHERE id = ${id}`)
    return r.rows[0] as { project_id: number | null; task_id: number | null; title: string }
  }

  // ---- POSITIVE CASES: the move must WORK, and the row must have changed ----

  it('an issue with no task moves between projects', async () => {
    const id = await mkIssue(projectA, null)
    await issuesQ.updateIssue(workspaceId, id, { project_id: projectB }, userId)
    expect(await readBack(id)).toMatchObject({ project_id: projectB, task_id: null })
  })

  it('an issue whose task belongs to the DESTINATION project moves, link intact', async () => {
    // The task is in A and the issue moves to A. Nothing is orphaned, so nothing
    // is refused — a rule that blocked this would be refusing the safe case.
    const id = await mkIssue(null, taskInA)
    await issuesQ.updateIssue(workspaceId, id, { project_id: projectA }, userId)
    expect(await readBack(id)).toMatchObject({ project_id: projectA, task_id: taskInA })
  })

  it('an issue whose task belongs to NO project moves freely', async () => {
    // A standalone task cannot be orphaned by a project move — it was never in a
    // project to be separated from.
    const id = await mkIssue(projectA, standaloneTask)
    await issuesQ.updateIssue(workspaceId, id, { project_id: projectB }, userId)
    expect(await readBack(id)).toMatchObject({ project_id: projectB, task_id: standaloneTask })
  })

  it('clearing the task IN THE SAME CALL is the documented recovery, and it works', async () => {
    const id = await mkIssue(projectA, taskInA)
    await issuesQ.updateIssue(workspaceId, id, { project_id: projectB, task_id: null }, userId)
    expect(await readBack(id)).toMatchObject({ project_id: projectB, task_id: null })
  })

  // ---- THE REFUSAL ----

  it('REFUSES a move that would leave the issue in another project’s task', async () => {
    const id = await mkIssue(projectA, taskInA)
    await expect(
      issuesQ.updateIssue(workspaceId, id, { project_id: projectB }, userId)
    ).rejects.toThrow('task_project_mismatch')
  })

  it('the refusal names the task, because a refusal nobody can act on is a failure', async () => {
    const id = await mkIssue(projectA, taskInA)
    try {
      await issuesQ.updateIssue(workspaceId, id, { project_id: projectB }, userId)
      throw new Error('expected a refusal')
    } catch (err) {
      expect(err).toBeInstanceOf(issuesQ.IssueTaskProjectMismatch)
      const e = err as InstanceType<typeof issuesQ.IssueTaskProjectMismatch>
      expect(e.taskName).toBe('grouped under Alpha')
      expect(typeof e.taskSeq).toBe('number')
    }
  })

  it('NOTHING IS WRITTEN when the move is refused — not the project, not anything else', async () => {
    // The refusal happens inside the transaction and before any UPDATE. A rule
    // that threw after the write would leave a half-move, and the caller would
    // read the error as "nothing happened".
    const id = await mkIssue(projectA, taskInA)
    await expect(
      issuesQ.updateIssue(workspaceId, id, { project_id: projectB, title: 'renamed too' }, userId)
    ).rejects.toThrow('task_project_mismatch')
    const after = await readBack(id)
    expect(after.project_id).toBe(projectA)
    expect(after.task_id).toBe(taskInA)
    expect(after.title).not.toBe('renamed too')
  })

  it('unscoping the issue is a move too, and is refused for the same reason', async () => {
    const id = await mkIssue(projectA, taskInA)
    await expect(
      issuesQ.updateIssue(workspaceId, id, { project_id: null }, userId)
    ).rejects.toThrow('task_project_mismatch')
  })

  it('attaching to a task in ANOTHER project is refused when the same call moves the project', async () => {
    const id = await mkIssue(projectB, null)
    await expect(
      issuesQ.updateIssue(workspaceId, id, { project_id: projectB, task_id: taskInA }, userId)
    ).rejects.toThrow('task_project_mismatch')
  })

  // ---- THE SCOPE OF THE RULE, which is as important as the rule ----

  it('an edit that does NOT touch project_id is never blocked, even on a crossed row', async () => {
    // Rows predating this rule exist and must stay editable. The rule is about
    // the MOVE — policing history would turn one decision into a migration.
    const id = await mkIssue(projectB, taskInA) // already crossed
    await issuesQ.updateIssue(workspaceId, id, { title: 'still editable' }, userId)
    expect((await readBack(id)).title).toBe('still editable')
  })

  it('`task attach` semantics are untouched: task_id alone crosses projects freely', async () => {
    // Phase 3 shipped and verified attach/detach one commit ago. Changing what
    // they mean here would be a second decision smuggled into this one.
    const id = await mkIssue(projectB, null)
    await issuesQ.updateIssue(workspaceId, id, { task_id: taskInA }, userId)
    expect(await readBack(id)).toMatchObject({ project_id: projectB, task_id: taskInA })
  })
})
