// POST /api/workspaces/{ws}/invoices/{ref}/send — `bk billing invoice send`
//
// PUBLIC (`lib/integration.ts`). Mails the invoice PDF and records the delivery.
//
// ===========================================================================
// THE FIRST THING THIS ROUTE DOES IS ASK WHETHER IT CAN SEND AT ALL
// ===========================================================================
// Before the invoice is read, before the PDF is rendered, before a row is
// locked: `canDeliverEmail()`. A deployment with no Resend key in production
// answers 503 `email_not_configured` and nothing else happens. A refusal that
// came AFTER rendering would still be correct, and it would be the shape that
// hides mistakes — work done, then discarded, on a path nobody watches.
//
// `send.test.ts` asserts this on the RESPONSE, both ways: a 503 when the
// deployment cannot deliver, and NOT a 503 when it can. That positive half is
// CLAUDE.md finding #21 — a guard for this exact route shape that passed
// against an unconditional refusal because it watched a side effect the error
// path also produced.
//
// ── IDEMPOTENCY WRAPS IT ───────────────────────────────────────────────────
// The key is claimed before step 1 and released on any refusal, so a 503 leaves
// no row behind. Here the stake is not a number but a second email in a
// client's inbox; lib/db/queries/lifecycle.ts's header covers the three layers
// that stop one (this key, the row lock, the transport's own key).
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { authVia } from '@/lib/api/actor'
import { withIdempotency } from '@/lib/api/idempotency'
import { refusalToApiError } from '@/lib/api/refusal'
import { canDeliverEmail } from '@/lib/email/send'
import { sendInvoice } from '@/lib/db/queries/lifecycle'
import { InvoiceRefused } from '@/lib/db/queries/invoices'

interface Params {
  params: Promise<{ ws: string; ref: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)

  return withIdempotency(req, ctx.workspace.id, body, async () => {
    if (!canDeliverEmail()) {
      throw Errors.serviceUnavailable(
        'email_not_configured',
        'this deployment has no email transport configured, so it cannot send an invoice',
        'set RESEND_API_KEY and RESEND_FROM_EMAIL on this deployment, or deliver the invoice ' +
          'yourself and record it with `bk billing invoice mark-sent <ref>`'
      )
    }
    try {
      const invoice = await sendInvoice(
        {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          via: authVia(req),
        },
        ref,
        body
      )
      return NextResponse.json(invoice)
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
