// What this app's `AppContext.workspaces` does — and the one thing it
// deliberately does NOT do.
//
// ===========================================================================
// WHY THE NO-OP NEEDS A TEST AND THE QUERIES DO NOT
// ===========================================================================
// `getForUser`, `listForUser` and `listMembers` are queries: they
// fail loudly and visibly when they are wrong, and the whole app exercises them
// on every request.
//
// `setDefaultForUser` is EMPTY, and an empty function is indistinguishable from
// a forgotten one. It is a decision with a reason (`lib/api.ts`), and the
// failure mode if somebody "fixes" it is silent: a SALES workspace id lands in
// `platform.users.active_workspace_id`, which `apps/issues` reads as one of ITS
// workspace ids. That is `error_events.workspace_id`'s ambiguity moved into the
// identity table, and nothing would report it.
//
// So this file asserts the ABSENCE, with the reason attached. The mirror
// assertion — that `apps/issues` still writes it — lives in that app, because a
// test may not reach into another app (`lib/app-isolation.test.ts`).
//
// ===========================================================================
// TWO CASES WERE DELETED ON 2026-08-10, AND DELETING THEM IS THE POINT
// ===========================================================================
// This file used to cover TWO no-ops and a scoped/unscoped equivalence:
//
//   - `assertAppAccess` — that this app never consults `platform.app_access`.
//   - `listForUser({ scopedToApp })` — that both answers are the same list.
//
// Phase 5 removed both from `WorkspaceSource` entirely, along with the tables
// behind them. Their assertions are not weakened, they are UNREPRESENTABLE: the
// method a regression would have to call does not exist, and `tsc` refuses the
// call rather than a test refusing the behaviour. Keeping them as `expect(true)`
// shaped stubs would have been the inert-guard shape CLAUDE.md catalogues —
// green, and checking nothing.
//
// The premise case went with them. It established that
// `PLATFORM_ENFORCE_APP_ACCESS` DISCRIMINATED, so that "sales does not enforce"
// was a decision rather than the kill switch (finding #16's shape, and its first
// version was inert for exactly that reason). There is no switch and no
// enforcement left to be ambiguous about.
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10 (agent 6, re-run after the rewrite)
// ===========================================================================
//   (a) `setDefaultForUser` given `setActiveWorkspace(...)` → the shared-column
//       case RED, on the spy
//   (b) `getDefaultForUser` changed to read `user.active_workspace_id` → the
//       "reads this app's own tenancy" case RED
//
// It is a unit test over the wiring object, not over HTTP: the wiring is the
// part that regresses, and `apps/issues/lib/api/context.ts` makes the same
// argument for passing `resolveSessionUser` by reference rather than wrapping
// it — so that a test can assert on the thing the app actually mounts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

/** Every sales workspace the fake tenancy holds for user 7. */
const MINE = [
  { id: 1014, name: "Alice's workspace", slug: 'alice', owner_id: 7, updated_at: new Date(1), member_role: 'owner' as const },
]

const listWorkspacesForUser = vi.fn(async () => MINE)
const setActiveWorkspace = vi.fn()
// This app's OWN pointer, in `sales.user_settings`. Spied so the positive case
// below can assert the write lands here — "did not write the shared column" is
// satisfied just as well by a source that writes nothing at all, which is the
// state this file described until 2026-08-11 and no longer does.
const setActiveWorkspaceForUser = vi.fn()
const getStoredActiveWorkspaceId = vi.fn(async () => null as number | null)
// Stubbed at the module boundary, not composed here. `getActiveWorkspaceForUser`
// calls its sibling INSIDE the module, so a module mock cannot intercept that
// call — and reimplementing the composition in this file would assert the copy
// rather than the code. The resolution itself has its own test against the real
// exported function (`lib/api/active-workspace-memory.test.ts`); this file's job,
// per its header, is the WIRING.
const getActiveWorkspaceForUser = vi.fn(async () => MINE[0])

vi.mock('@/lib/db/queries/workspaces', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorkspacesForUser,
  getWorkspaceForUser: async () => MINE[0],
  listWorkspaceMembers: async () => [],
  setActiveWorkspaceForUser,
  getStoredActiveWorkspaceId,
  getActiveWorkspaceForUser,
}))

// Spied, not stubbed away: the point is that this app's source never REACHES
// it. A stub that returned a value would prove nothing; a spy with zero calls
// is the assertion.
vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setActiveWorkspace,
}))

beforeEach(() => {
  setActiveWorkspace.mockClear()
  listWorkspacesForUser.mockClear()
  setActiveWorkspaceForUser.mockClear()
  getStoredActiveWorkspaceId.mockClear()
  getActiveWorkspaceForUser.mockClear()
})

describe("apps/sales' workspace source", () => {
  // THE PREMISE. Without it, every "did not call" assertion below would also
  // pass against a source that was never built, or a mock that never wired up.
  // It asserts the POSITIVE first — finding #16: a check built only on "was this
  // refused?" cannot tell a working boundary from an absent subject.
  it('THE PREMISE: this app really does answer from sales.workspaces', async () => {
    const { appContext } = await import('@/lib/api')
    const mine = await appContext.workspaces.listForUser(7)
    expect(mine, 'the source is wired to this app\'s own tenancy').toEqual(MINE)
    expect(listWorkspacesForUser).toHaveBeenCalledWith(7)
  })

  // ── THIS PAIR IS ONE ASSERTION IN TWO HALVES, AND THE ORDER MATTERS ───────
  // Until 2026-08-11 `setDefaultForUser` was a NO-OP, so "did not write the
  // shared column" was satisfied trivially — by a function that did nothing at
  // all. The app now remembers a workspace (it grew a switcher, and a person
  // invited into someone else's workspace has two), so the negative alone would
  // no longer discriminate: it would pass against a switcher whose choice is
  // silently dropped. The positive comes first for that reason.
  it('writes the choice to THIS app\'s own settings table', async () => {
    const { appContext } = await import('@/lib/api')
    await appContext.workspaces.setDefaultForUser(7, 1014)
    expect(
      setActiveWorkspaceForUser,
      'the switcher\'s choice was not persisted anywhere — it would survive ' +
        'exactly one page load'
    ).toHaveBeenCalledWith(7, 1014)
  })

  it('does NOT write platform.users.active_workspace_id', async () => {
    const { appContext } = await import('@/lib/api')
    await appContext.workspaces.setDefaultForUser(7, 1014)
    expect(
      setActiveWorkspace,
      'a SALES workspace id was written into the one active_workspace_id column ' +
        'every app shares. apps/issues reads it as one of ITS workspace ids.'
    ).not.toHaveBeenCalled()
  })

  it('answers "which workspace by default" from THIS app\'s tenancy', async () => {
    const { appContext } = await import('@/lib/api')
    const ws = await appContext.workspaces.getDefaultForUser(7)
    expect(ws?.id).toBe(1014)
    // The seam moved on 2026-08-11: the default used to be derived inline from
    // `listWorkspacesForUser`, and is now `getActiveWorkspaceForUser` — this
    // app's own query module either way, which is the property. Asserting the
    // OLD call would have quietly stopped meaning anything while staying green,
    // which is CLAUDE.md finding #10's shape.
    expect(
      getActiveWorkspaceForUser,
      "the default must come from sales' own tenancy, not from the shared column"
    ).toHaveBeenCalledWith(7)
    expect(setActiveWorkspace).not.toHaveBeenCalled()
  })
})
