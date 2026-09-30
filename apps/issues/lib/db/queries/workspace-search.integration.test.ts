// `searchWorkspace`, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// Every case fixes the EXACT SET it expects, and the fixture is built so each
// predicate has a row it must exclude — the same discipline as
// `issues-list-filters.integration.test.ts`, for the same reason: a dropped
// clause returns too much and `length > 0` cannot see it.
//
// What the fixture is built to catch (query "rollout" unless stated):
//   #2  matches ONLY inside an HTML attribute (`class="rollout"`) — markup must
//       not be searchable;
//   #4  is binned — hidden unless include_deleted;
//   a label scoped to ANOTHER app — must not leak (`visibleToThisApp`);
//   a soft-deleted member — not findable;
//   a comment on the binned issue — a dangling pointer, not a result;
//   a row in ANOTHER workspace — never;
//   `100%` and `a_b` — LIKE wildcards must be matched literally.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'workspace search: every type, ranking, exclusions',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('workspace search (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let search: typeof import('./workspace-search')['searchWorkspace']

  let wsA = 0
  let wsB = 0
  const slugA = 'search-test-a-' + Date.now()
  const tempUsers: number[] = []

  const find = (query: string, extra: Record<string, unknown> = {}) =>
    search({ workspaceId: wsA, workspaceSlug: slugA, query, perType: 25, ...extra })
  const key = (h: { type: string; number: number | null; title: string }) =>
    `${h.type}:${h.number ?? '-'}:${h.title}`

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    ;({ searchWorkspace: search } = await import('./workspace-search'))

    const owner = (await db.execute(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)).rows[0] as
      | { id: number }
      | undefined
    if (!owner) throw new Error('no users in the test database — cannot own a workspace')

    const mkWs = async (slug: string) => {
      const r = await db.execute(sql`
        INSERT INTO platform.workspaces (name, slug, owner_id) VALUES (${slug}, ${slug}, ${owner.id})
        RETURNING id`)
      const id = (r.rows[0] as { id: number }).id
      await db.execute(sql`INSERT INTO issues.workspace_counters (workspace_id) VALUES (${id}) ON CONFLICT DO NOTHING`)
      return id
    }
    wsA = await mkWs(slugA)
    wsB = await mkWs('search-test-b-' + Date.now())

    const mkIssue = async (ws: number, seq: number, title: string, description: string | null, binned = false) => {
      const r = await db.execute(sql`
        INSERT INTO issues.issues (workspace_id, seq, title, description, status, deleted_at)
        VALUES (${ws}, ${seq}, ${title}, ${description}, 'todo', ${binned ? sql`now()` : null})
        RETURNING id`)
      return (r.rows[0] as { id: number }).id
    }
    const i1 = await mkIssue(wsA, 1, 'Rollout checklist', '<p>Prepare the <strong>launch</strong> plan</p>')
    await mkIssue(wsA, 2, 'Fix login timeout', '<div class="rollout">users see a timeout</div>')
    const i3 = await mkIssue(wsA, 3, 'Migrate billing', '<p>Ship the&nbsp;rollout to EU customers</p>')
    const i4 = await mkIssue(wsA, 4, 'Rollout retro', null, true)
    await mkIssue(wsA, 5, 'Discount 100% off', null)
    await mkIssue(wsA, 6, 'a_b sync', null)
    await mkIssue(wsA, 7, 'axb sync', null)
    await mkIssue(wsB, 1, 'Rollout in the other workspace', null)

    await db.execute(sql`INSERT INTO issues.tasks (workspace_id, seq, name) VALUES (${wsA}, 1, 'Rollout prep')`)
    await db.execute(sql`
      INSERT INTO issues.projects (workspace_id, seq, name, summary, status)
      VALUES (${wsA}, 1, 'Q4 launch', 'The Rollout programme', 'active')`)

    const mkLabel = (name: string, app: string | null) =>
      db.execute(sql`INSERT INTO platform.labels (workspace_id, name, color, app) VALUES (${wsA}, ${name}, '#888888', ${app})`)
    await mkLabel('rollout-blocker', 'issues')
    await mkLabel('rollout-shared', null)
    await mkLabel('rollout-sales', 'sales')

    const mkUser = async (email: string, name: string, deleted: boolean) => {
      const r = await db.execute(sql`
        INSERT INTO platform.users (email, name, deleted_at) VALUES (${email}, ${name}, ${deleted ? sql`now()` : null})
        RETURNING id`)
      const id = (r.rows[0] as { id: number }).id
      tempUsers.push(id)
      await db.execute(sql`INSERT INTO platform.workspace_members (workspace_id, user_id, role) VALUES (${wsA}, ${id}, 'member')`)
      return id
    }
    const rolly = await mkUser(`rolly.${Date.now()}@search-test.invalid`, 'Rolly Rollout', false)
    await mkUser(`ghost.${Date.now()}@search-test.invalid`, 'Rollout Ghost', true)

    const mkComment = (parentType: string, parentId: number, content: string) =>
      db.execute(sql`
        INSERT INTO platform.comments (workspace_id, parent_type, parent_id, user_id, content)
        VALUES (${wsA}, ${parentType}, ${parentId}, ${rolly}, ${content})`)
    await mkComment('issue', i1, '<p>Rollout looks good to me</p>') // legacy bare form
    await mkComment('issues:issue', i3, '<p>Blocked until the rollout date is set</p>') // qualified form
    await mkComment('issues:issue', i4, '<p>rollout note on a binned issue</p>')
  })

  afterAll(async () => {
    for (const ws of [wsA, wsB]) {
      if (!ws) continue
      await db.execute(sql`DELETE FROM platform.comments WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM platform.labels WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM platform.workspace_members WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM issues.tasks WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM issues.projects WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM platform.entities WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${ws}`)
      await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${ws}`)
    }
    for (const id of tempUsers) await db.execute(sql`DELETE FROM platform.users WHERE id = ${id}`)
  })

  it('finds every type, and excludes markup, bin, other apps, other workspaces and ghosts', async () => {
    const hits = await find('rollout')
    expect(hits.map(key)).toEqual([
      'issue:1:Rollout checklist', // title prefix beats…
      'issue:3:Migrate billing', // …a match found only in the body
      'task:1:Rollout prep',
      'project:1:Q4 launch', // matched in its summary
      'label:-:rollout-blocker',
      'label:-:rollout-shared', // NULL app = shared with every app
      'member:-:Rolly Rollout',
      'comment:3:Migrate billing', // a comment resolves to its parent; newest first
      'comment:1:Rollout checklist',
    ])
  })

  it('reports where each match was found, and a snippet only when it was not the title', async () => {
    const hits = await find('rollout')
    const by = (t: string, n: number | null) => hits.find((h) => h.type === t && h.number === n)!
    expect(by('issue', 1).matched_in).toBe('title')
    expect(by('issue', 1).snippet).toBeNull()
    expect(by('issue', 3).matched_in).toBe('description')
    expect(by('issue', 3).snippet).toBe('Ship the rollout to EU customers') // tags stripped, &nbsp; decoded
    expect(by('project', 1).snippet).toContain('The Rollout programme')
    expect(by('comment', 1).snippet).toBe('Rollout looks good to me')
    expect(by('comment', 3).parent).toEqual({ type: 'issue', number: 3 })
    expect(by('comment', 3).detail).toBe('Rolly Rollout')
  })

  it('does not search markup: `class="rollout"` is not a hit', async () => {
    expect((await find('rollout')).some((h) => h.type === 'issue' && h.number === 2)).toBe(false)
    expect((await find('div')).filter((h) => h.type === 'issue')).toEqual([])
  })

  it('hides binned records and their comments; include_deleted shows and flags them', async () => {
    const shown = await find('rollout', { includeDeleted: true })
    const retro = shown.find((h) => h.type === 'issue' && h.number === 4)
    expect(retro?.deleted).toBe(true)
    expect(shown.filter((h) => h.type === 'comment').map((h) => h.number)).toEqual([4, 3, 1])
    expect((await find('rollout')).some((h) => h.number === 4)).toBe(false)
  })

  it('matches wildcards literally', async () => {
    expect((await find('100%')).map(key)).toEqual(['issue:5:Discount 100% off'])
    expect((await find('%')).map(key)).toEqual(['issue:5:Discount 100% off'])
    expect((await find('a_b')).map(key)).toEqual(['issue:6:a_b sync'])
  })

  it('a #number, or a bare one, puts that record first', async () => {
    expect((await find('#3', { types: ['issue'] }))[0].number).toBe(3)
    expect((await find('3', { types: ['issue'] }))[0].number).toBe(3)
  })

  it('an explicit #N finds only the records numbered N — no text matches on "3"', async () => {
    // Fixture: issue #3, plus text containing a 3 elsewhere. `#N` is a jump.
    expect((await find('#3')).map(key)).toEqual(['issue:3:Migrate billing'])
    // Bare `3` is still a text search that ALSO matches the number.
    expect((await find('3', { types: ['issue'] }))[0].number).toBe(3)
    // Nothing numbered 99: an empty answer, not a fall-back to text.
    expect(await find('#99')).toEqual([])
  })

  it('AND-matches words across fields', async () => {
    // "migrate" is only in #3's title, "rollout" only in its body.
    expect((await find('migrate rollout', { types: ['issue'] })).map(key)).toEqual(['issue:3:Migrate billing'])
    expect(await find('migrate nonexistentword')).toEqual([])
  })

  it('narrows by type, caps per type, and trims to the overall limit', async () => {
    expect((await find('rollout', { types: ['label', 'member'] })).map((h) => h.type)).toEqual([
      'label',
      'label',
      'member',
    ])
    expect((await find('rollout', { types: ['label'], perType: 1 })).length).toBe(1)
    expect((await find('rollout', { limit: 2 })).length).toBe(2)
  })

  it('members are found by email as well as name, and say so', async () => {
    const hits = await find('search-test.invalid', { types: ['member'] })
    expect(hits.map((h) => h.title)).toEqual(['Rolly Rollout'])
    expect(hits[0].matched_in).toBe('email')
  })

  it('every hit carries a path the app can open, and issues a URN', async () => {
    const hits = await find('rollout', { types: ['issue', 'label'] })
    expect(hits.find((h) => h.type === 'issue' && h.number === 1)?.path).toBe(`/dashboard/${slugA}/issues/1`)
    expect(hits.find((h) => h.type === 'issue' && h.number === 1)?.urn).toBe(`bc:issues:${slugA}/issue/1`)
    const label = hits.find((h) => h.type === 'label')!
    expect(label.path).toBe(`/dashboard/${slugA}/labels/${label.id}`)
    expect(label.urn).toBeNull()
  })

  it('an empty or #-only query finds nothing rather than everything', async () => {
    expect(await find('   ')).toEqual([])
    expect(await find('#')).toEqual([])
  })
})
