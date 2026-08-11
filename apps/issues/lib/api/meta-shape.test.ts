// /api/meta's deprecated top-level keys must stay the SAME OBJECTS as the
// nested copies, and the document must keep its shape.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ASSERTED RATHER THAN ASSUMED
// ---------------------------------------------------------------------------
// `vocabulary`, `limits` and `media` are served twice: nested under
// `apps.issues` (current) and at the top level (deprecated 2026-08-04, removed
// after two minor releases). The route's own comment has always said they must
// be the same object references, not copies — "a divergence between the old and
// new spelling during the overlap would be worse than either shape alone".
//
// Before the platform half was extracted, that was true by inspection: one file
// built both. Now the nested copy travels through `platformMetaBlock` and the
// top-level one does not, so "same object" became a property that could quietly
// stop holding — a helper that cloned its input, a `structuredClone` added for
// safety, a spread that looked harmless. Nothing else in the suite would notice:
// the response would still be correct on the day of the change, and would drift
// only later, which is the worst possible failure shape for a document agents
// read to learn what is legal.
//
// So it is checked with `toBe` (identity), not `toEqual` (value). `toEqual`
// would pass on a clone, which is exactly the case this exists to catch.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

const USER = {
  id: 1,
  email: 'ada@example.test',
  name: 'Ada',
  avatar_url: null,
  active_workspace_id: null,
  google_id: null,
}

// The route's own dependencies, stubbed at the boundary. Everything the platform
// helper reads is a database call; stubbing them keeps this a shape test.
vi.mock('@/lib/auth/resolve', () => ({
  resolveAuth: async () => ({ user: USER, via: 'token' }),
  resolveUser: async () => USER,
}))
vi.mock('@/lib/db/queries/users', () => ({
  getUserById: async () => USER,
  getUserByEmail: async () => USER,
}))
// `getUserById` joined this list on 2026-08-10. `platformMetaBlock` stopped
// reading `user.active_workspace_id` off the resolved caller and now asks
// `AppContext.workspaces.getDefaultForUser`, which re-reads the user so a token
// minted before the last `bk workspace use` cannot report a stale default. That
// is one more database call, and an unstubbed one made this whole file 500 —
// visibly, because `metaBody` asserts the fixture produced a real 200 before it
// asserts anything about the document. Without that premise assertion the five
// cases below would have silently started checking an error envelope.
vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blackcode/platform-db')>()),
  getUserById: async () => USER,
  // The APP REGISTRY. This replaced two stubs on 2026-08-10 —
  // `getAppRegistryEntry` (the current app's own row) and `appsReachableByUser`
  // (the grant-derived list of every other app). Phase 5 dropped
  // `platform.app_access`, so `/api/meta` reads the address book instead and
  // there is one lookup where there were two.
  //
  // It returns TWO apps deliberately, and only one of them is this one: the
  // registry is no longer filtered by what the caller can reach, and the shape
  // assertions below have to see a foreign entry to be checking the real
  // document. An unstubbed call made this whole file 500 — visibly, because
  // `metaBody` asserts a real 200 first.
  listAppRegistry: async () => [
    { slug: 'issues', name: 'Blackcode Issues', base_url: null },
    { slug: 'sales', name: 'Sales', base_url: 'https://sales.blackcode.test' },
  ],
  getWorkspaceForUser: async () => null,
  listMyWorkspaces: async () => [],
  listWorkspaceMembers: async () => [],
}))

/**
 * The payload object the route hands to `NextResponse.json`, BEFORE
 * serialization.
 *
 * It has to be captured here rather than read back from `res.json()`: JSON has
 * no notion of a shared reference, so a round-trip turns the two copies into two
 * objects no matter what the route did. Reading the response back would make the
 * identity assertion below impossible to fail — which is the failure mode this
 * whole file exists to guard against.
 */
async function metaBody(): Promise<Record<string, unknown>> {
  const json = vi.spyOn(NextResponse, 'json')
  const { GET } = await import('@/app/api/meta/route')
  const res = await GET(new NextRequest('https://issues.blackcode.test/api/meta'), undefined)
  expect(res.status, 'the fixture must produce a real 200 document').toBe(200)
  expect(json, 'the route did not serialize anything').toHaveBeenCalled()
  return json.mock.calls[json.mock.calls.length - 1][0] as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/meta shape', () => {
  it('THE PREMISE: the current app has an entry carrying its vocabulary', async () => {
    // Without this, the identity assertions below are satisfied by two
    // `undefined`s — the classic vacuous pass.
    const body = await metaBody()
    const apps = body.apps as Record<string, Record<string, unknown>>
    expect(apps.issues, 'no `apps.issues` entry — the whole check is vacuous').toBeDefined()
    expect(apps.issues.is_current).toBe(true)
    expect(apps.issues.vocabulary).toBeDefined()
    expect(body.vocabulary).toBeDefined()
  })

  it('the deprecated top-level keys are the SAME OBJECTS as the nested ones', async () => {
    const body = await metaBody()
    const current = (body.apps as Record<string, Record<string, unknown>>).issues

    // `toBe`, deliberately. A clone passes `toEqual` and then drifts.
    expect(body.vocabulary, 'top-level `vocabulary` is a copy, not the nested object').toBe(
      current.vocabulary
    )
    expect(body.limits, 'top-level `limits` is a copy, not the nested object').toBe(current.limits)
    expect(body.media, 'top-level `media` is a copy, not the nested object').toBe(current.media)
  })

  it('keeps its top-level keys, in order', async () => {
    // The order is not a contract anyone should depend on, but a CHANGE in it is
    // a reliable signal that the document was reassembled rather than moved —
    // which is the thing this whole extraction promised not to do.
    expect(Object.keys(await metaBody())).toEqual([
      'user',
      'active_workspace',
      'workspaces',
      'current_app',
      'apps',
      'vocabulary',
      'limits',
      'media',
      'links',
      'cli',
      'conventions',
      'labels',
      'projects',
      'members',
    ])
  })

  it('keeps the four conventions, app-specific one first', async () => {
    const body = await metaBody()
    expect(Object.keys(body.conventions as object)).toEqual([
      'id',
      'interface',
      'workspace_selection',
      'staying_current',
    ])
  })

  it('advertises the one CLI package, not a per-app one', async () => {
    const cli = (await metaBody()).cli as Record<string, unknown>
    expect(cli.package).toBe('@blackcode_sa/bc-issues')
    expect(cli.install).toBe('npm install -g @blackcode_sa/bc-issues')
    expect(cli.latest_version).toBeTruthy()
    expect(cli.min_version).toBeTruthy()
  })
})
