// The combinable prospect filters, the facets that feed them, the company's own
// phone/email, and the template↔strategy tag — sales #98, #60, #62.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=sales
//
// Skipped LOUDLY without it, and it never touches `DATABASE_URL` — the guard
// `prospects-strategy-filter.integration.test.ts` uses, for the same reason.
//
// ── WHAT EACH CASE IS THERE TO CATCH ────────────────────────────────────────
// The fixture is built so that every wrong implementation fails at least one
// case. Six prospects, deliberately overlapping:
//
//   A  Lausanne  Watches   referral   owner1  label vip
//   B  lausanne  Jewellery referral   owner2            (lower-case city: one facet with A)
//   C  Genève    Watches   maps       owner1  label vip
//   D  Genève    Jewellery maps       —
//   E  Bienne, BE Watches  —          —                 (a comma inside a value)
//   F  (no city) —         —          —                 (a NULL is not a facet)
//
// * OR-within vs AND-across: `cities:[Lausanne,Genève]` must return A,B,C,D
//   (OR); adding `sectors:[Watches]` must narrow to A,C (AND). A filter that
//   ANDed both cities returns nothing; one that ORed across dimensions returns
//   E as well.
// * case-insensitive: "LAUSANNE" finds A and B.
// * exact, not substring: "Laus" finds nothing.
// * the comma value: "Bienne, BE" finds E — a comma-splitting implementation
//   turns it into two values that match nothing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'sales prospects: combinable filters, facets, phone/email, template strategy',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('prospect filters (integration)', () => {
  let db: ReturnType<(typeof import('../client'))['getDb']>
  let schema: typeof import('../schema')
  let prospectsQ: typeof import('./prospects')
  let labelsQ: typeof import('./labels')
  let catalogQ: typeof import('./catalog')
  let strategiesQ: typeof import('./strategies')
  let eq: (typeof import('drizzle-orm'))['eq']

  let suffix: string
  let owner1: number
  let owner2: number
  let wsId: number
  let strategyId: number
  const seqs: Record<string, number> = {}

  const actor = () => ({ userId: owner1, tokenId: null, label: 'Companion' })
  const names = (page: { data: Array<{ name: string }> }) =>
    page.data.map((p) => p.name.replace(` ${suffix}`, '')).sort()

  beforeAll(async () => {
    db = (await import('../client')).getDb()
    schema = await import('../schema')
    prospectsQ = await import('./prospects')
    labelsQ = await import('./labels')
    catalogQ = await import('./catalog')
    strategiesQ = await import('./strategies')
    eq = (await import('drizzle-orm')).eq

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const mkUser = async (tag: string) =>
      (
        await db
          .insert(schema.users)
          .values({ email: `sales_pf_${tag}_${suffix}@test.local`, name: `Filter ${tag}` })
          .returning({ id: schema.users.id })
      )[0]!.id
    owner1 = await mkUser('one')
    owner2 = await mkUser('two')

    const [ws] = await db
      .insert(schema.salesWorkspaces)
      .values({
        name: `Filters WS ${suffix}`.slice(0, 80),
        slug: `sales-pf-${suffix}`.slice(0, 40),
        owner_id: owner1,
      })
      .returning({ id: schema.salesWorkspaces.id })
    wsId = ws!.id

    const make = async (
      key: string,
      f: { city?: string; sector?: string; source?: string; ownerUserId?: number }
    ) => {
      const p = await prospectsQ.createProspect({
        workspaceId: wsId,
        actor: actor(),
        name: `${key} ${suffix}`,
        city: f.city ?? null,
        sector: f.sector ?? null,
        source: f.source ?? null,
        ownerUserId: f.ownerUserId ?? null,
      })
      seqs[key] = p.seq
      return p
    }
    const A = await make('A', { city: 'Lausanne', sector: 'Watches', source: 'referral', ownerUserId: owner1 })
    await make('B', { city: 'lausanne', sector: 'Jewellery', source: 'referral', ownerUserId: owner2 })
    const C = await make('C', { city: 'Genève', sector: 'Watches', source: 'maps', ownerUserId: owner1 })
    await make('D', { city: 'Genève', sector: 'Jewellery', source: 'maps' })
    await make('E', { city: 'Bienne, BE', sector: 'Watches' })
    await make('F', {})

    const vip = await labelsQ.createLabel(wsId, { name: 'VIP' }, actor())
    const other = await labelsQ.createLabel(wsId, { name: 'Cold' }, actor())
    await labelsQ.attachLabel(wsId, A.id, vip.id, actor())
    await labelsQ.attachLabel(wsId, C.id, vip.id, actor())
    await labelsQ.attachLabel(wsId, C.id, other.id, actor())

    strategyId = (await strategiesQ.createStrategy(wsId, { name: `Seg ${suffix}` }, actor())).id
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.salesWorkspaces).where(eq(schema.salesWorkspaces.id, wsId))
    for (const id of [owner1, owner2]) {
      if (id) await db.delete(schema.users).where(eq(schema.users.id, id))
    }
  })

  const list = (f: Partial<Parameters<typeof prospectsQ.listProspects>[0]>) =>
    prospectsQ.listProspects({ workspaceId: wsId, limit: 100, ...f })

  // ── #98 ───────────────────────────────────────────────────────────────────
  it('OR within one dimension: two cities return both cities', async () => {
    expect(names(await list({ cities: ['Lausanne', 'Genève'] }))).toEqual(['A', 'B', 'C', 'D'])
  })

  it('AND across dimensions: a second dimension NARROWS, it does not widen', async () => {
    expect(names(await list({ cities: ['Lausanne', 'Genève'], sectors: ['Watches'] }))).toEqual([
      'A',
      'C',
    ])
  })

  it('three dimensions at once', async () => {
    expect(
      names(await list({ cities: ['Genève'], sectors: ['Watches'], sources: ['maps'] }))
    ).toEqual(['C'])
  })

  it('matches case-insensitively, so the two spellings of a city are one filter', async () => {
    expect(names(await list({ cities: ['LAUSANNE'] }))).toEqual(['A', 'B'])
  })

  it('is exact, not a substring: a fragment finds nothing', async () => {
    expect(names(await list({ cities: ['Laus'] }))).toEqual([])
  })

  it('a value containing a comma is one value', async () => {
    expect(names(await list({ cities: ['Bienne, BE'] }))).toEqual(['E'])
  })

  it('sector and source are filters too', async () => {
    expect(names(await list({ sectors: ['jewellery'] }))).toEqual(['B', 'D'])
    expect(names(await list({ sources: ['Maps'] }))).toEqual(['C', 'D'])
  })

  it('labels: OR within, and a prospect with several labels appears once', async () => {
    expect(names(await list({ labels: ['vip'] }))).toEqual(['A', 'C'])
    const both = await list({ labels: ['vip', 'cold'] })
    expect(names(both)).toEqual(['A', 'C'])
    expect(both.data.filter((p) => p.name.startsWith('C ')).length).toBe(1)
  })

  it('owners: several owners are OR, and it composes with another dimension', async () => {
    expect(names(await list({ ownerUserIds: [owner1, owner2] }))).toEqual(['A', 'B', 'C'])
    expect(names(await list({ ownerUserIds: [owner1, owner2], cities: ['Genève'] }))).toEqual(['C'])
  })

  it('the single-owner spelling still works', async () => {
    expect(names(await list({ ownerUserId: owner2 }))).toEqual(['B'])
  })

  it('blank and empty values are no filter at all, never "match nothing"', async () => {
    expect((await list({ cities: [], sectors: ['  '], labels: [''] })).data.length).toBe(6)
  })

  it('facets list what exists, case-folded, counted, and skip NULL', async () => {
    const f = await prospectsQ.prospectFacets(wsId)
    // Lausanne + lausanne are ONE facet of two; F's missing city is not one.
    expect(f.cities.find((c) => c.value.toLowerCase() === 'lausanne')?.count).toBe(2)
    expect(f.cities.map((c) => c.value.toLowerCase()).sort()).toEqual(
      ['bienne, be', 'genève', 'lausanne'].sort()
    )
    expect(f.sectors.map((c) => c.value).sort()).toEqual(['Jewellery', 'Watches'])
    expect(f.sources.find((c) => c.value === 'maps')?.count).toBe(2)
    expect(f.labels.find((l) => l.value === 'VIP')?.count).toBe(2)
    expect(f.owners.map((o) => o.count).sort()).toEqual([1, 2])
  })

  it('facets do not count a binned prospect', async () => {
    const before = (await prospectsQ.prospectFacets(wsId)).sectors.find((s) => s.value === 'Jewellery')!
    await prospectsQ.softDeleteProspect(wsId, seqs.D!, actor())
    const after = (await prospectsQ.prospectFacets(wsId)).sectors.find((s) => s.value === 'Jewellery')!
    expect(after.count).toBe(before.count - 1)
  })

  // ── #60 ───────────────────────────────────────────────────────────────────
  it('phone and email are real columns: written, read, cleared', async () => {
    const created = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: `Reach ${suffix}`,
      phone: '021 312 80 91',
      email: 'info@example.ch',
    })
    expect(created.phone).toBe('021 312 80 91')
    expect(created.email).toBe('info@example.ch')

    const edited = await prospectsQ.updateProspect(wsId, created.seq, { phone: '+41 21 312 80 92' }, actor())
    expect(edited?.phone).toBe('+41 21 312 80 92')
    expect(edited?.email).toBe('info@example.ch') // untouched by a patch that omitted it

    const cleared = await prospectsQ.updateProspect(wsId, created.seq, { phone: null, email: null }, actor())
    expect(cleared?.phone).toBeNull()
    expect(cleared?.email).toBeNull()
  })

  // ── #62 ───────────────────────────────────────────────────────────────────
  it('a template can be tagged with a strategy, filtered by it, untagged, and survives its retirement', async () => {
    const t = await catalogQ.createTemplate(
      wsId,
      { channel: 'email', category: 'intro', name: `Tagged ${suffix}`, strategyId },
      actor()
    )
    const plain = await catalogQ.createTemplate(
      wsId,
      { channel: 'email', category: 'intro', name: `Plain ${suffix}` },
      actor()
    )
    expect(t.strategy_seq).not.toBeNull()
    expect(plain.strategy_seq).toBeNull()

    const only = await catalogQ.listTemplates({ workspaceId: wsId, strategyId })
    expect(only.map((x) => x.seq)).toEqual([t.seq])
    expect((await catalogQ.listTemplates({ workspaceId: wsId })).length).toBeGreaterThanOrEqual(2)

    // The strategy's own read of the chain.
    const seen = await strategiesQ.listStrategyTemplates(wsId, strategyId)
    expect(seen.map((x) => x.number)).toEqual([t.seq])
    expect((await strategiesQ.getStrategyBySeq(wsId, t.strategy_seq!))?.template_count).toBe(1)

    // A patch that does not mention `strategyId` leaves the tag alone…
    const renamed = await catalogQ.updateTemplate(wsId, t.seq, { name: `Renamed ${suffix}` }, actor())
    expect(renamed?.strategy_seq).toBe(t.strategy_seq)
    // …and `null` unlinks it.
    const untagged = await catalogQ.updateTemplate(wsId, t.seq, { strategyId: null }, actor())
    expect(untagged?.strategy_seq).toBeNull()
  })

  it('deleting a strategy row leaves its templates, untagged (ON DELETE SET NULL)', async () => {
    const s = await strategiesQ.createStrategy(wsId, { name: `Doomed ${suffix}` }, actor())
    const t = await catalogQ.createTemplate(
      wsId,
      { channel: 'call', category: 'meeting', name: `Orphan ${suffix}`, strategyId: s.id },
      actor()
    )
    await db.delete(schema.strategies).where(eq(schema.strategies.id, s.id))
    const after = await catalogQ.getTemplateBySeq(wsId, t.seq)
    expect(after).not.toBeNull()
    expect(after?.strategy_seq).toBeNull()
  })
})
