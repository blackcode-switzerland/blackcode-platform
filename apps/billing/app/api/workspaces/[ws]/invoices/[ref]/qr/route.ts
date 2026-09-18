// GET /api/workspaces/{ws}/invoices/{ref}/qr — `bk billing invoice qr`
//
// PUBLIC (`lib/integration.ts`). The Swiss QR Code payload as `text/plain`:
// exactly the characters the PDF's QR code encodes, from the same function
// (`serializeQrPayload`) through the same validation.
//
// ── WHY A ROUTE FOR A STRING ───────────────────────────────────────────────
// Because a human has to paste it into SIX's validation portal, which is the
// acceptance test for this whole phase and lives outside the repo. It is also
// the cheapest way for an agent to check its own work: 31 lines, every one of
// them identified by POSITION, so a diff against what it expected is immediate.
//
// ── THE BYTES ARE THE CONTRACT ─────────────────────────────────────────────
// LF line endings, no trailing newline, UTF-8. A client that "tidies" the body
// — trims it, appends a newline, converts line endings — no longer holds the
// payload. `bk billing invoice qr` writes it untouched for that reason.
//
// 409 `no_payment_part` for a currency the QR-bill does not carry and for a void
// invoice; 422 `payment_part_invalid` for a record the standard would refuse.
//
// A read: no audit row.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { getInvoiceDocumentSource, InvoiceRefused } from '@/lib/db/queries/invoices'
import { prepareQrPayload } from '@/lib/delivery/document'

interface Params {
  params: Promise<{ ws: string; ref: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)
  const src = await getInvoiceDocumentSource(ctx.workspace.id, ref)
  if (!src) {
    throw Errors.notFound(
      'invoice',
      `no invoice #${ref} or numbered ${ref} in this workspace — \`bk billing invoice list\``
    )
  }

  let payload: string
  try {
    payload = prepareQrPayload(src)
  } catch (e) {
    if (e instanceof InvoiceRefused) throw refusalToApiError(e)
    throw e
  }

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Billing-Invoice-Status': src.invoice.status,
    },
  })
})
