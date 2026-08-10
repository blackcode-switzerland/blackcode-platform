// What this app's `AppContext.workspaces` does — and the two things it
// deliberately does NOT do.
//
// ===========================================================================
// WHY THE NO-OPS NEED A TEST AND THE QUERIES DO NOT
// ===========================================================================
// `getForUser`, `listForUser`, `getById` and `listMembers` are queries: they
// fail loudly and visibly when they are wrong, and the whole app exercises them
// on every request.
//
// `assertAppAccess` and `setDefaultForUser` are EMPTY, and an empty function is
// indistinguishable from a forgotten one. Both are decisions with a reason
// (`lib/api.ts`), and the failure mode if somebody "fixes" them is silent in
// both directions:
//
//   - `assertAppAccess` doing something → every sales request starts consulting
//     `platform.app_access` for a workspace id that means a different team, and
//     a real member is refused with a suggestion naming a command that cannot
//     help them.
//   - `setDefaultForUser` doing something → a SALES workspace id lands in
//     `platform.users.active_workspace_id`, which `apps/issues` reads as one of
//     ITS workspace ids. That is `error_events.workspace_id`'s ambiguity moved
//     into the identity table, and nothing would report it.
//
// So this file asserts the ABSENCE, with the reason attached. The mirror
// assertion — that `apps/issues` still enforces and still writes — lives in that
// app, because a test may not reach into another app (`lib/app-isolation.test.ts`).
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10
// ===========================================================================
//   (a) `assertAppAccess` given the platform implementation
//       (`requireAppAccess(...)`) → the enforcement case RED
//   (b) `setDefaultForUser` given `setActiveWorkspace(...)` → the shared-column
//       case RED, on the spy
//   (c) `getDefaultForUser` changed to read `user.active_workspace_id` → the
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
const requireAppAccess = vi.fn()

vi.mock('@/lib/db/queries/workspaces', () => ({
  listWorkspacesForUser,
  getWorkspaceForUser: async () => MINE[0],
  getWorkspaceById: async () => MINE[0],
  listWorkspaceMembers: async () => [],
}))

// Spied, not stubbed away: the point is that this app's source never REACHES
// them. A stub that returned a value would prove nothing; a spy with zero calls
// is the assertion.
vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setActiveWorkspace,
}))
vi.mock('@blackcode/platform-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAppAccess,
}))

beforeEach(() => {
  setActiveWorkspace.mockClear()
  requireAppAccess.mockClear()
  listWorkspacesForUser.mockClear()
  // Enforcement ON. Without this the first assertion would hold for the wrong
  // reason — the kill switch, not this app's decision. CLAUDE.md finding #16.
  process.env.PLATFORM_ENFORCE_APP_ACCESS = '1'
})

const USER = { id: 7, email: 'alice@phase2.test' } as never

describe("apps/sales' workspace source", () => {
  // ── THE PREMISE, AND ITS FIRST VERSION COULD NOT FAIL ─────────────────────
  // It asserted only `isAppAccessEnforced() === true` — after `beforeEach` had
  // just set `PLATFORM_ENFORCE_APP_ACCESS=1`. A test that asserts what its own
  // setup wrote is decoration: running the suite with the kill switch OFF left
  // it green, which is precisely the condition it exists to rule out.
  //
  // What it has to establish is that the switch DISCRIMINATES, because every
  // assertion below leans on "enforcement is on, so this no-op is a decision
  // and not the kill switch". So it checks both directions and restores.
  it('THE PREMISE: the kill switch discriminates, so the no-ops below are decisions', async () => {
    const { isAppAccessEnforced } = await import('@blackcode/platform-api')
    expect(isAppAccessEnforced(), 'beforeEach set PLATFORM_ENFORCE_APP_ACCESS=1').toBe(true)

    process.env.PLATFORM_ENFORCE_APP_ACCESS = '0'
    expect(
      isAppAccessEnforced(),
      'the kill switch does not turn enforcement off, so "sales does not enforce" ' +
        'below would be unfalsifiable rather than true'
    ).toBe(false)
    process.env.PLATFORM_ENFORCE_APP_ACCESS = '1'
  })

  it('does NOT enforce per-app access — a member of a sales workspace is a sales user', async () => {
    const { appContext } = await import('@/lib/api')
    await expect(
      appContext.workspaces.assertAppAccess({ workspace: MINE[0], user: USER })
    ).resolves.toBeUndefined()
    expect(
      requireAppAccess,
      'this app consulted platform.app_access. Those rows are keyed on a ' +
        'platform workspace id, and this workspace id is a SALES one — so the ' +
        'answer would be about a different team. Phase 5 drops both tables.'
    ).not.toHaveBeenCalled()
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
    expect(
      listWorkspacesForUser,
      'the default must come from sales.workspaces, not from the shared column'
    ).toHaveBeenCalledWith(7)
  })

  it('answers scoped and unscoped listings identically — there is no app to scope to', async () => {
    const { appContext } = await import('@/lib/api')
    const scoped = await appContext.workspaces.listForUser(7, { scopedToApp: true })
    const raw = await appContext.workspaces.listForUser(7, { scopedToApp: false })
    expect(scoped).toEqual(raw)
  })
})
