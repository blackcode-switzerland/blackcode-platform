// `POST …/invoices/{ref}/send` refuses BEFORE any work when it cannot deliver —
// asserted on the RESPONSE, in both directions.
//
// ===========================================================================
// THIS IS CLAUDE.md FINDING #21's SHAPE, AND THE TEST IS WRITTEN AGAINST IT
// ===========================================================================
// #21 was a guard for this exact route shape ("refuse with 503 when email is not
// configured") whose POSITIVE case watched a flag set on any database access.
// `apiHandler` writes an `error_events` row when it catches an ApiError, so the
// unconditional refusal `if (true || !canDeliverEmail())` tripped the flag too,
// and the guard passed against the bug it existed to catch.
//
// So this test asserts two things, both on outcomes rather than side effects:
//
//   - cannot deliver → the response is 503 `email_not_configured`, AND the send
//     path was never entered (so a check moved AFTER the work also fails here)
//   - can deliver    → the response is NOT 503, and the send path WAS entered
//
// Watched failing on 2026-09-17, each mutation restored:
//   - `if (true || !canDeliverEmail())`          → the "can deliver" case went red
//   - the check moved below the `sendInvoice` call → the "cannot deliver" case went red
//
// ── WHAT IS MOCKED, AND WHY THAT DOES NOT REPEAT #21 ───────────────────────
// `apiHandler` is replaced by a pass-through that turns an ApiError into its
// response with the platform's own `errorBody`. That is the part of the real
// handler this route's contract depends on; its logging side effect is exactly
// what must NOT be observable here, and with this mock it is not observable at
// all. The database, the idempotency store and the lifecycle module are
// replaced so the route's own ordering is the only thing under test.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { ApiError, errorBody } from '@blackcode/platform-api'

let deliverable = true
const sendInvoice = vi.fn()

vi.mock('@/lib/api', () => ({
  apiHandler:
    (fn: (req: NextRequest, ctx: unknown) => Promise<Response>) =>
    async (req: NextRequest, ctx: unknown) => {
      try {
        return await fn(req, ctx)
      } catch (e) {
        if (e instanceof ApiError) return NextResponse.json(errorBody(e), { status: e.status })
        throw e
      }
    },
  resolveWorkspace: async () => ({
    workspace: { id: 1, slug: 'acme' },
    user: { id: 2, email: 'owner@example.test' },
    role: 'owner',
  }),
}))
vi.mock('@/lib/api/idempotency', () => ({
  withIdempotency: (_req: unknown, _ws: unknown, _body: unknown, handler: () => Promise<Response>) => handler(),
}))
vi.mock('@/lib/email/send', () => ({ canDeliverEmail: () => deliverable }))
vi.mock('@/lib/db/queries/lifecycle', () => ({
  sendInvoice: (...args: unknown[]) => sendInvoice(...args),
}))

import { POST } from '@/app/api/workspaces/[ws]/invoices/[ref]/send/route'

function request(): NextRequest {
  return new NextRequest('http://localhost:3300/api/workspaces/acme/invoices/7/send', {
    method: 'POST',
    body: JSON.stringify({ to: 'client@example.test' }),
    headers: { 'content-type': 'application/json' },
  })
}
const params = { params: Promise.resolve({ ws: 'acme', ref: '7' }) }

beforeEach(() => {
  sendInvoice.mockReset()
  sendInvoice.mockResolvedValue({ seq: 7, status: 'sent' })
})

describe('POST …/invoices/{ref}/send', () => {
  it('cannot deliver: answers 503 email_not_configured and never enters the send path', async () => {
    deliverable = false
    const res = await POST(request(), params)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('email_not_configured')
    expect(body.suggestion).toContain('mark-sent')
    expect(sendInvoice).not.toHaveBeenCalled()
  })

  it('can deliver: does NOT answer 503, and does enter the send path', async () => {
    deliverable = true
    const res = await POST(request(), params)
    expect(res.status).not.toBe(503)
    expect(res.status).toBe(200)
    expect(sendInvoice).toHaveBeenCalledTimes(1)
    // The actor reaches the lifecycle layer with an email, which a void record
    // and a send's audit row both need.
    expect(sendInvoice.mock.calls[0][0]).toMatchObject({ workspaceId: 1, actorUserId: 2, actorEmail: 'owner@example.test' })
  })
})
