// The trigger mechanism, end to end, against a real Postgres.
//
//   PLATFORM_DB_DRIVER=pg TEST_DATABASE_URL=postgres://… npm test
//
// (`PLATFORM_DB_DRIVER=pg` because the Neon serverless driver wants a global
// WebSocket that plain Node processes do not have — see `platform-db/client.ts`.)
//
// ---------------------------------------------------------------------------
// WHAT THESE PROVE THAT NOTHING ELSE CAN
// ---------------------------------------------------------------------------
// `registry.test.ts` proves the delete gate's logic with fakes.
// `sql-parity.integration.test.ts` proves the SQL recognizer matches the TS one.
// Neither proves the claim the whole design rests on: that a write — ANY write,
// from any code path — updates `platform.blob_references` without the writer
// knowing the index exists.
//
// So every test below writes through the ORDINARY table, never through a helper
// that knows about the index, and then asserts the index moved. If someone
// replaces the triggers with application-level maintenance, these keep passing
// only for the write paths that remembered — which is exactly the failure being
// designed out, so they are also written to be read as documentation of it.
//
// The trigger tests run inside a transaction that is rolled back, so they leave
// nothing behind whatever database they are pointed at. The reconciler tests
// cannot (the reconciler opens its own connection), so they create a throwaway
// workspace and hard-delete it in `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

const BLOB = 'https://abc123.public.blob.vercel-storage.com'
const FILE_A = `${BLOB}/issues/drift-test/a.png`
const FILE_B = `${BLOB}/issues/drift-test/b.png`

/* eslint-disable @typescript-eslint/no-explicit-any */
type Exec = { execute: (q: any) => Promise<{ rows: Record<string, unknown>[] }> }

run('blob_references triggers + reconciler (integration)', () => {
  let db: Exec & { transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown> }
  let sql: typeof import('drizzle-orm')['sql']
  let reconcileBlobReferences: typeof import('./drift')['reconcileBlobReferences']
  let INDEX_APP_BY_TYPE: typeof import('./scanner')['INDEX_APP_BY_TYPE']
  let RETRIGGER_SQL: typeof import('./scanner')['RETRIGGER_SQL']
  let issuesReferenceScanner: typeof import('./scanner')['issuesReferenceScanner']

  // The throwaway workspace the reconciler tests use, and its owner.
  let wsId = 0
  let userId: number | null = null

  /** The indexed urls for one source row, sorted. */
  async function indexRows(
    exec: Exec,
    app: string,
    type: string,
    id: number
  ): Promise<string[]> {
    const res = await exec.execute(sql`
      SELECT url FROM platform.blob_references
      WHERE app = ${app} AND source_type = ${type} AND source_id = ${id}
      ORDER BY url
    `)
    return res.rows.map((r) => String(r.url))
  }

  beforeAll(async () => {
    ;({ db } = (await import('../db/client')) as never)
    ;({ sql } = await import('drizzle-orm'))
    ;({ reconcileBlobReferences } = await import('./drift'))
    ;({ INDEX_APP_BY_TYPE, RETRIGGER_SQL, issuesReferenceScanner } = await import('./scanner'))

    const owner = await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    userId = owner.rows[0] ? Number(owner.rows[0].id) : null
    if (userId == null) throw new Error('no user in the test database to own a workspace')

    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('Blob drift test', ${`blob-drift-test-${Date.now()}`}, ${userId})
      RETURNING id
    `)
    wsId = Number(ws.rows[0].id)
  })

  afterAll(async () => {
    // Cascades through issues/comments/attachments and, via their triggers,
    // through the index. That the cleanup ALSO exercises the delete path is a
    // bonus, not the test — `a hard delete drops the index rows` asserts it.
    if (wsId) await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${wsId}`)
  })

  // -------------------------------------------------------------------------
  // The triggers
  // -------------------------------------------------------------------------
  // Each of these opens a transaction, writes through the plain table, checks
  // the index inside the same transaction, and rolls back by throwing.
  async function inRolledBackTx(body: (tx: Exec) => Promise<void>) {
    const sentinel = new Error('rollback')
    await expect(
      db.transaction(async (tx) => {
        await body(tx as Exec)
        throw sentinel
      })
    ).rejects.toBe(sentinel)
  }

  it('an INSERT with an embedded url indexes it — no application code involved', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, description)
        VALUES (${wsId}, 'trigger insert', ${`<p>see <img src="${FILE_A}"></p>`})
        RETURNING id
      `)
      const id = Number(r.rows[0].id)
      expect(await indexRows(tx, 'issues', 'issue', id)).toEqual([FILE_A])
    })
  })

  it('an UPDATE replaces the whole reference set rather than accumulating', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, description)
        VALUES (${wsId}, 'trigger update', ${`a ${FILE_A}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      await tx.execute(sql`UPDATE issues.issues SET description = ${`b ${FILE_B}`} WHERE id = ${id}`)
      // FILE_A must be GONE, not merely joined by FILE_B — an index that only
      // ever grows would refuse every delete forever.
      expect(await indexRows(tx, 'issues', 'issue', id)).toEqual([FILE_B])
    })
  })

  it('a SOFT delete keeps the reference — a binned item is restorable', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, description)
        VALUES (${wsId}, 'trigger soft delete', ${`x ${FILE_A}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      await tx.execute(sql`UPDATE issues.issues SET deleted_at = now() WHERE id = ${id}`)
      expect(await indexRows(tx, 'issues', 'issue', id)).toEqual([FILE_A])
    })
  })

  it('a HARD delete drops the reference', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, description)
        VALUES (${wsId}, 'trigger hard delete', ${`x ${FILE_A}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      await tx.execute(sql`DELETE FROM issues.issues WHERE id = ${id}`)
      expect(await indexRows(tx, 'issues', 'issue', id)).toEqual([])
    })
  })

  it('a project indexes BOTH its content columns under one source', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.projects (workspace_id, name, summary, description)
        VALUES (${wsId}, 'trigger project', ${`s ${FILE_A}`}, ${`d ${FILE_B}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      expect(await indexRows(tx, 'issues', 'project', id)).toEqual([FILE_A, FILE_B].sort())
    })
  })

  // The logo/banner are the SEVENTH surface (2026-08-13). They are `exact` mode
  // on the same table as the `scan`-mode content columns above, under their own
  // source_type — see migration 0047 for why the type has to differ.
  it("a project's logo and banner index EXACTLY, and ignore a foreign url", async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.projects (workspace_id, name, icon_url, banner_url)
        VALUES (${wsId}, 'logo project', ${FILE_A}, ${FILE_B}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      expect(await indexRows(tx, 'issues', 'project_image', id)).toEqual([FILE_A, FILE_B].sort())

      const ext = await tx.execute(sql`
        INSERT INTO issues.projects (workspace_id, name, icon_url)
        VALUES (${wsId}, 'external logo', 'https://example.com/x.png') RETURNING id
      `)
      expect(await indexRows(tx, 'issues', 'project_image', Number(ext.rows[0].id))).toEqual([])
    })
  })

  // The two triggers on `issues.projects` must not clear each other's rows.
  // They share a table and a source_id, and are told apart ONLY by source_type;
  // if they ever shared one, each write would delete the other's references and
  // the symptom would be logos and descriptions intermittently losing their
  // delete protection.
  it('writing a project logo leaves its description references intact, and vice versa', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.projects (workspace_id, name, description)
        VALUES (${wsId}, 'both surfaces', ${`d ${FILE_A}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)

      await tx.execute(sql`UPDATE issues.projects SET icon_url = ${FILE_B} WHERE id = ${id}`)
      expect(await indexRows(tx, 'issues', 'project', id)).toEqual([FILE_A])
      expect(await indexRows(tx, 'issues', 'project_image', id)).toEqual([FILE_B])

      await tx.execute(sql`UPDATE issues.projects SET description = ${`d ${FILE_A}`} WHERE id = ${id}`)
      expect(await indexRows(tx, 'issues', 'project_image', id)).toEqual([FILE_B])
      expect(await indexRows(tx, 'issues', 'project', id)).toEqual([FILE_A])
    })
  })

  it('a comment is attributed to `platform`, not to this app', async () => {
    // platform.comments is a platform-owned table every app writes into, so its
    // references belong to no single app and are always consulted.
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO platform.comments (workspace_id, parent_type, parent_id, user_id, content)
        VALUES (${wsId}, 'issues:issue', 1, ${userId}, ${`c ${FILE_A}`}) RETURNING id
      `)
      const id = Number(r.rows[0].id)
      expect(await indexRows(tx, 'platform', 'comment', id)).toEqual([FILE_A])
      expect(await indexRows(tx, 'issues', 'comment', id)).toEqual([])
    })
  })

  it('an attachment indexes its file_url exactly, and ignores a foreign url', async () => {
    await inRolledBackTx(async (tx) => {
      const iss = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title) VALUES (${wsId}, 'att host') RETURNING id
      `)
      const issueId = Number(iss.rows[0].id)
      const ours = await tx.execute(sql`
        INSERT INTO issues.attachments (workspace_id, issue_id, filename, file_url)
        VALUES (${wsId}, ${issueId}, 'a.png', ${FILE_A}) RETURNING id
      `)
      const foreign = await tx.execute(sql`
        INSERT INTO issues.attachments (workspace_id, issue_id, filename, file_url)
        VALUES (${wsId}, ${issueId}, 'x.png', 'https://example.com/x.png') RETURNING id
      `)
      expect(await indexRows(tx, 'issues', 'attachment', Number(ours.rows[0].id))).toEqual([FILE_A])
      expect(await indexRows(tx, 'issues', 'attachment', Number(foreign.rows[0].id))).toEqual([])
    })
  })

  it('an external url is never indexed', async () => {
    await inRolledBackTx(async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO issues.issues (workspace_id, title, description)
        VALUES (${wsId}, 'external', '<a href="https://example.com/a.png">x</a>') RETURNING id
      `)
      expect(await indexRows(tx, 'issues', 'issue', Number(r.rows[0].id))).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // The maps that tie the scanner and the triggers together
  // -------------------------------------------------------------------------

  it('every type the scanner can report has an index app and a retrigger', async () => {
    // The seam most likely to rot: someone adds a seventh content surface to
    // the scanner and forgets one of the maps. Without this, the reconciler
    // would silently skip that type and report "no drift" forever.
    const found = await issuesReferenceScanner.scanWorkspace(db as never, wsId)
    const types = new Set<string>()
    for (const refs of found.values()) for (const r of refs) types.add(r.type)
    // Plus the types the scanner declares it can emit, whether or not this
    // workspace happens to contain one.
    for (const t of ['issue', 'task', 'project', 'project_update', 'attachment', 'comment']) {
      types.add(t)
    }
    for (const t of types) {
      expect(INDEX_APP_BY_TYPE[t], `INDEX_APP_BY_TYPE is missing "${t}"`).toBeTruthy()
      expect(RETRIGGER_SQL[t], `RETRIGGER_SQL is missing "${t}"`).toBeTruthy()
    }
  })

  // -------------------------------------------------------------------------
  // The reconciler
  // -------------------------------------------------------------------------

  it('reports no drift for a workspace the triggers have maintained', async () => {
    const r = await db.execute(sql`
      INSERT INTO issues.issues (workspace_id, title, description)
      VALUES (${wsId}, 'clean', ${`ok ${FILE_A}`}) RETURNING id
    `)
    void r
    const report = await reconcileBlobReferences({ workspaceId: wsId })
    expect(report.drift).toEqual([])
  })

  it('reports a MISSING row when an index entry is deleted behind the trigger', async () => {
    const r = await db.execute(sql`
      INSERT INTO issues.issues (workspace_id, title, description)
      VALUES (${wsId}, 'missing case', ${`m ${FILE_B}`}) RETURNING id
    `)
    const id = Number(r.rows[0].id)
    // Simulate the failure the triggers exist to prevent — a live reference with
    // no index row. This is the direction that ends in a deleted file.
    await db.execute(sql`
      DELETE FROM platform.blob_references
      WHERE app = 'issues' AND source_type = 'issue' AND source_id = ${id}
    `)

    const report = await reconcileBlobReferences({ workspaceId: wsId })
    const mine = report.drift.filter((d) => d.source_id === id)
    expect(mine.map((d) => d.kind)).toEqual(['missing'])

    const repaired = await reconcileBlobReferences({ workspaceId: wsId, repair: true })
    expect(repaired.repaired).toBeGreaterThan(0)
    expect(await indexRows(db, 'issues', 'issue', id)).toEqual([FILE_B])

    const after = await reconcileBlobReferences({ workspaceId: wsId })
    expect(after.drift.filter((d) => d.source_id === id)).toEqual([])
  })

  it('reports an ORPHANED row, and purges it on repair', async () => {
    // An index entry for a source row that does not exist. Costs a refused
    // delete, never data — but it must still be reported and fixable.
    const ghostId = 2_000_000_000
    await db.execute(sql`
      INSERT INTO platform.blob_references (url, app, source_type, source_id, workspace_id)
      VALUES (${FILE_A}, 'issues', 'issue', ${ghostId}, ${wsId})
    `)

    const report = await reconcileBlobReferences({ workspaceId: wsId })
    expect(report.drift.filter((d) => d.source_id === ghostId).map((d) => d.kind)).toEqual([
      'orphaned',
    ])

    await reconcileBlobReferences({ workspaceId: wsId, repair: true })
    expect(await indexRows(db, 'issues', 'issue', ghostId)).toEqual([])
  })
})
