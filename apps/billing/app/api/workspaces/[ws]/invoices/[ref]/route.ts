// GET   /api/workspaces/{ws}/invoices/{ref} — `bk billing invoice show`
// PATCH /api/workspaces/{ws}/invoices/{ref} — `bk billing invoice edit`, `line set`
//
// `{ref}` is the `#number` or the printed invoice number, resolved in that
// order. Both spellings, because an agent addresses by `#seq` and a human reads
// the number off the document.
//
// ── THE PATCH CARRIES TWO DIFFERENT WRITES, AND SAYS WHICH ─────────────────
// A body with `items` replaces the line set; a body without it edits fields.
// One route rather than two because both are "edit this invoice" to a caller,
// and the line replacement has to be able to happen in the same request as a
// field change without ordering ambiguity.
//
// Sending both is refused rather than ordered. There is no correct order: a
// field change plus a line replacement could mean either "change these fields
// on the new lines" or "on the old ones", and guessing would make one of those
// silently wrong.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { refusalToApiError } from '@/lib/api/refusal'
import { authVia } from '@/lib/api/actor'
import { editInvoice, getInvoice, InvoiceRefused, setInvoiceLines } from '@/lib/db/queries/invoices'
import type { CreateInvoiceLineBody } from '@/types'

interface Params {
  params: Promise<{ ws: string; ref: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)
  const invoice = await getInvoice(ctx.workspace.id, ref)
  if (!invoice) {
    throw Errors.notFound(
      'invoice',
      `no invoice #${ref} or numbered ${ref} in this workspace — \`bk billing invoice list\``
    )
  }
  return NextResponse.json(invoice)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, ref } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || Object.keys(body).length === 0) {
    throw Errors.badRequest(
      'empty_patch',
      'send at least one field to change, or `items` to replace the lines',
      'bk billing invoice edit <ref> --due-date 2026-11-30'
    )
  }

  const { items, ...fields } = body
  if (items !== undefined && Object.keys(fields).length > 0) {
    throw Errors.badRequest(
      'ambiguous_patch',
      'send `items` on its own, or fields on their own',
      'there is no correct order for both: a field change plus a line replacement could mean ' +
        'either "on the new lines" or "on the old ones", and guessing would make one of them wrong'
    )
  }

  const writeCtx = {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    via: authVia(req),
  }

  try {
    if (items !== undefined) {
      if (!Array.isArray(items)) {
        throw Errors.badRequest('invalid_items', '`items` is an array of lines', 'omit it to leave the lines alone')
      }
      const invoice = await setInvoiceLines(writeCtx, ref, items as CreateInvoiceLineBody[])
      return NextResponse.json(invoice)
    }
    const invoice = await editInvoice(writeCtx, ref, fields)
    return NextResponse.json(invoice)
  } catch (e) {
    if (e instanceof InvoiceRefused) throw refusalToApiError(e)
    throw e
  }
})
