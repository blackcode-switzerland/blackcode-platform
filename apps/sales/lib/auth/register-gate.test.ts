// The whitelist gate on `POST /api/auth/register`.
//
// ===========================================================================
// WHY THIS TEST IS THE MOST IMPORTANT ONE IN THIS APP
// ===========================================================================
// The account that route creates is the SHARED platform account: one
// `platform.users` row, valid against every deployment, able to mint API tokens
// for all of them. So an ungated register route on b/sales is an ungated
// register route on `apps/issues`. PLAN.md §6 decision 1 says the gate comes
// with the route; this is what makes that true rather than intended.
//
// ===========================================================================
// THE TRAP THIS TEST IS SHAPED AROUND — CLAUDE.md FINDING #16
// ===========================================================================
// `isEmailAllowed` returns TRUE when the whitelist is off, and the whitelist is
// off whenever `SUPER_ADMINS` is unset — which is the normal state of a test
// process and of every local machine.
//
// So the naive version of this test ("post a random address, expect 403") would
// FAIL for the right reason only by accident, and a version that asserted the
// opposite would pass against a gate that had been deleted. Worse is the
// mirror image, which is exactly finding #16: a refusal produced by a subject
// that was never provisioned is not evidence of a boundary.
//
// Hence the shape below:
//
//   1. a POSITIVE case FIRST — a whitelisted address is ACCEPTED. Without it,
//      "everything is refused" passes every denial assertion here.
//   2. the whitelist is explicitly ENABLED (`SUPER_ADMINS` set) and its state
//      asserted before any denial is trusted.
//   3. the denial case asserts the STATUS AND THE CODE, so a 403 thrown for an
//      unrelated reason cannot stand in for this one.
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10, Phase 2
// ===========================================================================
// Each injected into `app/api/auth/register/route.ts`, observed red by name,
// restored:
//   (a) the whole `if (!allowed)` block deleted        -> "refuses an address
//       that is not on the whitelist" RED (got 201, expected 403)
//   (b) `if (!allowed)` inverted to `if (allowed)`     -> the POSITIVE case RED,
//       which is the assertion that stops (a)'s fix from being "refuse
//       everything"
//   (c) the gate moved BELOW the `getUserByEmail` existence check -> the
//       ordering case RED: a non-whitelisted address could probe whether an
//       account exists
//
// It is a unit test over the gate's inputs and the route's use of them, not an
// HTTP integration test: this app's integration suite needs TEST_DATABASE_URL
// and skips loudly without one, and a security gate must not be checkable only
// on a machine that has a database.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const WHITELISTED = 'allowed@blackcode.ch'
const STRANGER = 'stranger@example.com'
const ADMIN = 'admin@blackcode.ch'

/** Rows the fake `platform.email_whitelist` holds. */
let whitelistRows: { type: string; value: string }[] = []
/** Every user the fake `platform.users` holds, by lowercased email. */
let existingUsers: string[] = []
/** Set by the fake `createUserWithPassword` — the thing that must not happen. */
let created: string[] = []

vi.mock('@/lib/db/client', () => ({ getDb: () => fakeDb }))

// PARTIAL mock. `@blackcode/platform-auth`'s whitelist query imports the
// `emailWhitelist` TABLE from this same module, so replacing it wholesale
// removes the thing under test rather than isolating it — the first version of
// this file did exactly that and every case errored instead of asserting.
vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserByEmail: async (_db: unknown, email: string) =>
    existingUsers.includes(email.toLowerCase()) ? { id: 1, email } : null,
  createUserWithPassword: async (_db: unknown, data: { email: string; name: string | null }) => {
    created.push(data.email)
    return { id: 42, email: data.email, name: data.name }
  },
}))

// The bootstrap is not this test's subject, and letting it run would drag the
// whole sales schema into a unit test. Stubbed to a no-op that RECORDS, so the
// ordering assertion below ("nothing is written for a refused address") covers
// it too rather than silently ignoring it.
let bootstrapped: number[] = []
vi.mock('@/lib/db/queries/workspaces', () => ({
  ensureWorkspaceForUser: async (userId: number) => {
    bootstrapped.push(userId)
    return { workspace: { id: 1 }, created: true }
  },
}))

/**
 * Just enough of the Drizzle client for `isEmailAllowedByDb`'s raw query.
 *
 * That helper interpolates the address and the domain into a `sql` template, and
 * drizzle leaves an interpolated string as a PLAIN STRING in `queryChunks` — the
 * table lands there as a `PgTable` and the literal text as `StringChunk`
 * objects. So the interpolated VALUES are exactly the string primitives, and
 * matching on them is the whole of this fake.
 *
 * The first version filtered on `'value' in chunk` instead, which selects the
 * StringChunks and the table and none of the values — so every lookup missed
 * and the fake refused everything. The POSITIVE case above is what caught it:
 * three denial assertions were green at the time.
 */
const fakeDb = {
  execute: async (q: unknown) => {
    const values = ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter(
      (c): c is string => typeof c === 'string'
    )
    return { rows: whitelistRows.some((r) => values.includes(r.value)) ? [{ ok: 1 }] : [] }
  },
}

async function postRegister(email: string) {
  const { POST } = await import('@/app/api/auth/register/route')
  const { NextRequest } = await import('next/server')
  const req = new NextRequest('https://sales.test/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Correct-horse-1', name: 'Test' }),
    headers: { 'content-type': 'application/json' },
  })
  const res = await POST(req)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const originalSuperAdmins = process.env.SUPER_ADMINS

beforeEach(() => {
  vi.resetModules()
  whitelistRows = [{ type: 'email', value: WHITELISTED }]
  existingUsers = []
  created = []
  bootstrapped = []
  // THE WHITELIST IS ON. Everything below is meaningless without this line, and
  // the first assertion in the denial test checks it rather than assuming it.
  process.env.SUPER_ADMINS = ADMIN
})

afterEach(() => {
  if (originalSuperAdmins === undefined) delete process.env.SUPER_ADMINS
  else process.env.SUPER_ADMINS = originalSuperAdmins
})

describe('POST /api/auth/register — the whitelist gate', () => {
  // FIRST, and deliberately so. Finding #16: a check built on "was this denied?"
  // cannot tell a working boundary from a subject that can do nothing at all.
  // If this goes red, every refusal below is worthless.
  it('ACCEPTS a whitelisted address (the positive case that makes the denials mean something)', async () => {
    const { status, body } = await postRegister(WHITELISTED)
    expect(status, `a whitelisted address must be created, got ${JSON.stringify(body)}`).toBe(201)
    expect(created).toEqual([WHITELISTED])
  })

  it('ACCEPTS a super admin even with no whitelist row', async () => {
    whitelistRows = []
    const { status } = await postRegister(ADMIN)
    expect(status).toBe(201)
    expect(created).toEqual([ADMIN])
  })

  it('refuses an address that is not on the whitelist', async () => {
    const { isWhitelistEnabled } = await import('@blackcode/platform-auth')
    expect(
      isWhitelistEnabled(),
      'the whitelist must be ON, or this test refuses nothing and proves nothing (finding #16)'
    ).toBe(true)

    const { status, body } = await postRegister(STRANGER)
    expect(status, 'a non-whitelisted address must be refused').toBe(403)
    // The CODE, not just the status: a 403 for some other reason must not be
    // able to stand in for this one.
    expect(body.error).toBe('not_in_whitelist')
    expect(created, 'no account may be created for a refused address').toEqual([])
    expect(bootstrapped, 'no workspace may be created for a refused address').toEqual([])
  })

  it('refuses BEFORE it looks the address up, so it cannot be used to probe for accounts', async () => {
    // The address exists AND is not whitelisted. A route that checked existence
    // first would answer 409 "already registered" — telling a stranger that this
    // person has a blackcode account.
    existingUsers = [STRANGER]
    const { status, body } = await postRegister(STRANGER)
    expect(status, 'existence must not be observable to a non-whitelisted caller').toBe(403)
    expect(body.error).toBe('not_in_whitelist')
  })
})
