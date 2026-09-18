// POST /api/workspaces/{ws}/recurrences/{seq}/generate — `bk billing recurrence generate`
//
// The next occurrence of a series, as a DRAFT, for the period the caller names
// (or the replacement for a voided one). Generating is not sending.
//
// A second call for the same period is a 409 `already_generated` naming the
// invoice that exists — from the series' row lock, and behind it the partial
// unique index `uq_invoice_occurrence`, which holds for every write path. The
// Idempotency-Key makes a retry QUIET as well: the same key gets the same 201
// and the same invoice back. lib/db/queries/recurrences.ts has the layers.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { authVia } from '@/lib/api/actor'
import { withIdempotency } from '@/lib/api/idempotency'
import { refusalToApiError } from '@/lib/api/refusal'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { generateOccurrence } from '@/lib/db/queries/recurrences'
import { seriesSeq } from '@/lib/api/series-ref'

interface Params {
  params: Promise<{ ws: string; seq: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, seq } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = seriesSeq(seq)
  const body = await req.json().catch(() => null)
  return withIdempotency(req, ctx.workspace.id, body, async () => {
    try {
      const result = await generateOccurrence({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, via: authVia(req) }, n, body)
      return NextResponse.json(result, { status: 201 })
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
