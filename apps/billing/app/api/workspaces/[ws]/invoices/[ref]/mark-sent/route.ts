// POST /api/workspaces/{ws}/invoices/{ref}/mark-sent — `bk billing invoice mark-sent`
//
// PUBLIC (`lib/integration.ts`). Record that an invoice was delivered OUTSIDE this app — on paper, from another mailbox. No email, no PDF, and `sent_message_id` stays null, which is how the record says so forever.
//
// Idempotent by key like every public POST: a retry after a timeout replays the
// stored answer instead of meeting a 409 about its own success. The status
// machine would refuse the duplicate anyway; the key is what makes the retry
// look like what it was.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { authVia } from '@/lib/api/actor'
import { withIdempotency } from '@/lib/api/idempotency'
import { refusalToApiError } from '@/lib/api/refusal'
import { markInvoiceSent } from '@/lib/db/queries/lifecycle'
import { InvoiceRefused } from '@/lib/db/queries/invoices'

interface Params {
  params: Promise<{ ws: string; ref: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)

  return withIdempotency(req, ctx.workspace.id, {}, async () => {
    try {
      const invoice = await markInvoiceSent(
        {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          via: authVia(req),
        },
        ref
      )
      return NextResponse.json(invoice)
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
