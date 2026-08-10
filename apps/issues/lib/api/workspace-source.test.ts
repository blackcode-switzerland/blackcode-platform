// This app's `AppContext.workspaces` still reads `platform.workspaces`, still
// enforces per-app access, and still writes the shared active-workspace column.
//
// ===========================================================================
// THE MIRROR OF apps/sales/lib/workspace-source.test.ts
// ===========================================================================
// `AppContext.workspaces` was added on 2026-08-10 so that `apps/sales` could own
// `sales.workspaces` while both apps kept the same request layer
// (`packages/platform-api/src/workspace-source.ts`). Sales supplies a source
// whose `assertAppAccess` and `setDefaultForUser` are deliberate NO-OPS.
//
// That is fine there and would be a silent catastrophe here: this app's tenancy
// is `platform.workspaces`, its per-app access gate is live behind
// `PLATFORM_ENFORCE_APP_ACCESS`, and `active_workspace_id` is what its dashboard,
// its `/api/meta` and its upload attribution read.
//
// **The refactor's rule is that not one row of this app's data moves and nothing
// about its behaviour changes.** This file is the half of that claim a test can
// hold. It cannot live in `apps/sales` — a test may not reach into another app
// (`lib/app-isolation.test.ts`) — so the two files are mirrors by intent.
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10
// ===========================================================================
//   (a) `workspaces: { ...platformWorkspaceSource(db, APP_SLUG), assertAppAccess:
//       async () => {} }` — the sales shape pasted into this app → the
//       enforcement case RED
//   (b) the same for `setDefaultForUser` → the shared-column case RED
//   (c) `platformWorkspaceSource(db, 'sales')` — the right function, the wrong
//       slug, which is the realistic copy-paste → the enforcement case RED,
//       naming the slug

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

const setActiveWorkspace = vi.fn()

vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setActiveWorkspace,
}))

/**
 * The access gate is asserted through its BEHAVIOUR, not through a spy.
 *
 * The first version of this file mocked `requireAppAccess` on
 * `@blackcode/platform-api`'s barrel and asserted the call. It did not work, and
 * the reason is worth recording: `platformWorkspaceSource` lives INSIDE that
 * package and imports the function by relative path, so a mock of the barrel
 * never intercepts it — the real gate ran and hit the database. The spy version
 * would have needed the mock to land for the test to mean anything, and there is
 * no assertion that would have told me it had not, beyond the query error.
 *
 * Driving a fake executor is better anyway: it exercises the real
 * `hasAppAccess` → `explainAppAccessDenial` → 403 chain that a request takes.
 */
let granted: string | null = null
vi.mock('@/lib/db/client', () => ({
  db: {
    /**
     * Answers "yes, granted" ONLY for the app slug in `granted`.
     *
     * Slug-aware on purpose. The first behavioural version returned the same
     * rows for every statement, and injecting
     * `platformWorkspaceSource(db, 'sales')` — the right function with the wrong
     * slug, which is the realistic mistake when this line is copied into a new
     * app — left the suite GREEN. A gate that asks about another app answers
     * about another app's grants, and nothing here could see it. STEP 2 of the
     * standing rule: what would this still pass on?
     *
     * Drizzle leaves an interpolated value as a plain string in `queryChunks`
     * (the table lands there as a PgTable and the literal text as StringChunks),
     * so matching the slug is matching a string primitive.
     */
    execute: async (q: unknown) => {
      const values = ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter(
        (c): c is string => typeof c === 'string'
      )
      return { rows: granted !== null && values.includes(granted) ? [{ ok: 1 }] : [] }
    },
  },
}))

const WS = {
  id: 3,
  name: 'Acme',
  slug: 'acme',
  owner_id: 7,
  updated_at: new Date(1),
  member_role: 'owner' as const,
}
const USER = { id: 7, email: 'ada@example.test' } as never

beforeEach(() => {
  setActiveWorkspace.mockClear()
  granted = null
  process.env.PLATFORM_ENFORCE_APP_ACCESS = '1'
})

describe("apps/issues' workspace source is unchanged by the multi-app refactor", () => {
  it('THE PREMISE: the kill switch discriminates', async () => {
    const { isAppAccessEnforced } = await import('@blackcode/platform-api')
    expect(isAppAccessEnforced()).toBe(true)
    process.env.PLATFORM_ENFORCE_APP_ACCESS = '0'
    expect(
      isAppAccessEnforced(),
      'if the switch cannot be turned off, "this app enforces" below is unfalsifiable'
    ).toBe(false)
    process.env.PLATFORM_ENFORCE_APP_ACCESS = '1'
  })

  // The POSITIVE case first (finding #16): a source that threw unconditionally
  // would satisfy the refusal below while being completely broken.
  it('ADMITS a caller who holds the grant', async () => {
    granted = 'issues'
    const { appContext } = await import('./context')
    await expect(
      appContext.workspaces.assertAppAccess({ workspace: WS, user: USER })
    ).resolves.toBeUndefined()
  })

  it('STILL enforces per-app access — a caller with no grant is refused', async () => {
    granted = null
    const { appContext } = await import('./context')
    await expect(
      appContext.workspaces.assertAppAccess({ workspace: WS, user: USER }),
      'the per-app access gate is no longer consulted. `apps/sales` drops it on ' +
        'purpose because it owns its workspaces; this app does not, and its ' +
        'workspaces are shared with every other app in them.'
    ).rejects.toMatchObject({ status: 403, code: 'app_access_denied' })
  })

  it('STILL writes platform.users.active_workspace_id', async () => {
    const { appContext } = await import('./context')
    await appContext.workspaces.setDefaultForUser(7, 3)
    expect(
      setActiveWorkspace,
      'this app stopped remembering the active workspace. Its dashboard, its ' +
        '/api/meta default and its upload attribution all read that column.'
    ).toHaveBeenCalledTimes(1)
    expect(setActiveWorkspace.mock.calls[0].slice(1)).toEqual([7, 3])
  })
})
