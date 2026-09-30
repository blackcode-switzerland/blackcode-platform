// The workspace overview, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=issues
//
// Skipped without it (loudly — see integrationDescribe), and it never touches
// `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// WHY THE NUMBERS ARE FIXED IN ADVANCE
// ---------------------------------------------------------------------------
// The overview is aggregation SQL, and a wrong count is byte-identical to a
// right one — nothing throws. So the fixture below is small enough to count by
// hand and every assertion is an EXACT figure worked out on paper first. `now`
// is injected (Wed 2026-09-30 12:00 UTC) so "this week / last month" mean the
// same thing on every day this test is run.
//
// The fixture is built so that the mistakes worth catching disagree with each
// other:
//
//   * i1 has TWO assignees (A and B). A query that forgot to count an issue
//     once per person gives A or B a wrong number; one that summed instead of
//     de-duplicating the WORKSPACE total gives 3 where the headline says 2.
//   * i9 is soft-deleted AND done AND assigned to A. Any query missing
//     `deleted_at IS NULL` adds one to A everywhere.
//   * Posting a comment records TWO events (`created` on the comment,
//     `commented` on the issue). B has a `created`/`comment` row that must count
//     as ACTIVITY but not as a COMMENT.
//   * A and B tie on completions this week, so leaders must list both, and the
//     tie must not be resolved by row order.
//   * One issue per calendar period (this week / month / last month / year /
//     last year) for A, each with a distinct cycle time, so a period bound off
//     by one boundary moves a number.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'issues overview: leaderboard, attention, project health',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

const NOW = new Date('2026-09-30T12:00:00Z')
const RANGE_FROM = new Date('2026-08-31T12:00:00Z') // "30 days"

run('workspace overview (integration)', () => {
  let db: typeof import('../client')['db']
  let sql: typeof import('drizzle-orm')['sql']
  let overview: typeof import('./overview')

  let workspaceId: number
  const stamp = Date.now()
  const uid: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 }
  let seq = 0
  let p1: number
  let payload: Awaited<ReturnType<typeof import('./overview')['computeOverview']>>

  async function mkIssue(o: {
    title: string
    status: string
    created: string
    completed?: string
    cancelled?: string
    deleted?: string
    reporter?: 'A' | 'B' | 'C' | 'D'
    assignees?: Array<'A' | 'B' | 'C' | 'D'>
    priority?: number
    due?: string
    project?: number
  }) {
    seq += 1
    const r = await db.execute(sql`
      INSERT INTO issues.issues
        (workspace_id, seq, title, status, priority, reporter_id, due_date, project_id,
         created_at, completed_at, cancelled_at, deleted_at)
      VALUES (${workspaceId}, ${seq}, ${o.title}, ${o.status}, ${o.priority ?? 3},
        ${o.reporter ? uid[o.reporter] : null}, ${o.due ?? null}, ${o.project ?? null},
        ${o.created}, ${o.completed ?? null}, ${o.cancelled ?? null}, ${o.deleted ?? null})
      RETURNING id`)
    const id = (r.rows[0] as { id: number }).id
    for (const a of o.assignees ?? []) {
      await db.execute(sql`
        INSERT INTO issues.issue_assignees (issue_id, user_id, assigned_at)
        VALUES (${id}, ${uid[a]}, ${o.created})`)
    }
    return id
  }

  async function mkEvent(o: {
    actor: 'A' | 'B'
    entity_type: string
    entity_id: number
    action: string
    at: string
    meta?: object
  }) {
    await db.execute(sql`
      INSERT INTO platform.events
        (workspace_id, actor_user_id, app, entity_type, entity_id, action, meta, occurred_at)
      VALUES (${workspaceId}, ${uid[o.actor]}, 'issues', ${o.entity_type}, ${o.entity_id},
        ${o.action}, ${JSON.stringify(o.meta ?? {})}::jsonb, ${o.at})`)
  }

  beforeAll(async () => {
    ;({ db } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    overview = await import('./overview')

    for (const k of ['A', 'B', 'C', 'D'] as const) {
      const u = await db.execute(sql`
        INSERT INTO platform.users (email, name)
        VALUES (${`overview-${k.toLowerCase()}-${stamp}@example.test`}, ${'Member ' + k})
        RETURNING id`)
      uid[k] = (u.rows[0] as { id: number }).id
    }
    const ws = await db.execute(sql`
      INSERT INTO platform.workspaces (name, slug, owner_id)
      VALUES ('overview-test', ${'overview-test-' + stamp}, ${uid.A}) RETURNING id`)
    workspaceId = (ws.rows[0] as { id: number }).id
    await db.execute(sql`
      INSERT INTO issues.workspace_counters (workspace_id) VALUES (${workspaceId})
      ON CONFLICT DO NOTHING`)
    for (const k of ['A', 'B', 'C', 'D'] as const) {
      await db.execute(sql`
        INSERT INTO platform.workspace_members (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${uid[k]}, ${k === 'A' ? 'owner' : 'member'})`)
    }

    const proj = await db.execute(sql`
      INSERT INTO issues.projects (workspace_id, name, seq, status)
      VALUES (${workspaceId}, 'Alpha', 1, 'in_progress'), (${workspaceId}, 'Beta', 2, 'in_progress')
      RETURNING id, seq`)
    p1 = (proj.rows as Array<{ id: number; seq: number }>).find((r) => r.seq === 1)!.id
    // Two updates on Alpha: the NEWER one (at_risk) is its health.
    await db.execute(sql`
      INSERT INTO issues.project_updates (workspace_id, project_id, status, author_id, created_at)
      VALUES (${workspaceId}, ${p1}, 'on_track', ${uid.A}, '2026-09-01T00:00:00Z'),
             (${workspaceId}, ${p1}, 'at_risk',  ${uid.B}, '2026-09-20T00:00:00Z')`)

    // i1 — TWO assignees; completed this week; cycle 96h.
    const i1 = await mkIssue({ title: 'i1 multi', status: 'done', created: '2026-09-25T12:00:00Z', completed: '2026-09-29T12:00:00Z', reporter: 'A', assignees: ['A', 'B'], project: p1 })
    // i2 — this month, not this week; cycle 216h.
    await mkIssue({ title: 'i2', status: 'done', created: '2026-09-01T12:00:00Z', completed: '2026-09-10T12:00:00Z', reporter: 'A', assignees: ['A'], project: p1 })
    // i3 — last month only; cycle 1080h.
    await mkIssue({ title: 'i3', status: 'done', created: '2026-07-01T12:00:00Z', completed: '2026-08-15T12:00:00Z', reporter: 'B', assignees: ['A'] })
    // i4 — this year only.
    await mkIssue({ title: 'i4', status: 'done', created: '2026-03-01T12:00:00Z', completed: '2026-06-01T12:00:00Z', reporter: 'B', assignees: ['A'] })
    // i5 — last year only.
    await mkIssue({ title: 'i5', status: 'done', created: '2025-01-01T12:00:00Z', completed: '2025-06-01T12:00:00Z', reporter: 'C', assignees: ['A'] })
    // i6 — open, urgent, overdue (2020), assigned to B.
    await mkIssue({ title: 'i6 urgent overdue', status: 'todo', created: '2026-09-20T12:00:00Z', reporter: 'C', assignees: ['B'], priority: 1, due: '2020-01-01', project: p1 })
    // i7 — open, unassigned, older than 30 days.
    await mkIssue({ title: 'i7 old unassigned', status: 'in_progress', created: '2026-07-01T12:00:00Z', reporter: 'C' })
    // i8 — cancelled: neither open nor completed.
    await mkIssue({ title: 'i8 cancelled', status: 'cancelled', created: '2026-09-05T12:00:00Z', cancelled: '2026-09-06T12:00:00Z', reporter: 'A', assignees: ['A'] })
    // i9 — soft-deleted, done, assigned to A. Must count nowhere.
    const i9 = await mkIssue({ title: 'i9 deleted', status: 'done', created: '2026-09-02T12:00:00Z', completed: '2026-09-29T13:00:00Z', deleted: '2026-09-30T00:00:00Z', reporter: 'A', assignees: ['A'] })

    // Events. B: three `commented` + one comment-`created` (activity, not a comment).
    for (const day of ['20', '21', '22']) {
      await mkEvent({ actor: 'B', entity_type: 'issue', entity_id: i1, action: 'commented', at: `2026-09-${day}T10:00:00Z`, meta: { seq: 1, title: 'i1 multi' } })
    }
    await mkEvent({ actor: 'B', entity_type: 'comment', entity_id: 9999, action: 'created', at: '2026-09-22T10:00:01Z' })
    // A: one comment, two other events.
    await mkEvent({ actor: 'A', entity_type: 'issue', entity_id: i1, action: 'commented', at: '2026-09-23T10:00:00Z', meta: { seq: 1, title: 'i1 multi' } })
    await mkEvent({ actor: 'A', entity_type: 'issue', entity_id: i1, action: 'status_changed', at: '2026-09-29T12:00:00Z', meta: { seq: 1, title: 'i1 multi', to: 'done' } })
    await mkEvent({ actor: 'A', entity_type: 'issue', entity_id: i9, action: 'deleted', at: '2026-09-30T00:00:00Z', meta: { seq: 9, title: 'i9 deleted' } })

    payload = await overview.computeOverview({ workspaceId, from: RANGE_FROM, to: NOW, now: NOW })
  })

  afterAll(async () => {
    if (!workspaceId) return
    await db.execute(sql`DELETE FROM platform.events WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.project_updates WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.issues WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.projects WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM issues.workspace_counters WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.workspace_members WHERE workspace_id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM platform.workspaces WHERE id = ${workspaceId}`)
    for (const id of Object.values(uid)) await db.execute(sql`DELETE FROM platform.users WHERE id = ${id}`)
  })

  const member = (k: 'A' | 'B' | 'C' | 'D') =>
    payload.overview.leaderboard.members.find((m) => m.user_id === uid[k])!

  it('counts completions per period exactly, deleted issues nowhere', () => {
    const a = member('A').periods
    expect({
      range: a.range.completed,
      this_week: a.this_week.completed,
      this_month: a.this_month.completed,
      last_month: a.last_month.completed,
      this_year: a.this_year.completed,
      last_year: a.last_year.completed,
      all_time: a.all_time.completed,
    }).toEqual({ range: 2, this_week: 1, this_month: 2, last_month: 1, this_year: 4, last_year: 1, all_time: 5 })
  })

  it('counts a multi-assignee issue once per person, and once in the headline', () => {
    // A and B each completed i1; the workspace completed it ONCE.
    expect(member('B').periods.range.completed).toBe(1)
    expect(member('A').periods.this_week.completed).toBe(1)
    expect(payload.summary.completed_in_period).toBe(2) // i1 + i2, not 3
    const sum = payload.overview.leaderboard.members.reduce((n, m) => n + m.periods.range.completed, 0)
    expect(sum).toBe(3) // 2 for A + 1 for B: per-person, so > the headline by design
  })

  it('attributes creation to the reporter, not the assignee', () => {
    expect(member('A').periods.range.created).toBe(3) // i1, i2, i8
    expect(member('C').periods.range.created).toBe(1) // i6 (i7 is July)
    expect(member('B').periods.range.created).toBe(0)
    expect(member('C').periods.last_year.created).toBe(1)
  })

  it('computes average cycle time over the completions in the period', () => {
    expect(member('A').periods.range.avg_cycle_time_hours).toBe(156) // (96 + 216) / 2
    expect(member('B').periods.range.avg_cycle_time_hours).toBe(96)
    expect(member('A').periods.last_month.avg_cycle_time_hours).toBe(1080)
    expect(member('C').periods.range.avg_cycle_time_hours).toBeNull()
  })

  it('counts open assigned as a snapshot, excluding done and cancelled', () => {
    expect(member('A').open_assigned).toBe(0) // i8 cancelled, i9 deleted
    expect(member('B').open_assigned).toBe(1) // i6
    expect(member('C').open_assigned).toBe(0)
  })

  it('separates comments from activity', () => {
    expect(member('B').periods.range.comments).toBe(3)
    expect(member('B').periods.range.activity).toBe(4) // + the comment-created row
    expect(member('A').periods.range.comments).toBe(1)
    expect(member('A').periods.range.activity).toBe(3)
    expect(member('C').periods.range.activity).toBe(0)
  })

  it('ranks by completed, then created, then name; ties get distinct ranks', () => {
    const ranks = Object.fromEntries(
      (['A', 'B', 'C', 'D'] as const).map((k) => [k, member(k).periods.range.rank])
    )
    expect(ranks).toEqual({ A: 1, B: 2, C: 3, D: 4 }) // C created 1, D created 0
    expect(payload.overview.leaderboard.members.map((m) => m.user_id)).toEqual([uid.A, uid.B, uid.C, uid.D])
  })

  it('marks every leader, lists ties, and names no leader at zero', () => {
    const L = payload.overview.leaderboard.leaders
    expect(L.range.completed).toEqual({ user_ids: [uid.A], value: 2 })
    expect(L.range.created).toEqual({ user_ids: [uid.A], value: 3 })
    expect(L.range.comments).toEqual({ user_ids: [uid.B], value: 3 })
    expect(L.range.activity).toEqual({ user_ids: [uid.B], value: 4 })
    expect(L.range.fastest_cycle).toEqual({ user_ids: [uid.B], value: 96 }) // lowest wins
    // A and B tie on completions this week — both listed.
    expect([...L.this_week.completed!.user_ids].sort()).toEqual([uid.A, uid.B].sort())
    expect(L.this_week.completed!.value).toBe(1)
    // Nobody commented last year: no leader rather than a leader at 0.
    expect(L.last_year.comments).toBeUndefined()
  })

  it('gives every member a 12-week sparkline that ends on this week', () => {
    const a = member('A')
    expect(a.spark).toHaveLength(12)
    expect(a.spark[11]).toBe(1) // i1, completed Sep 29 (this week)
    expect(a.spark[10]).toBe(0)
    // i2 (Sep 10) is in the week of Sep 7 = 3 weeks before the week of Sep 28.
    expect(a.spark[8]).toBe(1)
    expect(member('D').spark.every((n) => n === 0)).toBe(true)
  })

  it('builds the attention lists from live open issues only', () => {
    const at = payload.overview.attention
    expect(at.overdue.total).toBe(1)
    expect(at.overdue.items[0].title).toBe('i6 urgent overdue')
    expect(at.urgent.total).toBe(1)
    expect(at.old_open.total).toBe(1)
    expect(at.old_open.items[0].title).toBe('i7 old unassigned')
    expect(at.old_open.items[0].age_days).toBe(91)
    expect(at.unassigned.total).toBe(1)
    expect(at.unassigned.items[0].assignees).toEqual([])
    expect(at.overdue.items[0].assignees.map((x) => x.user_id)).toEqual([uid.B])
  })

  it('reports workload by open status and the unassigned count', () => {
    const w = payload.overview.workload
    expect(w.statuses).toEqual(['backlog', 'todo', 'in_progress'])
    expect(w.members).toHaveLength(1) // only B has open work
    expect(w.members[0].user_id).toBe(uid.B)
    expect(w.members[0].by_status).toEqual({ backlog: 0, todo: 1, in_progress: 0 })
    expect(w.unassigned).toBe(1)
  })

  it('takes project health from the LATEST update and sorts risk first', () => {
    const [alpha, beta] = payload.overview.projects
    expect(alpha.name).toBe('Alpha')
    expect(alpha.health).toBe('at_risk')
    expect({ total: alpha.total, done: alpha.done, open: alpha.open, pct: alpha.progress_pct }).toEqual({
      total: 3,
      done: 2,
      open: 1,
      pct: 67,
    })
    expect(beta.name).toBe('Beta')
    expect(beta.health).toBeNull()
    expect(beta.progress_pct).toBe(0)
  })

  it('reconstructs the snapshot KPIs at the start of the range', () => {
    const k = payload.overview.kpi_trends
    // Before Aug 31 12:00 the workspace held i3, i4, i5, i7 (i9 is deleted).
    expect(k.total).toEqual({ current: 8, previous: 4, pct: 100 })
    expect(k.open).toEqual({ current: 2, previous: 1, pct: 100 })
    expect(k.overdue).toEqual({ current: 1, previous: 0, pct: 100 })
    expect(k.unassigned).toEqual({ current: 1, previous: 1, pct: 0 })
    expect(k.completion_rate).toEqual({ current: 71.4, previous: 75, pct: -4.8 })
  })

  it('feeds the activity list newest first, skipping comment rows, unlinking deleted subjects', () => {
    const feed = payload.overview.recent_activity
    expect(feed.some((r) => r.entity_type === 'comment')).toBe(false)
    expect(feed[0]).toMatchObject({ action: 'deleted', entity_seq: 9, linkable: false })
    const status = feed.find((r) => r.action === 'status_changed')!
    expect(status).toMatchObject({ entity_seq: 1, entity_title: 'i1 multi', to: 'done', linkable: true })
    expect(status.actor?.user_id).toBe(uid.A)
  })

  it('has no previous period for "All", and reports the requested window', async () => {
    const all = await overview.computeOverview({ workspaceId, from: null, to: NOW, now: NOW })
    expect(all.period.from).toBeNull()
    expect(all.trends.completed.previous).toBeNull()
    expect(all.trends.completed.pct).toBeNull()
    expect(all.overview.kpi_trends.total.previous).toBeNull()
    expect(all.overview.range.days).toBeNull()
    // "range" equals all_time when nothing bounds it.
    expect(all.overview.leaderboard.members[0].periods.range.completed).toBe(
      all.overview.leaderboard.members[0].periods.all_time.completed
    )
  })

  it('carries avatar_url on the analytics assignee and top-member rows', () => {
    expect(payload.by_assignee.length).toBeGreaterThan(0)
    for (const r of payload.by_assignee) expect(r).toHaveProperty('avatar_url')
    for (const r of payload.top_active_members) expect(r).toHaveProperty('avatar_url')
  })
})
