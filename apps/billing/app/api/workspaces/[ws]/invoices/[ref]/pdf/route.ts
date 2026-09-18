// GET /api/workspaces/{ws}/invoices/{ref}/pdf — `bk billing invoice pdf`
//
// PUBLIC (`lib/integration.ts`). The invoice as a PDF: the A4 body in the
// document's language and, for CHF and EUR, the QR-bill payment part.
//
// ===========================================================================
// NOTHING IS STORED, SO THE SAME BYTES COME BACK EVERY TIME
// ===========================================================================
// Position P10: a sent PDF is not archived, it is regenerated, and the render is
// deterministic. That is what makes this route safe to call twice, and what lets
// the two headers below mean something:
//
//   X-Billing-Pdf-Sha256       of the bytes in THIS response
//   X-Billing-Sent-Pdf-Sha256  of the bytes this app EMAILED — present only on
//                              an invoice `send` delivered
//
// Equal: this is, byte for byte, the document the client was mailed. Different:
// something still editable after send changed since — the payment message or the
// due date — and the difference is the honest answer, not an error. The
// document half, the lines and the ISSUER are frozen (G2, migration 0011), so
// nothing else can move them apart. `bk billing invoice pdf` says which.
//
// ── IT REFUSES RATHER THAN RENDERING A BAD SLIP ────────────────────────────
// 422 `payment_part_invalid`, naming every problem, from the same seam `send`
// goes through (lib/delivery/document.ts). A draft renders from its company as
// it is now; anything issued renders from its own copy (lib/issuer.ts).
//
// A read: no audit row.
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { getInvoiceDocumentSource, InvoiceRefused } from '@/lib/db/queries/invoices'
import { documentFilename } from '@/lib/db/queries/lifecycle'
import { prepareInvoiceDocument } from '@/lib/delivery/document'

// pdf-lib, fontkit and the font files: Node only.
export const runtime = 'nodejs'

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

  let pdf: Buffer
  try {
    pdf = await prepareInvoiceDocument(src)
  } catch (e) {
    if (e instanceof InvoiceRefused) throw refusalToApiError(e)
    throw e
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `inline; filename="${documentFilename(src.invoice.number)}"`,
    // Per-user data behind a session or a token: never a shared cache.
    'Cache-Control': 'private, no-store',
    'X-Billing-Pdf-Sha256': createHash('sha256').update(pdf).digest('hex'),
    'X-Billing-Invoice-Status': src.invoice.status,
  }
  if (src.invoice.pdf_sha256) headers['X-Billing-Sent-Pdf-Sha256'] = src.invoice.pdf_sha256
  return new NextResponse(new Uint8Array(pdf), { status: 200, headers })
})
