// POST /api/workspaces/{ws}/invoices/{ref}/paid — `bk billing invoice paid`
//
// PUBLIC (`lib/integration.ts`). Assert that the money arrived, on a date. An assertion, never a computation: nothing here watches a bank account, and b/books owns the money truth.
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
import { markInvoicePaid } from '@/lib/db/queries/lifecycle'
import { InvoiceRefused } from '@/lib/db/queries/invoices'

interface Params {
  params: Promise<{ ws: string; ref: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)

  return withIdempotency(req, ctx.workspace.id, body, async () => {
    try {
      const invoice = await markInvoicePaid(
        {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          via: authVia(req),
        },
        ref, body
      )
      return NextResponse.json(invoice)
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
