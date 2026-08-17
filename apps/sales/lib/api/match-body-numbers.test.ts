// `POST …/prospects/{n}/matches` — the route read its two numeric body fields
// through a STRING coercion, so the CLI could never set a match.
//
// ===========================================================================
// THE BUG (sales #38, reproduced live 2026-08-17)
// ===========================================================================
//     const productNumber = numberOr(str(body?.product) ?? null)
//
// `str()` returns undefined for anything that is not a string, by design — it
// is the trimmer for free text. `SetMatchRequest.Product` is a Go `int`, so
// `bk sales match set 11 --product 8` puts `{"product": 8}` on the wire: a JSON
// NUMBER. `str(8)` is undefined, `numberOr(null)` is undefined, and the route
// answered `400 missing_product` naming a product that exists.
//
// The error was maximally misleading — it told the caller to look up a number
// they had already passed correctly — and it made the whole `match` verb group
// unreachable from the CLI, which is the only agent surface (CLAUDE.md, agent
// surface contract). `--template` had the identical defect one field down.
//
// Every other route in this app reads numbers from the QUERY STRING, where
// `numberOr(str(...))` is right because the value genuinely is a string. This
// is the only route that reads them from a JSON body, which is why it is the
// only one that carried the bug.
//
// ===========================================================================
// WHAT THIS FILE ASSERTS
// ===========================================================================
// The POSITIVE case first (CLAUDE.md finding #16): a JSON number REACHES
// `setMatch` with the right product id. `calls.set` is what discriminates —
// asserting only `res.status !== 400` would pass against a route that 500s, and
// asserting only "a 201 came back" would pass against one that matched the
// WRONG product, which is the failure that would be silently wrong forever.
//
// Watched fail on 2026-08-17 by restoring `numberOr(str(body?.product) ?? null)`:
// the two number cases go red on `calls.set` (400, nothing recorded) while the
// string cases stay green — that pair is the point. The string cases are not
// decoration: an agent on an older client, or a hand-rolled `curl`, sends
// `"8"`, and a fix that swapped one coercion for the other would trade this bug
// for its mirror image.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

const PROSPECT_SEQ = 11
const PROSPECT_ID = 991
const PRODUCT = { id: 5001, seq: 8, name: 'Websites' }
const TEMPLATE = { id: 7001, seq: 2, name: 'Boutique opener' }

const calls = vi.hoisted(() => ({
  set: [] as Array<{ productId: number; templateId: number | null; fit: number | null }>,
  everSet: [] as number[],
}))

vi.mock('@/lib/db/queries/prospect-children', () => ({
  prospectIdBySeq: async (_ws: number, seq: number) => (seq === PROSPECT_SEQ ? PROSPECT_ID : null),
  setMatch: async (
    _ws: number,
    _prospectId: number,
    input: { productId: number; fit?: number | null; templateId?: number | null }
  ) => {
    calls.set.push({
      productId: input.productId,
      templateId: input.templateId ?? null,
      fit: input.fit ?? null,
    })
    calls.everSet.push(input.productId)
    return {}
  },
  listMatches: async () => [
    {
      product_id: PRODUCT.id,
      product_number: PRODUCT.seq,
      product_name: PRODUCT.name,
      template_number: TEMPLATE.seq,
      template_name: TEMPLATE.name,
      fit: 80,
      why: null,
      computed_at: new Date('2026-08-17T10:00:00Z'),
      computed_by_label: 'Companion',
    },
  ],
  clearMatch: async () => true,
}))

vi.mock('@/lib/db/queries/catalog', () => ({
  getProductBySeq: async (_ws: number, seq: number) => (seq === PRODUCT.seq ? PRODUCT : null),
  getTemplateBySeq: async (_ws: number, seq: number) => (seq === TEMPLATE.seq ? TEMPLATE : null),
}))

vi.mock('@/lib/actor', () => ({
  resolveActor: async () => ({ userId: 7, tokenId: 3, label: 'Companion' }),
}))

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))

vi.mock('@/lib/api', async () => {
  const { createApiHandler } = await import('@blackcode/platform-api')
  const ctx = {
    appSlug: 'sales',
    db: {} as never,
    resolveUser: async () => ({ id: 7, email: 'a@b.test' }) as never,
    redactBody: true,
  }
  return {
    apiHandler: createApiHandler(ctx as never),
    resolveWorkspace: async () => ({
      user: { id: 7, email: 'a@b.test', name: 'Bala' },
      workspace: { id: 3, slug: 'blackcode', name: 'Blackcode' },
      role: 'owner',
    }),
  }
})

import { POST } from '@/app/api/workspaces/[ws]/prospects/[n]/matches/route'

function post(
  body: unknown
): [NextRequest, { params: Promise<{ ws: string; n: string }> }] {
  return [
    new NextRequest(
      `https://sales.test/api/workspaces/blackcode/prospects/${PROSPECT_SEQ}/matches`,
      { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
    ),
    { params: Promise.resolve({ ws: 'blackcode', n: String(PROSPECT_SEQ) }) },
  ]
}

describe('POST …/matches — a numeric body field is a number on the wire', () => {
  beforeEach(() => {
    calls.set.length = 0
  })

  it('accepts a JSON NUMBER product and records THAT product — the bk shape', async () => {
    const res = await POST(...post({ product: PRODUCT.seq, why: 'e-commerce fit' }))
    expect(res.status, await res.text().catch(() => '')).toBe(201)
    expect(calls.set, '`{"product": 8}` never reached setMatch').toEqual([
      { productId: PRODUCT.id, templateId: null, fit: null },
    ])
  })

  it('accepts a JSON NUMBER template alongside it', async () => {
    const res = await POST(...post({ product: PRODUCT.seq, template: TEMPLATE.seq, fit: 80 }))
    expect(res.status).toBe(201)
    expect(calls.set).toEqual([
      { productId: PRODUCT.id, templateId: TEMPLATE.id, fit: 80 },
    ])
  })

  it('still accepts a numeric STRING, for a hand-rolled caller', async () => {
    const res = await POST(...post({ product: String(PRODUCT.seq), template: String(TEMPLATE.seq) }))
    expect(res.status).toBe(201)
    expect(calls.set).toEqual([
      { productId: PRODUCT.id, templateId: TEMPLATE.id, fit: null },
    ])
  })

  it('still refuses an ABSENT product with missing_product', async () => {
    const res = await POST(...post({ why: 'no product named' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('missing_product')
    expect(calls.set).toEqual([])
  })

  it('still refuses a NON-NUMERIC product rather than coercing it to NaN', async () => {
    const res = await POST(...post({ product: 'websites' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('missing_product')
    expect(calls.set).toEqual([])
  })

  it('still 404s a product number that is not in this workspace', async () => {
    const res = await POST(...post({ product: 9999 }))
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.code).toBe('product_not_found')
    expect(calls.set).toEqual([])
  })

  it('THE PREMISE: this route can reach setMatch, and only with the right product id', () => {
    // Without it, every "refuses" assertion above would pass against a route
    // that rejects everything — CLAUDE.md finding #16, which is the disease
    // this whole file exists to cure in the first place.
    expect(calls.everSet, 'no case in this file ever reached setMatch').toEqual([
      PRODUCT.id,
      PRODUCT.id,
      PRODUCT.id,
    ])
  })
})
