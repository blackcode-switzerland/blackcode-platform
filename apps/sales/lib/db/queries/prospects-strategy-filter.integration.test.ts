// `listProspects({ strategyId })` — the read side of the boss's ask: filter
// and segment prospects strategy-by-strategy, and never fall back to the
// unsegmented global list when a strategy filter is active.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=sales
//
// Skipped without it, and it never touches `DATABASE_URL` — same guard
// `write-paths.integration.test.ts` uses, for the same reason: a check that
// cannot run yet must SKIP LOUDLY (CLAUDE.md's standing rule), never silently.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'sales prospects: strategy filter',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('listProspects strategyId filter (integration)', () => {
  let db: ReturnType<(typeof import('../client'))['getDb']>
  let schema: typeof import('../schema')
  let prospectsQ: typeof import('./prospects')
  let strategiesQ: typeof import('./strategies')
  let eq: (typeof import('drizzle-orm'))['eq']

  let suffix: string
  let ownerId: number
  let wsId: number
  let strategyAId: number
  let strategyBId: number

  const actor = () => ({ userId: ownerId, tokenId: null, label: 'Companion' })

  beforeAll(async () => {
    db = (await import('../client')).getDb()
    schema = await import('../schema')
    prospectsQ = await import('./prospects')
    strategiesQ = await import('./strategies')
    const orm = await import('drizzle-orm')
    eq = orm.eq

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `sales_sf_${suffix}@test.local`, name: 'Strategy Filter Owner' })
      .returning({ id: schema.users.id })
    ownerId = owner!.id

    const [ws] = await db
      .insert(schema.salesWorkspaces)
      .values({
        name: `Strategy Filter WS ${suffix}`.slice(0, 80),
        slug: `sales-sf-${suffix}`.slice(0, 40),
        owner_id: ownerId,
      })
      .returning({ id: schema.salesWorkspaces.id })
    wsId = ws!.id

    const stratA = await strategiesQ.createStrategy(wsId, { name: `Segment A ${suffix}` }, actor())
    const stratB = await strategiesQ.createStrategy(wsId, { name: `Segment B ${suffix}` }, actor())
    strategyAId = stratA.id
    strategyBId = stratB.id

    // Three prospects: two on strategy A, one on strategy B, one unlinked —
    // the shape that would pass a filter which only checks "is it set".
    await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: `Filter Target 1 ${suffix}`,
      strategyId: strategyAId,
    })
    await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: `Filter Target 2 ${suffix}`,
      strategyId: strategyAId,
    })
    await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: `Other Segment ${suffix}`,
      strategyId: strategyBId,
    })
    await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: `Unlinked ${suffix}`,
    })
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.salesWorkspaces).where(eq(schema.salesWorkspaces.id, wsId))
    if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId))
  })

  it('returns only the prospects linked to the given strategy — never the unsegmented list', async () => {
    const page = await prospectsQ.listProspects({ workspaceId: wsId, strategyId: strategyAId })
    expect(page.data.map((p) => p.name).sort()).toEqual(
      [`Filter Target 1 ${suffix}`, `Filter Target 2 ${suffix}`].sort()
    )
  })

  it('THE CONTRAST: a filter for the OTHER strategy excludes the first two', async () => {
    // Written against a filter that only checked "is strategy_id set" — which
    // would have passed the case above by accident. This is the case that
    // shape cannot pass.
    const page = await prospectsQ.listProspects({ workspaceId: wsId, strategyId: strategyBId })
    expect(page.data.map((p) => p.name)).toEqual([`Other Segment ${suffix}`])
  })

  it('a strategy with no prospects returns an empty page, not an error', async () => {
    const empty = await strategiesQ.createStrategy(wsId, { name: `Empty Segment ${suffix}` }, actor())
    const page = await prospectsQ.listProspects({ workspaceId: wsId, strategyId: empty.id })
    expect(page.data).toEqual([])
  })

  it('no strategy filter returns the full unsegmented workspace list (the default stays additive)', async () => {
    const page = await prospectsQ.listProspects({ workspaceId: wsId, limit: 100 })
    expect(page.data.length).toBeGreaterThanOrEqual(4)
  })
})
