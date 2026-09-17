// GET  /api/workspaces/{ws}/invoices — `bk billing invoice list`
// POST /api/workspaces/{ws}/invoices — `bk billing invoice create`
//
// Both are PUBLIC (`lib/integration.ts`), and the POST is the one route in this
// app where getting it wrong is unrecoverable: it allocates a gapless statutory
// number, and the row can never be deleted.
//
// ── SO IT REQUIRES AN IDEMPOTENCY KEY FROM AN OUTSIDE CALLER ───────────────
// `withIdempotency` makes a retry replay rather than mint. Without it, a network
// timeout between our commit and the client's receipt — which is
// indistinguishable, to the client, from a failure — produces a SECOND REAL
// INVOICE that can only be voided.
//
// A browser form sends no key and that is fine: the person is watching and can
// see what happened. The key is required of the integration, and
// `docs/billing-app-plan/integration-surface.md` §2 says so on the page they
// read.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { withIdempotency } from '@/lib/api/idempotency'
import { authVia } from '@/lib/api/actor'
import { createInvoice, InvoiceRefused, listInvoices } from '@/lib/db/queries/invoices'
import { INVOICE_STATUSES } from '@/lib/vocabularies'
import { LIST_LIMIT_MAX } from '@/lib/limits'
import type { CreateInvoiceBody, InvoiceStatus } from '@/types'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const status = q.get('status')
  if (status && !INVOICE_STATUSES.some((s) => s.value === status)) {
    // Refused rather than ignored. A filter the server silently drops returns a
    // page of everything, which a caller reads as "there are no drafts" when it
    // actually means "your filter was not understood".
    throw Errors.badRequest(
      'invalid_status',
      `${status} is not an invoice status`,
      `one of ${INVOICE_STATUSES.map((s) => s.value).join(', ')} — run \`bk meta --app-server billing\``
    )
  }

  const limitRaw = q.get('limit')
  if (limitRaw !== null && !/^\d+$/.test(limitRaw)) {
    throw Errors.badRequest('invalid_limit', 'limit is a whole number', `1 to ${LIST_LIMIT_MAX}`)
  }

  const page = await listInvoices(ctx.workspace.id, {
    company: q.get('company') ?? undefined,
    status: (status as InvoiceStatus) ?? undefined,
    currency: q.get('currency')?.toUpperCase() ?? undefined,
    externalRef: q.get('external_ref') ?? undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
    cursor: q.get('cursor') ?? undefined,
  })
  return jsonList(page.data, page.next_cursor === null ? null : Number(page.next_cursor))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as CreateInvoiceBody | null
  if (!body) {
    throw Errors.badRequest(
      'invalid_body',
      'a JSON body is required',
      'bk billing invoice create --company <slug>'
    )
  }

  return withIdempotency(req, ctx.workspace.id, body, async () => {
    try {
      const invoice = await createInvoice(
        { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, via: authVia(req) },
        body
      )
      return NextResponse.json(invoice, { status: 201 })
    } catch (e) {
      if (e instanceof InvoiceRefused) throw refusalToApiError(e)
      throw e
    }
  })
})
