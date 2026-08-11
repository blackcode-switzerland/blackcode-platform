// This app's `AppContext.workspaces` still reads `platform.workspaces` and still
// writes the shared active-workspace column.
//
// ===========================================================================
// THE MIRROR OF apps/sales/lib/workspace-source.test.ts
// ===========================================================================
// `AppContext.workspaces` was added on 2026-08-10 so that `apps/sales` could own
// `sales.workspaces` while both apps kept the same request layer
// (`packages/platform-api/src/workspace-source.ts`). Sales supplies a source
// whose `setDefaultForUser` is a deliberate NO-OP.
//
// That is fine there and would be a silent catastrophe here: `active_workspace_id`
// is what this app's dashboard, its `/api/meta` and its upload attribution read.
//
// **The refactor's rule is that not one row of this app's data moves and nothing
// about its behaviour changes.** This file is the half of that claim a test can
// hold. It cannot live in `apps/sales` — a test may not reach into another app
// (`lib/app-isolation.test.ts`) — so the two files are mirrors by intent.
//
// ===========================================================================
// THE PER-APP ACCESS HALF WAS DELETED ON 2026-08-10 (Phase 5)
// ===========================================================================
// Three of this file's cases were about `assertAppAccess`: the kill-switch
// premise, an ADMIT case, and a REFUSE case driven through a slug-aware fake
// executor — which was itself the fix for a version that stayed green when given
// `platformWorkspaceSource(db, 'sales')`, the right function with the wrong slug.
//
// `platform.app_access` is dropped and the method is off the interface, so all
// three assert something that cannot happen: there is no gate, no kill switch,
// and no slug to get wrong (`platformWorkspaceSource` takes only a `db` now).
// They are deleted rather than adapted. The `granted` fake executor went with
// them — nothing else in this file queries.
//
// What that costs, stated: this app no longer has a test proving a non-member of
// an app is refused, because that is not a state any more. The refusal that DOES
// still matter — a non-member of the WORKSPACE — is `resolveWorkspace`'s 404,
// covered where it is decided.
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10 (agent 6, re-run after the rewrite)
// ===========================================================================
//   (a) `setDefaultForUser: async () => {}` — the sales shape pasted into this
//       app → the shared-column case RED
//   (b) `setActiveWorkspace` called with the arguments swapped → the same case
//       RED on the argument assertion, not just the call count

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

const setActiveWorkspace = vi.fn()

vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setActiveWorkspace,
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
})

describe("apps/issues' workspace source is unchanged by the multi-app refactor", () => {
  it('STILL writes platform.users.active_workspace_id', async () => {
    const { appContext } = await import('./context')
    await appContext.workspaces.setDefaultForUser(7, 3)
    expect(
      setActiveWorkspace,
      'this app stopped remembering the active workspace. Its dashboard, its ' +
        '/api/meta default and its upload attribution all read that column.'
    ).toHaveBeenCalledTimes(1)
    // The ARGUMENTS, not just the call: a source that wrote the workspace id
    // into the user id (or wrote a constant) would satisfy a call-count
    // assertion while corrupting exactly the column this file exists to protect.
    expect(setActiveWorkspace.mock.calls[0].slice(1)).toEqual([7, 3])
  })
})
