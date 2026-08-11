// The census's failure branches, which are the whole point of it.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS ABOUT FAILURES AND NOT ABOUT THE HAPPY PATH
// ---------------------------------------------------------------------------
// The happy path was observed end to end against two running dev servers, two
// real accounts and the real Postgres (Phase 9, agent 9's reply §3). What a
// test can add is the cases that are awkward to stage there and catastrophic to
// get wrong — every one of which ends in the same place: an app whose data
// survives an account close, owned by somebody who can no longer sign in.
//
// The rule under test, in one line: **a census must never report "no data" for
// an app it could not reach** (CLAUDE.md finding #14).
//
// ---------------------------------------------------------------------------
// THE MIS-POINTED `base_url` CASE IS NOT HYPOTHETICAL
// ---------------------------------------------------------------------------
// It was MEASURED on 2026-08-11, against the running servers, while asking the
// standing rule's second question — "what would this still pass on?". Pointing
// `sales`' `base_url` at the issues deployment made the census report ISSUES'
// workspaces and its issue count under the name "Sales", `reachable: true`, with
// no warning anywhere. The whole-account close would then have purged the issues
// origin twice, asserted "sales is empty" from issues' own reply, and closed the
// account over an untouched sales workspace.
//
// So agent 8's §2.4 — "a wrong or stale `base_url` would make an app look
// unreachable, which now BLOCKS deletion — a safe direction" — is WRONG, and
// wrong in the unsafe direction. It fails safe only for an address that answers
// nothing. An address that points at ANOTHER APP IN THE SUITE answers
// confidently and as somebody else, which is the exact shape of the bug this
// phase exists to remove.

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { accountCensus, stillHolds } from '../src/account-census'
import { UNKNOWN_FOOTPRINT, type AppFootprint } from '../src/account-footprint'
import type { AppContext } from '../src/app-context'

const REGISTRY = [
  { slug: 'issues', name: 'Blackcode Issues', base_url: 'https://issues.test' },
  { slug: 'sales', name: 'Sales', base_url: 'https://sales.test' },
]

const SALES_FOOTPRINT: AppFootprint = {
  known: true,
  blocked_by: [],
  will_delete: [{ workspace_id: 1025, name: "Someone's workspace" }],
  holds: [{ label: 'prospects', count: 3 }],
}

/**
 * An `AppContext` that is `issues`, with a registry of two apps.
 *
 * `db.execute` is stubbed to answer `listAppRegistry`'s one query. Everything
 * else on the context throws, so a test that starts depending on something this
 * fixture does not model fails loudly rather than reading a plausible default.
 */
function ctx(localFootprint: AppFootprint = UNKNOWN_FOOTPRINT): AppContext {
  return {
    appSlug: 'issues',
    db: { execute: async () => ({ rows: REGISTRY }) } as unknown as AppContext['db'],
    workspaces: unreachableProxy('workspaces'),
    uploads: unreachableProxy('uploads'),
    footprint: {
      read: async () => localFootprint,
      purge: async () => {
        throw new Error('purge must not be reached by a census test')
      },
    },
    resolveUser: async () => null,
  }
}

function unreachableProxy<K extends keyof AppContext>(name: K): AppContext[K] {
  return new Proxy({} as AppContext[K], {
    get: (_t, prop) => () => {
      throw new Error(`AppContext.${String(name)}.${String(prop)}() must not be reached here`)
    },
  })
}

const req = () => new NextRequest('https://issues.test/api/me', { headers: { cookie: 'blackcode.session-token=x' } })

/** Replace global fetch for one call, restoring afterwards. */
async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the fixture itself', () => {
  // Without this, every assertion below could pass against a census that had
  // silently stopped reading the registry at all — the vacuous green this repo
  // keeps finding. Assert the inputs before trusting any conclusion.
  it('really does reach both apps', async () => {
    const seen: string[] = []
    const entries = await withFetch(
      (async (url: string | URL) => {
        seen.push(String(url))
        return json({ app: 'sales', footprint: SALES_FOOTPRINT })
      }) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(entries.map((e) => e.app)).toEqual(['issues', 'sales'])
    // The CURRENT app is answered locally and must never be fetched.
    expect(seen).toEqual(['https://sales.test/api/me/footprint'])
  })
})

describe('an app that did not answer is never reported as empty', () => {
  it('a network failure is `reachable: false`, with no footprint field at all', async () => {
    const [, sales] = await withFetch(
      (async () => {
        throw new Error('connect ECONNREFUSED')
      }) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(sales.reachable).toBe(false)
    // The safety property as a SHAPE: there is no key here to misread as zero.
    expect('footprint' in sales).toBe(false)
    expect(sales.name).toBe('Sales')
  })

  it('a non-200 is `reachable: false`', async () => {
    const [, sales] = await withFetch(
      (async () => json({ error: 'boom' }, 500)) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(sales.reachable).toBe(false)
  })

  it('a 200 carrying a body that is not a footprint is `reachable: false`', async () => {
    // Not pedantry: `apps/sales`' members page went blank in production because
    // a cast renamed an envelope instead of opening it. Here the other end of
    // that mistake is a destructive operation.
    const [, sales] = await withFetch(
      (async () => json({ app: 'sales', footprint: { oops: true } })) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(sales.reachable).toBe(false)
  })

  it('a request with NO session cookie cannot fan out, and says so', async () => {
    // `DELETE /api/me` accepts a bearer token, and a token is valid at exactly
    // one origin. Rather than pretend, every other app is unreachable — which
    // refuses the whole-account close. Fail-safe, in the safe direction.
    const bare = new NextRequest('https://issues.test/api/me')
    const [, sales] = await withFetch(
      (async () => {
        throw new Error('fetch must not be attempted without a cookie')
      }) as unknown as typeof fetch,
      () => accountCensus(ctx(), bare, 1)
    )
    expect(sales.reachable).toBe(false)
  })
})

describe('an app that answers as somebody else is not that app', () => {
  // MEASURED, not imagined — see this file's header. This is the case that
  // fails in the UNSAFE direction, because the wrong answer is a confident one.
  it('rejects a reply whose `app` is not the app we addressed', async () => {
    const [, sales] = await withFetch(
      (async () =>
        json({ app: 'issues', footprint: UNKNOWN_FOOTPRINT })) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(sales.reachable).toBe(false)
    if (!sales.reachable) expect(sales.error).toContain('wrong deployment')
  })

  it('accepts the same reply when the app names itself correctly', async () => {
    // THE POSITIVE CASE, and it is not decoration. Every assertion above is a
    // denial, and a denial-shaped check is satisfied by a census that refuses
    // everything (finding #16). This is the one that proves the others
    // discriminate.
    const [, sales] = await withFetch(
      (async () => json({ app: 'sales', footprint: SALES_FOOTPRINT })) as unknown as typeof fetch,
      () => accountCensus(ctx(), req(), 1)
    )
    expect(sales.reachable).toBe(true)
    if (sales.reachable) {
      expect(sales.footprint.holds).toEqual([{ label: 'prospects', count: 3 }])
    }
  })
})

describe('stillHolds — what the account close asserts before touching the user', () => {
  it('is true while a workspace would be deleted', () => {
    expect(stillHolds(SALES_FOOTPRINT)).toBe(true)
  })

  it('is true while a workspace is BLOCKED, not just while one is deletable', () => {
    // A blocked workspace is data the person still owns. Treating "nothing left
    // to delete" as "nothing left" would close the account over a workspace
    // that was deliberately spared — stranding it, which is the bug.
    expect(
      stillHolds({
        known: true,
        blocked_by: [{ workspace_id: 1, name: 'Shared', member_count: 2 }],
        will_delete: [],
        holds: [],
      })
    ).toBe(true)
  })

  it('is false only when the app holds nothing of theirs', () => {
    expect(stillHolds(UNKNOWN_FOOTPRINT)).toBe(false)
  })
})
