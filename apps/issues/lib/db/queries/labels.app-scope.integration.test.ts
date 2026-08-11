// `platform.labels.app` — the lens, through the real query layer. (D-14, 0043)
//
//   PLATFORM_DB_DRIVER=pg TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHAT THIS PROVES THAT NOTHING ELSE CAN
// ---------------------------------------------------------------------------
// `bk issues label list` says "issues" in its spelling. Before 0043 the data had
// no way to mean it. The column alone does not fix that — a column nobody reads
// is worse than no column, because the promise is now written down and still
// false. So these tests never call the predicate directly: they insert rows
// straight into `platform.labels` and then go through the ordinary exported
// query functions, which is the only way to catch a read path that forgot.
//
// ---------------------------------------------------------------------------
// THE HALF THAT IS EASY TO SKIP (D-26 step 3)
// ---------------------------------------------------------------------------
// The obvious test is "a sales label does not appear". A filter of `app IS NULL`
// alone — i.e. one that dropped the `OR app = 'issues'` half and hid this app's
// OWN labels too — passes that test perfectly. It is the same shape as agent2's
// `home_app = issues` fixture and agent10's upload attribution test, and it is
// the third instance of the mistake D-26 was written for.
//
// So every assertion below names all three rows: the foreign one must be ABSENT,
// and the shared one and this app's own must both be PRESENT. `it('detects a
// filter that hides everything')` is the explicit regression.
//
// The fixture rows are created in a throwaway workspace and hard-deleted in
// `afterAll`, because the query functions open their own connection and cannot
// be wrapped in a rolled-back transaction.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

/* eslint-disable @typescript-eslint/no-explicit-any */
type Exec = { execute: (q: any) => Promise<{ rows: Record<string, unknown>[] }> }

/** The foreign app the fixture scopes a label to. Registered and removed here. */
const FOREIGN_APP = 'labelscope'

run('label reads honour platform.labels.app (integration)', () => {
  let db: Exec
  let sql: typeof import('drizzle-orm')['sql']
  let q: typeof import('./labels')

  let wsId = 0
  let userId: number | null = null
  let issueId = 0
  const ids: { own: number; shared: number; foreign: number } = { own: 0, shared: 0, foreign: 0 }

  beforeAll(async () => {
    ;({ db } = (await import('../client')) as never)
    ;({ sql } = await import('drizzle-orm'))
    q = await import('./labels')

    // A registered second app. The FK on `labels.app` means the fixture cannot
    // pretend an app exists — which is the point of the FK.
    //
    // `enabled = false` MATTERS, and not for this suite. `platform.apps` is
    // global and vitest runs files in parallel, so while this row exists any
    // suite reading the registry picks it up. It used to be sharper: with
    // `enabled = true` here, `enableAllAppsForWorkspace` granted this fixture to
    // every workspace another suite created, and the app-access integration
    // suite failed on an assertion about invitation policy because
    // `apps_granted` contained it. That suite and that function were deleted
    // with `platform.app_access` on 2026-08-10, but the exposure is not gone —
    // `/api/meta` now lists every `enabled = true` row, and an enabled app with
    // no registered scanner still re-arms the blob delete gate for the run.
    //
    // It is a RACE — it depends on whether this row exists at the instant the
    // other suite inserts its workspace, and it does not reproduce on demand.
    // That is the argument for removing the exposure rather than ordering the
    // tests around it: a fixture that changes what a NEIGHBOURING suite observes
    // fails somebody else, somewhere else, sometimes. Disabled is also the
    // honest state — no workspace should ever enable this.
    await db.execute(sql`
      INSERT INTO platform.apps (slug, name, enabled)
      VALUES (${FOREIGN_APP}, 'Label Scope Fixture', false)
      ON CONFLICT (slug) DO UPDATE SET enabled = false
    `)

    const u = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    userId = u.rows[0] ? Number(u.rows[0].id) : null
    expect(userId, 'the fixture needs at least one user to attribute writes to').not.toBeNull()

    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('label-scope-test', ${'label-scope-test-' + Date.now()}, ${userId})
      RETURNING id
    `)
    wsId = Number(ws.rows[0].id)

    const seq = await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id, last_issue_seq) VALUES (${wsId}, 1)
      ON CONFLICT (workspace_id) DO UPDATE SET last_issue_seq = 1 RETURNING last_issue_seq
    `)
    void seq
    const iss = await db.execute(sql`
      INSERT INTO issues.issues (workspace_id, seq, title, status, priority, reporter_id)
      VALUES (${wsId}, 1, 'label scope fixture', 'todo', 3, ${userId}) RETURNING id
    `)
    issueId = Number(iss.rows[0].id)

    // Three labels, one per scope. Inserted with raw SQL on purpose: going
    // through createLabel could not produce the foreign row at all, and a test
    // that can only build the states its own code permits proves nothing about
    // the states the database permits.
    const mk = async (name: string, app: string | null) => {
      const r = await db.execute(sql`
        INSERT INTO platform.labels (workspace_id, name, app, created_by)
        VALUES (${wsId}, ${name}, ${app}, ${userId}) RETURNING id
      `)
      return Number(r.rows[0].id)
    }
    ids.own = await mk('own-app-label', 'issues')
    ids.shared = await mk('shared-label', null)
    ids.foreign = await mk('foreign-app-label', FOREIGN_APP)

    // Attach the foreign label to the fixture issue DIRECTLY. Nothing in this
    // app can create this state any more — which is exactly why the read paths
    // must still cope with it, and why `listIssueLabels` is tested below.
    await db.execute(sql`
      INSERT INTO issues.issue_labels (issue_id, label_id) VALUES (${issueId}, ${ids.foreign}), (${issueId}, ${ids.shared})
    `)
  })

  afterAll(async () => {
    if (!wsId) return
    await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${wsId}`)
    await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${wsId}`)
    await db.execute(sql`DELETE FROM platform.labels WHERE workspace_id = ${wsId}`)
    await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${wsId}`)
    await db.execute(sql`DELETE FROM platform.apps WHERE slug = ${FOREIGN_APP}`)
  })

  // 0043 is not "the column was added" — it is "the column was added AND every
  // existing label was claimed". A backfill that silently matched nothing leaves
  // no symptom at all here (a NULL label is visible to this app either way); the
  // symptom appears in the SECOND app's picker, months later, and looks like a
  // filtering bug rather than a migration that did half its job.
  //
  // Scoped away from this suite's own workspace, which deliberately holds the
  // one deliberately-shared label in the database.
  it('0043 left no unclaimed label behind', async () => {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM platform.labels
       WHERE app IS NULL AND workspace_id IS DISTINCT FROM ${wsId}
    `)
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('listLabelsInWorkspace shows this app and shared, and hides the other app', async () => {
    const names = (await q.listLabelsInWorkspace(wsId)).map((l) => l.name).sort()
    expect(names).toEqual(['own-app-label', 'shared-label'])
  })

  // THE STEP-3 REGRESSION, written out rather than reasoned about: this is the
  // assertion that a filter of `app IS NULL` alone would fail. If it ever passes
  // while `listLabelsInWorkspace` returns only the shared row, the lens has lost
  // its second half.
  it('detects a filter that hides everything, not just the other app', async () => {
    const names = (await q.listLabelsInWorkspace(wsId)).map((l) => l.name)
    expect(names, 'this app OWN label must still be visible').toContain('own-app-label')
    expect(names, 'a shared label must be visible').toContain('shared-label')
    expect(names, "another app's label must not be").not.toContain('foreign-app-label')
  })

  it('getLabelInWorkspace resolves its own and shared, and 404s the other app', async () => {
    expect((await q.getLabelInWorkspace(wsId, ids.own))?.name).toBe('own-app-label')
    expect((await q.getLabelInWorkspace(wsId, ids.shared))?.name).toBe('shared-label')
    expect(await q.getLabelInWorkspace(wsId, ids.foreign)).toBeNull()
  })

  it('createLabel stamps this app, and does not collide with the other app name', async () => {
    // The name is already taken BY THE OTHER APP. It must be creatable here, and
    // the new row must be scoped rather than shared.
    const made = await q.createLabel({
      workspaceId: wsId,
      name: 'foreign-app-label',
      actorUserId: userId!,
    })
    expect(made.app).toBe('issues')

    // …and a name taken by a SHARED label must still collide, because a shared
    // label is visible here.
    await expect(
      q.createLabel({ workspaceId: wsId, name: 'shared-label', actorUserId: userId! })
    ).rejects.toThrow('label_exists')
  })

  it('updateLabel and deleteLabel refuse another app row', async () => {
    expect(await q.updateLabel(wsId, ids.foreign, { color: '#000000' }, userId!)).toBeNull()
    expect(await q.deleteLabel(wsId, ids.foreign, userId!)).toBe(false)
    const still = await db.execute(
      sql`SELECT color FROM platform.labels WHERE id = ${ids.foreign}`
    )
    expect(still.rows.length, 'the other app label must still exist').toBe(1)
    expect(still.rows[0].color).not.toBe('#000000')

    // Same call against a row this app may touch, so the refusal above is the
    // lens and not a broken update.
    expect((await q.updateLabel(wsId, ids.own, { color: '#123456' }, userId!))?.color).toBe(
      '#123456'
    )
  })

  it('attachLabel refuses another app label and accepts this app own', async () => {
    expect(await q.attachLabel(wsId, issueId, ids.foreign, userId!)).toBe(false)
    expect(await q.attachLabel(wsId, issueId, ids.own, userId!)).toBe(true)
    expect(await q.attachLabel(wsId, issueId, ids.shared, userId!)).toBe(true)
  })

  it('listIssueLabels hides an other-app label that is already attached', async () => {
    // Attach here rather than leaning on the test above: an assertion that only
    // holds when its neighbour ran first is an assertion that stops holding the
    // day someone runs one test.
    await q.attachLabel(wsId, issueId, ids.own, userId!)
    const names = (await q.listIssueLabels(issueId)).map((l) => l.name).sort()
    expect(names).toEqual(['own-app-label', 'shared-label'])
  })

  // The label list an issue carries is assembled in `issues.ts`, not in
  // `labels.ts` — a second read path, in a second module, feeding the issue
  // listing and `bk issues issue list`. It is the one an app-lens change is
  // most likely to miss, because it does not look like a label query.
  it('an issue does not carry another app label in its own listing', async () => {
    const { getIssueInWorkspace } = await import('./issues')
    const row = await getIssueInWorkspace(wsId, issueId)
    const names = (row?.labels ?? []).map((l) => l.name).sort()
    expect(names, 'the shared label is attached and must show').toContain('shared-label')
    expect(names, "the other app's label is attached and must not").not.toContain(
      'foreign-app-label'
    )
  })

  it('resolveOrCreateLabels reuses shared and own, and never the other app row', async () => {
    const { db: real } = (await import('../client')) as never
    const resolved = await (real as any).transaction((tx: never) =>
      q.resolveOrCreateLabels(tx, wsId, ['shared-label', 'own-app-label'], userId!)
    )
    expect(resolved.sort()).toEqual([ids.own, ids.shared].sort())
  })
})
