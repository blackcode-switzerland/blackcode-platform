// `GET /api/meta` serves a contract hash, and the hash moves when the public
// contract does.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Until 2026-09-17 it served none. The integration conventions told outside
// systems to "poll contract_version from /api/meta", `lib/integration.ts` said
// the public routes "ride inside contractVersion automatically", and nothing
// called `contractVersion`. Ticket #77 asked for the hash to be observed moving
// when `PUBLIC_ROUTES` gained an entry; there was no hash to observe.
//
// So this calls the real route, anonymously, twice: once with the real public
// routes and once with one more, and asserts on the RESPONSE.
//
// Watched failing on 2026-09-17: with the `contractVersion` call replaced by a
// constant string, "moves when a public route is added" went red. Restored.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/api', () => ({
  apiHandler: (fn: (req: NextRequest) => Promise<Response>) => fn,
  appContext: { resolveUser: async () => null },
}))

async function servedHash(extraRoute: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules()
  if (extraRoute) {
    vi.doMock('@/lib/integration', async (orig) => {
      const real = (await orig()) as typeof import('@/lib/integration')
      return {
        ...real,
        PUBLIC_ROUTES: [
          ...real.PUBLIC_ROUTES,
          { method: 'GET', path: '/api/workspaces/{ws}/invoices/{ref}/pdf', since: '2026-09-17', purpose: 'test' },
        ],
      }
    })
  } else {
    vi.doUnmock('@/lib/integration')
  }
  const { GET } = await import('@/app/api/meta/route')
  const res = (await GET(new NextRequest('http://localhost:3300/api/meta'), undefined as never)) as NextResponse
  return { status: res.status, body: await res.json() }
}

afterEach(() => {
  vi.doUnmock('@/lib/integration')
})

describe('GET /api/meta contract_version', () => {
  it('is served to an anonymous caller, as a short hash', async () => {
    const { status, body } = await servedHash(false)
    expect(status).toBe(200)
    expect(body.contract_version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is stable across requests when nothing changed', async () => {
    expect((await servedHash(false)).body.contract_version).toBe((await servedHash(false)).body.contract_version)
  })

  it('moves when a public route is added, and returns when it is removed', async () => {
    const before = (await servedHash(false)).body.contract_version
    const withExtra = (await servedHash(true)).body.contract_version
    const after = (await servedHash(false)).body.contract_version
    expect(withExtra).not.toBe(before)
    expect(after).toBe(before)
  })
})
