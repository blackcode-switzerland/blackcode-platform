// POST /api/workspaces/{ws}/invoices/{ref}/void — `bk billing invoice void`
//
// PUBLIC (`lib/integration.ts`). Cancel with a reason. The number stays consumed forever and nothing is deleted. An optional `confirm` must equal the printed number exactly; `bk` always sends it.
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
import { voidInvoice } from '@/lib/db/queries/lifecycle'
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
      const invoice = await voidInvoice(
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
