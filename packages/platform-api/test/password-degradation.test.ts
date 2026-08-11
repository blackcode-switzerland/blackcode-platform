// The honest-degradation rule on the password-reset request routes.
//
// ---------------------------------------------------------------------------
// WHAT IS ACTUALLY UNDER TEST, AND WHY IT IS THE ORDER RATHER THAN THE STATUS
// ---------------------------------------------------------------------------
// The rule (multiAppFinalRefactor Phase 10): an app that cannot deliver a code
// must REFUSE, not accept the request and deliver nothing. "No email arrived"
// and "the email is slow" are indistinguishable to the person waiting, which is
// the failure mode this whole project keeps finding.
//
// A test that only asserted `status === 503` would pass on a route that minted
// an OTP, burned a rate-limit slot, invalidated the caller's previous pending
// codes and THEN refused — which is a worse bug than the one being fixed,
// because a person who fixes the missing key later finds their reset attempts
// already rate-limited by requests that never sent anything.
//
// So the fixture's `db` THROWS on any access. The assertion is "the route
// answered 503 without touching the database at all", and the mechanism is the
// same `unreachableProxy` trick `account-census.test.ts` uses.
//
// ---------------------------------------------------------------------------
// WATCHED FAIL, BOTH WAYS (CLAUDE.md's standing rule)
// ---------------------------------------------------------------------------
// Deleting the `canDeliverEmail()` block from `passwordRequestOtpRoute` fails
// these with `db must not be reached...` rather than with a status mismatch —
// i.e. it fails for the right reason. Moving the block to AFTER
// `requestPasswordOtp` fails them the same way, which is the case a
// status-only assertion would have missed.
//
// And the POSITIVE case is asserted first (CLAUDE.md finding #16): a guard
// built only on "was this refused?" cannot tell a working check from a route
// that refuses everything. `canDeliverEmail: () => true` must NOT 503.

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  passwordRequestOtpRoute,
  publicPasswordResetRequestRoute,
} from '../src/routes/password'
import type { AppContext } from '../src/app-context'
import type { PasswordOtpSender } from '../src/routes/password'

const USER = { id: 1, email: 'someone@blackcode.ch', name: 'Someone' }

/** Any access to `db` is a failure — the refusal must come first. */
function explodingDb(): AppContext['db'] {
  return new Proxy({} as AppContext['db'], {
    get: (_t, prop) => {
      throw new Error(
        `db must not be reached before the email_not_configured refusal (touched .${String(prop)})`
      )
    },
  })
}

function ctx(db: AppContext['db'] = explodingDb()): AppContext {
  return {
    appSlug: 'sales',
    db,
    workspaces: {} as AppContext['workspaces'],
    uploads: {} as AppContext['uploads'],
    footprint: {} as AppContext['footprint'],
    resolveUser: async () => USER as Awaited<ReturnType<AppContext['resolveUser']>>,
  }
}

/** A sender that records whether anything was actually handed to it. */
function sender(canDeliver: boolean): PasswordOtpSender & { sends: number } {
  const s = {
    sends: 0,
    canDeliverEmail: () => canDeliver,
    async sendPasswordResetEmail() {
      s.sends += 1
      return { sent: true }
    },
  }
  return s
}

const authedReq = () => new NextRequest('https://sales.test/api/me/password/request-otp', { method: 'POST' })

const publicReq = (email = USER.email) =>
  new NextRequest('https://sales.test/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })

describe('a deployment that cannot send email refuses instead of pretending', () => {
  // ---- the POSITIVE case, first, so the denials below mean something --------

  it('does NOT refuse when the deployment can deliver (guards against a route that 503s on everything)', async () => {
    // ── THIS ASSERTION WAS INERT ONCE. READ BEFORE CHANGING IT. ─────────────
    // The first version watched a flag set by ANY access to `db` and asserted
    // the route "got past the 503". It passed against `if (true || …)` — an
    // unconditional refusal — because `apiHandler` writes an `error_events` row
    // when it catches the ApiError, and THAT touched the db and set the flag.
    // The guard was satisfied by the error path of the very bug it was meant to
    // catch. Found by mutating the route and watching this test stay green
    // (CLAUDE.md's standing rule; findings #11 and #16 are the same shape).
    //
    // It asserts the RESPONSE now. A deliverable deployment may fail for any
    // number of reasons downstream — the stub db below guarantees it will — but
    // it must not fail with `email_not_configured`.
    const db = new Proxy({} as AppContext['db'], {
      get: () => {
        throw new Error('stub: the route correctly got past the deliverability check')
      },
    })
    const res = await passwordRequestOtpRoute(ctx(db), sender(true))(authedReq())
    const body = await res.json()

    expect(res.status, 'a deliverable deployment must not answer 503').not.toBe(503)
    expect(body.code, 'a deliverable deployment must never say email_not_configured').not.toBe(
      'email_not_configured'
    )
  })

  // ---- the refusals --------------------------------------------------------

  it('POST /api/me/password/request-otp answers 503 without touching the database', async () => {
    const s = sender(false)
    const res = await passwordRequestOtpRoute(ctx(), s)(authedReq())

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('email_not_configured')
    expect(body.suggestion, 'a 503 an admin can act on must name what to set').toMatch(
      /RESEND_API_KEY/
    )
    expect(s.sends, 'nothing may be handed to a sender that cannot deliver').toBe(0)
  })

  it('POST /api/auth/password-reset/request answers 503 without touching the database', async () => {
    const s = sender(false)
    const res = await publicPasswordResetRequestRoute(ctx(), s)(publicReq())

    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('email_not_configured')
    expect(s.sends).toBe(0)
  })

  it('still validates the email before refusing, so the 503 is a branch and not a blanket', async () => {
    // If the refusal were unconditional this would also be a 503. It must be a
    // 400: the deployment's inability to send says nothing about a malformed
    // address, and a route that answers one status to everything is finding #16
    // in CLAUDE.md.
    const res = await publicPasswordResetRequestRoute(ctx(), sender(false))(publicReq('nonsense'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_email')
  })

  it('refuses BEFORE the account lookup, so it cannot be used to probe for accounts', async () => {
    // Same reasoning as the register gate. The refusal must be identical for an
    // address with an account and one without — which it is, structurally,
    // because the db is never consulted. The exploding db IS this assertion.
    const withAccount = await publicPasswordResetRequestRoute(ctx(), sender(false))(
      publicReq('someone@blackcode.ch')
    )
    const without = await publicPasswordResetRequestRoute(ctx(), sender(false))(
      publicReq('nobody-at-all@blackcode.ch')
    )
    expect(withAccount.status).toBe(without.status)
    expect(await withAccount.json()).toEqual(await without.json())
  })
})
